import fs from 'fs/promises';
import path from 'path';
import { app } from 'electron';

export interface Note {
  id: string;
  title: string;
  content: string;
  createdAt: string;
  updatedAt: string;
  filePath?: string;
}

function getNotesDir(): string {
  return path.join(app.getPath('userData'), 'notes');
}

function getDataFile(): string {
  return path.join(getNotesDir(), 'index.json');
}

async function initNotes(): Promise<void> {
  const notesDir = getNotesDir();
  const dataFile = getDataFile();
  try {
    await fs.access(dataFile);
    return;
  } catch {}

  await fs.mkdir(notesDir, { recursive: true });

  // One-shot migration from the legacy cwd-relative location used in older builds
  const legacyFile = path.join(process.cwd(), 'notes', 'index.json');
  try {
    const legacy = await fs.readFile(legacyFile, 'utf-8');
    JSON.parse(legacy); // validate
    await fs.writeFile(dataFile, legacy);
    return;
  } catch {}

  await fs.writeFile(dataFile, JSON.stringify([]));
}

export async function loadNotes(): Promise<Note[]> {
  await initNotes();
  try {
    const data = await fs.readFile(getDataFile(), 'utf-8');
    return JSON.parse(data) as Note[];
  } catch {
    return [];
  }
}

async function saveNotes(notes: Note[]): Promise<void> {
  await fs.writeFile(getDataFile(), JSON.stringify(notes, null, 2));
}

export async function createNote(title: string, content: string): Promise<Note> {
  const notes = await loadNotes();
  const now = new Date().toISOString();
  const note: Note = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
    title,
    content,
    createdAt: now,
    updatedAt: now,
  };
  notes.push(note);
  await saveNotes(notes);
  return note;
}

export async function editNote(id: string, newTitle: string, newContent: string): Promise<Note | null> {
  const notes = await loadNotes();
  const index = notes.findIndex(n => n.id === id);
  if (index === -1) return null;
  notes[index] = {
    ...notes[index],
    title: newTitle,
    content: newContent,
    updatedAt: new Date().toISOString(),
  };
  await saveNotes(notes);
  return notes[index];
}

export async function deleteNote(id: string): Promise<boolean> {
  const notes = await loadNotes();
  const filtered = notes.filter(n => n.id !== id);
  if (filtered.length === notes.length) return false;
  await saveNotes(filtered);
  return true;
}

export async function setNoteFilePath(id: string, filePath: string): Promise<Note | null> {
  const notes = await loadNotes();
  const index = notes.findIndex(n => n.id === id);
  if (index === -1) return null;
  notes[index] = { ...notes[index], filePath };
  await saveNotes(notes);
  return notes[index];
}

export async function findNoteByFilePath(filePath: string): Promise<Note | null> {
  const notes = await loadNotes();
  return notes.find(n => n.filePath === filePath) || null;
}

export async function getNote(id: string): Promise<Note | null> {
  const notes = await loadNotes();
  return notes.find(n => n.id === id) || null;
}

export async function listNotes(): Promise<Note[]> {
  return await loadNotes();
}