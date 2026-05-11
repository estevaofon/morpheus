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
  const dataFile = getDataFile();
  let raw: string;
  try {
    raw = await fs.readFile(dataFile, 'utf-8');
  } catch {
    return [];
  }
  try {
    return JSON.parse(raw) as Note[];
  } catch {
    // Corrupt index — usually trailing garbage from an older, longer
    // file body that wasn't fully overwritten (e.g., OneDrive / AV
    // interference). Quarantine the bad file and try to salvage the
    // longest valid JSON-array prefix before falling back to empty.
    // Returning [] silently here would let the next save permanently
    // wipe the user's notes.
    const backupPath = `${dataFile}.corrupt-${Date.now()}`;
    try { await fs.writeFile(backupPath, raw); } catch {}
    const recovered = recoverNotesPrefix(raw);
    if (recovered) {
      try { await fs.writeFile(dataFile, JSON.stringify(recovered, null, 2)); } catch {}
      return recovered;
    }
    return [];
  }
}

/**
 * Scan backward through the buffer for the latest ']' position whose prefix
 * parses as a JSON array of notes. Lets us recover the user's data when the
 * file got tail-corrupted but the actual note records are intact.
 */
function recoverNotesPrefix(raw: string): Note[] | null {
  for (let i = raw.length - 1; i >= 0; i--) {
    if (raw.charCodeAt(i) !== 0x5d /* ']' */) continue;
    try {
      const parsed = JSON.parse(raw.substring(0, i + 1));
      if (Array.isArray(parsed)) return parsed as Note[];
    } catch {
      // try the next ']' further left
    }
  }
  return null;
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