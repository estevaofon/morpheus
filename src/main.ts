import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import path from 'path';
import fs from 'fs';
import { createNote, editNote, deleteNote, getNote, listNotes, setNoteFilePath, findNoteByFilePath } from './notepad';

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
ipcMain.handle('file:saveAs', async (_event, content: string, existingPath?: string) => {
  const defaultPath = existingPath && existingPath.trim() ? existingPath : 'Untitled.txt';
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
    fs.writeFileSync(result.filePath, content, 'utf-8');
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
    fs.writeFileSync(filePath, content, 'utf-8');
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
    const content = fs.readFileSync(filePath, 'utf-8');
    return { filePath, content };
  } catch (err) {
    return { error: String(err) };
  }
});