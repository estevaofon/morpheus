import { contextBridge, ipcRenderer } from 'electron';

export interface Note {
  id: string;
  title: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}

contextBridge.exposeInMainWorld('electronAPI', {
  // Notes CRUD
  listNotes: (): Promise<Note[]> => ipcRenderer.invoke('notes:list'),
  getNote: (id: string): Promise<Note | null> => ipcRenderer.invoke('notes:get', id),
  createNote: (title: string, content: string): Promise<Note> =>
    ipcRenderer.invoke('notes:create', title, content),
  editNote: (id: string, title: string, content: string): Promise<Note | null> =>
    ipcRenderer.invoke('notes:edit', id, title, content),
  deleteNote: (id: string): Promise<boolean> =>
    ipcRenderer.invoke('notes:delete', id),

  // Window controls
  minimize: () => ipcRenderer.send('window:minimize'),
  maximize: () => ipcRenderer.send('window:maximize'),
  close: () => ipcRenderer.send('window:close'),

  // File save
  saveAs: (content: string): Promise<{ success: boolean; filePath: string | null; error?: string }> =>
    ipcRenderer.invoke('file:saveAs', content),
});