import { app, BrowserWindow, ipcMain, dialog, Menu } from 'electron';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { createNote, editNote, deleteNote, getNote, listNotes, setNoteFilePath, findNoteByFilePath } from './notepad';

// Pin the userData directory to the package name so notes/preferences
// persist across builds. Without this, the packaged app would use
// productName ("Morpheus") for %APPDATA% — different from the dev
// build's path ("matrix-notepad") — and existing notes would appear lost.
app.setPath('userData', path.join(app.getPath('appData'), 'matrix-notepad'));

const IS_WINDOWS = os.platform() === 'win32';

function toPlatformLineEndings(text: string): string {
  const lf = text.replace(/\r\n/g, '\n');
  return IS_WINDOWS ? lf.replace(/\n/g, '\r\n') : lf;
}

function toEditorLineEndings(text: string): string {
  return text.replace(/\r\n/g, '\n');
}

let mainWindow: BrowserWindow | null = null;
let pendingFileToOpen: string | null = null;

// ============================================
// EXTERNAL FILE WATCHING
// ============================================
// We track every file that any note is bound to and poll it for changes.
// When the on-disk content differs from what we last saw (and isn't a
// reflection of our own save), we push the new content to the renderer
// so the editor can refresh — same UX as classic Notepad reloading a
// file edited by another program.

interface WatchedFile {
  // Content as the editor sees it (LF-only). Used to detect whether the
  // on-disk content has actually changed vs. mirrors what we just wrote.
  lastKnownContent: string;
}

const fileWatchers = new Map<string, WatchedFile>();
const FILE_WATCH_INTERVAL_MS = 750;

function watchFilePath(filePath: string, initialContent?: string): void {
  const existing = fileWatchers.get(filePath);
  if (existing) {
    if (initialContent !== undefined) {
      existing.lastKnownContent = initialContent;
    }
    return;
  }

  let content: string;
  if (initialContent !== undefined) {
    content = initialContent;
  } else {
    try {
      content = toEditorLineEndings(fs.readFileSync(filePath, 'utf-8'));
    } catch {
      return; // unreadable — don't waste a watcher on it
    }
  }

  fileWatchers.set(filePath, { lastKnownContent: content });

  fs.watchFile(filePath, { interval: FILE_WATCH_INTERVAL_MS }, (curr, prev) => {
    // Both mtime and size unchanged → nothing to do. (Stat polling sometimes
    // fires identical-stat events on Windows; skip those.)
    if (curr.mtimeMs === prev.mtimeMs && curr.size === prev.size) return;
    const state = fileWatchers.get(filePath);
    if (!state) return;
    let newContent: string;
    try {
      newContent = toEditorLineEndings(fs.readFileSync(filePath, 'utf-8'));
    } catch {
      return; // transient I/O error — keep polling
    }
    // Suppress self-triggered events: if the content matches what we
    // last wrote/read, this is just our own save echoing back.
    if (newContent === state.lastKnownContent) return;
    state.lastKnownContent = newContent;
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('file:externalChange', { filePath, content: newContent });
    }
  });
}

function recordKnownFileContent(filePath: string, content: string): void {
  const state = fileWatchers.get(filePath);
  if (state) {
    state.lastKnownContent = content;
  } else {
    watchFilePath(filePath, content);
  }
}

function extractFilePathFromArgv(argv: string[]): string | null {
  for (let i = 1; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg || arg === '.' || arg.startsWith('-')) continue;
    try {
      if (fs.existsSync(arg) && fs.statSync(arg).isFile()) {
        return path.resolve(arg);
      }
    } catch {}
  }
  return null;
}

function sendFileToRenderer(filePath: string): void {
  if (!mainWindow) return;
  try {
    const content = toEditorLineEndings(fs.readFileSync(filePath, 'utf-8'));
    mainWindow.webContents.send('file:openExternal', { filePath, content });
    watchFilePath(filePath, content);
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  } catch (err) {
    mainWindow.webContents.send('file:openExternal', { filePath, error: String(err) });
  }
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    frame: false,
    backgroundColor: '#000000',
    icon: path.join(__dirname, '../output.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    minWidth: 800,
    minHeight: 600,
  });

  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));

  mainWindow.webContents.once('did-finish-load', async () => {
    if (pendingFileToOpen) {
      const filePath = pendingFileToOpen;
      pendingFileToOpen = null;
      sendFileToRenderer(filePath);
    }
    // Bind a watcher to every existing note's filePath and surface any
    // drift that happened while the app was closed.
    try {
      const allNotes = await listNotes();
      const seen = new Set<string>();
      for (const note of allNotes) {
        if (!note.filePath || seen.has(note.filePath)) continue;
        seen.add(note.filePath);
        try {
          const content = toEditorLineEndings(fs.readFileSync(note.filePath, 'utf-8'));
          watchFilePath(note.filePath, content);
          if (content !== note.content) {
            mainWindow!.webContents.send('file:externalChange', {
              filePath: note.filePath,
              content,
            });
          }
        } catch {
          // File deleted or unreadable — leave the note as-is and skip the watcher
        }
      }
    } catch {
      // Non-fatal: notes index unreadable; nothing to watch
    }
  });

  mainWindow.webContents.on('context-menu', (_event, params) => {
    const { editFlags, isEditable, selectionText } = params;
    const hasSelection = !!selectionText && selectionText.trim().length > 0;

    const template: Electron.MenuItemConstructorOptions[] = [];

    if (isEditable) {
      template.push({ label: 'Cut', role: 'cut', enabled: editFlags.canCut && hasSelection });
    }
    template.push({ label: 'Copy', role: 'copy', enabled: editFlags.canCopy && hasSelection });
    if (isEditable) {
      template.push({ label: 'Paste', role: 'paste', enabled: editFlags.canPaste });
    }

    if (isEditable || hasSelection) {
      template.push({ type: 'separator' });
      template.push({ label: 'Select All', role: 'selectAll', enabled: editFlags.canSelectAll });
    }

    if (template.length === 0) return;

    Menu.buildFromTemplate(template).popup({ window: mainWindow! });
  });
}

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    const filePath = extractFilePathFromArgv(argv);
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
      if (filePath) sendFileToRenderer(filePath);
    } else if (filePath) {
      pendingFileToOpen = filePath;
    }
  });

  pendingFileToOpen = extractFilePathFromArgv(process.argv);

  app.whenReady().then(() => {
    createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}

// IPC Handlers — Notes
ipcMain.handle('notes:list', async () => {
  return await listNotes();
});

ipcMain.handle('notes:get', async (_event, id: string) => {
  return await getNote(id);
});

ipcMain.handle('notes:create', async (_event, title: string, content: string) => {
  return await createNote(title, content);
});

ipcMain.handle('notes:edit', async (_event, id: string, title: string, content: string) => {
  return await editNote(id, title, content);
});

ipcMain.handle('notes:delete', async (_event, id: string) => {
  return await deleteNote(id);
});

// IPC Handlers — Window Controls
ipcMain.on('window:minimize', () => mainWindow?.minimize());
ipcMain.on('window:maximize', () => {
  if (mainWindow?.isMaximized()) mainWindow.unmaximize();
  else mainWindow?.maximize();
});
ipcMain.on('window:close', () => mainWindow?.close());

// IPC Handlers — File Save As
ipcMain.handle('file:saveAs', async (_event, content: string, existingPath?: string, suggestedName?: string) => {
  const trimmedName = suggestedName?.trim();
  const hasExistingPath = !!(existingPath && existingPath.trim());

  let defaultPath: string;
  if (trimmedName && hasExistingPath) {
    defaultPath = path.join(path.dirname(existingPath!), trimmedName);
  } else if (hasExistingPath) {
    defaultPath = existingPath!;
  } else if (trimmedName) {
    defaultPath = trimmedName;
  } else {
    defaultPath = 'Untitled.txt';
  }

  const result = await dialog.showSaveDialog(mainWindow!, {
    title: 'Save As — Morpheus',
    defaultPath,
    filters: [
      { name: 'Text Files', extensions: ['txt'] },
      { name: 'Markdown', extensions: ['md'] },
      { name: 'All Files', extensions: ['*'] },
    ],
  });

  if (result.canceled || !result.filePath) {
    return { success: false, filePath: null };
  }

  try {
    fs.writeFileSync(result.filePath, toPlatformLineEndings(content), 'utf-8');
    recordKnownFileContent(result.filePath, content);
    return { success: true, filePath: result.filePath };
  } catch (err) {
    return { success: false, filePath: null, error: String(err) };
  }
});

ipcMain.handle('notes:setFilePath', async (_event, id: string, filePath: string) => {
  const updated = await setNoteFilePath(id, filePath);
  if (updated) {
    try {
      const content = toEditorLineEndings(fs.readFileSync(filePath, 'utf-8'));
      watchFilePath(filePath, content);
    } catch {
      // File doesn't exist yet (Save As just wrote it) or is unreadable —
      // recordKnownFileContent from the save handler already armed the watcher.
    }
  }
  return updated;
});

ipcMain.handle('notes:findByFilePath', async (_event, filePath: string) => {
  return await findNoteByFilePath(filePath);
});

ipcMain.handle('file:save', async (_event, filePath: string, content: string) => {
  try {
    fs.writeFileSync(filePath, toPlatformLineEndings(content), 'utf-8');
    // Set AFTER the synchronous write so the next watcher poll sees the
    // post-write file but our cached content already matches it.
    recordKnownFileContent(filePath, content);
    return { success: true, filePath };
  } catch (err) {
    return { success: false, filePath: null, error: String(err) };
  }
});

ipcMain.handle('file:open', async () => {
  const result = await dialog.showOpenDialog(mainWindow!, {
    title: 'Open — Morpheus',
    filters: [
      { name: 'Text Files', extensions: ['txt'] },
      { name: 'Markdown', extensions: ['md'] },
      { name: 'All Files', extensions: ['*'] },
    ],
    properties: ['openFile'],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  const filePath = result.filePaths[0];
  try {
    const content = toEditorLineEndings(fs.readFileSync(filePath, 'utf-8'));
    watchFilePath(filePath, content);
    return { filePath, content };
  } catch (err) {
    return { error: String(err) };
  }
});