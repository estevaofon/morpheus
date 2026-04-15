import { app, BrowserWindow, ipcMain, dialog, Menu } from 'electron';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { createNote, editNote, deleteNote, getNote, listNotes, setNoteFilePath, findNoteByFilePath } from './notepad';

const IS_WINDOWS = os.platform() === 'win32';

function toPlatformLineEndings(text: string): string {
  const lf = text.replace(/\r\n/g, '\n');
  return IS_WINDOWS ? lf.replace(/\n/g, '\r\n') : lf;
}

function toEditorLineEndings(text: string): string {
  return text.replace(/\r\n/g, '\n');
}

let mainWindow: BrowserWindow | null = null;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    frame: false,
    backgroundColor: '#000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    minWidth: 800,
    minHeight: 600,
  });

  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));

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

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

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
    return { success: true, filePath: result.filePath };
  } catch (err) {
    return { success: false, filePath: null, error: String(err) };
  }
});

ipcMain.handle('notes:setFilePath', async (_event, id: string, filePath: string) => {
  return await setNoteFilePath(id, filePath);
});

ipcMain.handle('notes:findByFilePath', async (_event, filePath: string) => {
  return await findNoteByFilePath(filePath);
});

ipcMain.handle('file:save', async (_event, filePath: string, content: string) => {
  try {
    fs.writeFileSync(filePath, toPlatformLineEndings(content), 'utf-8');
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
    return { filePath, content };
  } catch (err) {
    return { error: String(err) };
  }
});