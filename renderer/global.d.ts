export interface Note {
  id: string;
  title: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}

export interface ElectronAPI {
  // Notes CRUD
  listNotes(): Promise<Note[]>;
  getNote(id: string): Promise<Note | null>;
  createNote(title: string, content: string): Promise<Note>;
  editNote(id: string, title: string, content: string): Promise<Note | null>;
  deleteNote(id: string): Promise<boolean>;

  // Window controls
  minimize(): void;
  maximize(): void;
  close(): void;

  // File save
  saveAs(content: string): Promise<{ success: boolean; filePath: string | null; error?: string }>;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}

export {};