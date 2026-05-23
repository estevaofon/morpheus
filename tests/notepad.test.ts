/**
 * @jest-environment node
 *
 * Unit tests for the notes data layer (src/notepad.ts): CRUD round-trips and
 * the corrupt-index recovery that protects the user's notes from a single bad
 * write. `electron`'s app.getPath is mocked to a throwaway temp directory so
 * the tests never touch the user's real notes store.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';

// Mocked lazily-read storage root. Must be `mock`-prefixed for jest to allow
// referencing it from the (hoisted) mock factory.
let mockDataRoot = '';
jest.mock('electron', () => ({
  app: { getPath: () => mockDataRoot },
}));

import * as notepad from '../src/notepad';

function freshTempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

let cwdSpy: jest.SpyInstance;

beforeEach(() => {
  mockDataRoot = freshTempDir('morpheus-data-');
  // initNotes() migrates from process.cwd()/notes/index.json when no store
  // exists yet. Point cwd at an empty dir so tests never read real notes.
  cwdSpy = jest.spyOn(process, 'cwd').mockReturnValue(freshTempDir('morpheus-cwd-'));
});

afterEach(() => {
  cwdSpy.mockRestore();
});

function notesDir(): string {
  return path.join(mockDataRoot, 'notes');
}

describe('createNote / listNotes', () => {
  it('persists a created note that listNotes then returns', async () => {
    const created = await notepad.createNote('Title', 'Body');
    expect(created.id).toBeTruthy();
    expect(created.title).toBe('Title');
    expect(created.content).toBe('Body');
    expect(created.createdAt).toBeTruthy();
    expect(created.updatedAt).toBe(created.createdAt);

    const all = await notepad.listNotes();
    expect(all).toHaveLength(1);
    expect(all[0].id).toBe(created.id);
  });

  it('returns an empty array for a brand-new store', async () => {
    expect(await notepad.listNotes()).toEqual([]);
  });

  it('gives each note a distinct id', async () => {
    const a = await notepad.createNote('a', '');
    const b = await notepad.createNote('b', '');
    expect(a.id).not.toBe(b.id);
    expect(await notepad.listNotes()).toHaveLength(2);
  });
});

describe('getNote', () => {
  it('returns the matching note', async () => {
    const created = await notepad.createNote('T', 'C');
    const fetched = await notepad.getNote(created.id);
    expect(fetched?.id).toBe(created.id);
  });

  it('returns null for an unknown id', async () => {
    expect(await notepad.getNote('does-not-exist')).toBeNull();
  });
});

describe('editNote', () => {
  it('updates title and content and bumps updatedAt', async () => {
    const created = await notepad.createNote('Old', 'Old body');
    await new Promise((r) => setTimeout(r, 5)); // ensure a later ISO timestamp
    const updated = await notepad.editNote(created.id, 'New', 'New body');
    expect(updated).not.toBeNull();
    expect(updated!.title).toBe('New');
    expect(updated!.content).toBe('New body');
    expect(updated!.createdAt).toBe(created.createdAt);
    expect(new Date(updated!.updatedAt).getTime()).toBeGreaterThanOrEqual(
      new Date(created.updatedAt).getTime(),
    );
  });

  it('returns null when editing an unknown id', async () => {
    expect(await notepad.editNote('nope', 't', 'c')).toBeNull();
  });
});

describe('deleteNote', () => {
  it('removes the note and reports success', async () => {
    const created = await notepad.createNote('T', 'C');
    expect(await notepad.deleteNote(created.id)).toBe(true);
    expect(await notepad.listNotes()).toEqual([]);
  });

  it('returns false for an unknown id', async () => {
    await notepad.createNote('T', 'C');
    expect(await notepad.deleteNote('nope')).toBe(false);
    expect(await notepad.listNotes()).toHaveLength(1);
  });
});

describe('setNoteFilePath / findNoteByFilePath', () => {
  it('binds a file path and finds the note by it', async () => {
    const created = await notepad.createNote('T', 'C');
    const updated = await notepad.setNoteFilePath(created.id, '/tmp/x.txt');
    expect(updated?.filePath).toBe('/tmp/x.txt');

    const found = await notepad.findNoteByFilePath('/tmp/x.txt');
    expect(found?.id).toBe(created.id);
  });

  it('returns null when no note tracks the path', async () => {
    expect(await notepad.findNoteByFilePath('/nope.txt')).toBeNull();
  });
});

describe('corrupt index recovery', () => {
  it('salvages the valid prefix when the index has trailing garbage', async () => {
    const valid = [
      {
        id: 'n1',
        title: 'Recovered',
        content: 'still here',
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      },
    ];
    const corruptRaw = JSON.stringify(valid) + 'TRAILING GARBAGE';

    fs.mkdirSync(notesDir(), { recursive: true });
    const indexFile = path.join(notesDir(), 'index.json');
    fs.writeFileSync(indexFile, corruptRaw);

    const recovered = await notepad.listNotes();
    expect(recovered).toHaveLength(1);
    expect(recovered[0].id).toBe('n1');
    expect(recovered[0].title).toBe('Recovered');

    // A quarantine backup of the bad file should have been written...
    const backups = fs
      .readdirSync(notesDir())
      .filter((f) => f.startsWith('index.json.corrupt-'));
    expect(backups.length).toBeGreaterThanOrEqual(1);

    // ...and the index rewritten to clean, re-parseable JSON.
    const rewritten = JSON.parse(fs.readFileSync(indexFile, 'utf-8'));
    expect(rewritten).toHaveLength(1);
  });
});
