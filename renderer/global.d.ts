export interface Note {
  id: string;
  title: string;
  content: string;
  createdAt: string;
  updatedAt: string;
  filePath?: string;
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
  saveAs(content: string, existingPath?: string): Promise<{ success: boolean; filePath: string | null; error?: string }>;
  saveFile(filePath: string, content: string): Promise<{ success: boolean; filePath: string | null; error?: string }>;
  openFile(): Promise<{ filePath: string; content: string } | { error: string } | null>;
  setNoteFilePath(id: string, filePath: string): Promise<Note | null>;
  findNoteByFilePath(filePath: string): Promise<Note | null>;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
    marked: {
      parse(markdown: string): string;
      setOptions(options: Record<string, unknown>): void;
    };
    DOMPurify: {
      sanitize(dirty: string, config?: Record<string, unknown>): string;
    };
  }
}

export {};