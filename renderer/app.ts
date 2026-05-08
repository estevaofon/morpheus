// Matrix Notepad — Main App Logic

interface Note {
  id: string;
  title: string;
  content: string;
  createdAt: string;
  updatedAt: string;
  filePath?: string;
}

// State
let notes: Note[] = [];
let activeNoteId: string | null = null;
let isPreviewMode: boolean = false;
let inFlightCreate: Promise<void> | null = null;

// Find state
let activeMatchIndex: number = -1;

// DOM Elements
const notesListEl = document.getElementById('notes-list')!;
const searchInput = document.getElementById('search-input') as HTMLInputElement;
const noteTitleInput = document.getElementById('note-title') as HTMLInputElement;
const noteContentInput = document.getElementById('note-content') as HTMLDivElement;
const notePreviewEl = document.getElementById('note-preview') as HTMLDivElement;
const previewBtn = document.getElementById('btn-preview') as HTMLButtonElement;
const statusText = document.getElementById('status-text')!;
const charCount = document.getElementById('char-count')!;
const lineCount = document.getElementById('line-count')!;
const lineNumbersEl = document.getElementById('line-numbers')!;

// ============================================
// EDITOR ABSTRACTION (contenteditable div)
// ============================================
// Like VSCode, the visible editor IS the rendered DOM. We don't overlay a
// transparent <textarea> on top of a colored layer — clicks land on the
// same nodes that show the syntax highlighting, so caret positioning is
// always pixel-correct.

/** Read the editor's text content (works whether it's plain text or has token spans). */
function getEditorValue(): string {
  return getTextFromContenteditable(noteContentInput);
}

/**
 * Reading textContent from a contenteditable concatenates child text nodes,
 * but doesn't reliably emit "\n" between block-level children that the
 * browser may insert (e.g., a <div> per line on Enter). plaintext-only
 * mostly avoids that, but we still normalize defensively.
 */
function getTextFromContenteditable(el: HTMLElement): string {
  return el.textContent ?? '';
}

/** Replace the editor's content with plain text (clears any HTML). */
function setEditorValue(text: string): void {
  noteContentInput.textContent = text;
}

/** Replace the editor's content with HTML (used to apply syntax highlighting). */
function setEditorHTML(html: string): void {
  noteContentInput.innerHTML = html;
}

/**
 * Get the caret as character offsets relative to the editor's full text.
 * Uses Range#toString() length — unlike Node iteration this matches what
 * textContent reports, so saving and restoring through tokenization is
 * idempotent for non-collapsed selections too.
 */
function getCaretOffset(): { start: number; end: number } {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return { start: 0, end: 0 };
  const range = sel.getRangeAt(0);
  if (!noteContentInput.contains(range.startContainer)) return { start: 0, end: 0 };

  const preStart = range.cloneRange();
  preStart.selectNodeContents(noteContentInput);
  preStart.setEnd(range.startContainer, range.startOffset);
  const start = preStart.toString().length;

  const preEnd = range.cloneRange();
  preEnd.selectNodeContents(noteContentInput);
  preEnd.setEnd(range.endContainer, range.endOffset);
  const end = preEnd.toString().length;

  return { start, end };
}

/**
 * Place the caret at character offset(s) within the editor. Walks text
 * nodes in document order, charging their lengths against the target
 * offsets. If the requested offset is beyond the end of the content, we
 * collapse at the end instead of throwing.
 */
function setCaretOffset(start: number, end: number = start): void {
  const sel = window.getSelection();
  if (!sel) return;
  const range = document.createRange();

  let charCount = 0;
  let startSet = false;
  let endSet = false;

  function visit(node: Node): void {
    if (startSet && endSet) return;
    if (node.nodeType === Node.TEXT_NODE) {
      const len = (node.textContent ?? '').length;
      const next = charCount + len;
      if (!startSet && next >= start) {
        range.setStart(node, Math.max(0, start - charCount));
        startSet = true;
      }
      if (!endSet && next >= end) {
        range.setEnd(node, Math.max(0, end - charCount));
        endSet = true;
      }
      charCount = next;
      return;
    }
    for (const child of Array.from(node.childNodes)) {
      visit(child);
      if (startSet && endSet) return;
    }
  }
  visit(noteContentInput);

  if (!startSet) {
    range.selectNodeContents(noteContentInput);
    range.collapse(false);
  } else if (!endSet) {
    range.setEnd(range.startContainer, range.startOffset);
  }

  sel.removeAllRanges();
  sel.addRange(range);
}

// ============================================
// UNDO / REDO
// ============================================
// Re-setting innerHTML to apply syntax highlighting wipes the browser's
// native undo history, so Ctrl+Z stops working. We maintain our own
// snapshot stack instead — one snapshot per "burst" of typing (coalesced
// by a 500ms idle window) so pressing undo rewinds to the start of the
// last edit, not character by character.

interface UndoSnapshot {
  value: string;
  caretStart: number;
  caretEnd: number;
}

const UNDO_LIMIT = 200;
const UNDO_COALESCE_MS = 500;
let undoStack: UndoSnapshot[] = [];
let redoStack: UndoSnapshot[] = [];
let lastSnapshotTime = 0;

/** Capture the editor's current state into the undo stack (no coalescing). */
function snapshotEditorState(): void {
  const value = getEditorValue();
  const caret = getCaretOffset();
  // Always update the timestamp — including on no-op snapshots — so
  // back-to-back keystrokes coalesce instead of each one re-entering the
  // "stale, snapshot now" branch of maybeSnapshotForBurst.
  lastSnapshotTime = Date.now();
  const top = undoStack[undoStack.length - 1];
  if (top && top.value === value) {
    // Same content — refresh the snapshot's caret so undo restores the
    // user's *current* position rather than wherever it was when this
    // snapshot was first taken. Critical for the baseline snapshot
    // captured at note load (caret defaults to 0): without this, an
    // undo from an edit deep in the file would yank the caret to the
    // top of the file.
    top.caretStart = caret.start;
    top.caretEnd = caret.end;
    return;
  }
  undoStack.push({ value, caretStart: caret.start, caretEnd: caret.end });
  if (undoStack.length > UNDO_LIMIT) undoStack.shift();
  redoStack.length = 0;
}

/**
 * Snapshot iff we haven't snapshotted recently — called from beforeinput
 * so the first keystroke of a burst captures the pre-edit state, then
 * subsequent keystrokes within 500ms are absorbed into that one undo step.
 */
function maybeSnapshotForBurst(): void {
  const now = Date.now();
  if (now - lastSnapshotTime < UNDO_COALESCE_MS && undoStack.length > 0) {
    lastSnapshotTime = now;
    return;
  }
  snapshotEditorState();
}

/** Reset the stack to a single baseline snapshot (used on note load). */
function resetUndoTo(value: string, caretStart = 0, caretEnd = 0): void {
  undoStack = [{ value, caretStart, caretEnd }];
  redoStack = [];
  lastSnapshotTime = 0;
}

function performUndo(): void {
  // Need at least 2 entries: the baseline and the post-edit state we want
  // to roll back from. Snapshot now if a burst is mid-flight so we can
  // pop off a meaningful step.
  if (undoStack.length === 0) return;
  const currentValue = getEditorValue();
  const top = undoStack[undoStack.length - 1];
  if (top.value !== currentValue) {
    // Pending burst not yet snapshotted — capture it so the user can
    // get back here via redo.
    const caret = getCaretOffset();
    undoStack.push({ value: currentValue, caretStart: caret.start, caretEnd: caret.end });
  }
  if (undoStack.length < 2) return;
  const popped = undoStack.pop()!;
  redoStack.push(popped);
  const target = undoStack[undoStack.length - 1];
  restoreSnapshot(target);
  lastSnapshotTime = Date.now();
}

function performRedo(): void {
  const next = redoStack.pop();
  if (!next) return;
  undoStack.push(next);
  restoreSnapshot(next);
  lastSnapshotTime = Date.now();
}

function restoreSnapshot(snap: UndoSnapshot): void {
  setEditorValue(snap.value);
  applyEditorHighlighting();
  setCaretOffset(snap.caretStart, snap.caretEnd);
  updateCounts(snap.value);
  // Bring caret into view in case it ended up off-screen.
  const sel = window.getSelection();
  if (sel && sel.rangeCount > 0) {
    const range = sel.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    const editorRect = noteContentInput.getBoundingClientRect();
    if (rect.top < editorRect.top || rect.bottom > editorRect.bottom) {
      const offset = rect.top - editorRect.top - editorRect.height / 2;
      noteContentInput.scrollTop += offset;
    }
  }
}

function updateCounts(text: string): void {
  charCount.textContent = `${text.length} chars`;
  const lines = text.length === 0 ? 1 : text.split(/\r\n|\r|\n/).length;
  lineCount.textContent = `${lines} lines`;
  renderLineNumbers(lines);
}

function renderLineNumbers(count: number): void {
  const parts = new Array(count);
  for (let i = 0; i < count; i++) parts[i] = String(i + 1);
  lineNumbersEl.textContent = parts.join('\n');
}

// Confirm modal elements
const confirmModal = document.getElementById('confirm-modal') as HTMLDivElement;
const confirmModalMessage = document.getElementById('confirm-modal-message') as HTMLDivElement;
const confirmModalOk = document.getElementById('confirm-modal-ok') as HTMLButtonElement;
const confirmModalCancel = document.getElementById('confirm-modal-cancel') as HTMLButtonElement;

// Preferences modal elements
const preferencesBtn = document.getElementById('btn-preferences') as HTMLButtonElement;
const preferencesModal = document.getElementById('preferences-modal') as HTMLDivElement;
const preferencesModalClose = document.getElementById('preferences-modal-close') as HTMLButtonElement;
const fontColorRadios = document.querySelectorAll<HTMLInputElement>('input[name="pref-font-color"]');
const themeRadios = document.querySelectorAll<HTMLInputElement>('input[name="pref-theme"]');

// Find bar elements
const findBar = document.getElementById('find-bar') as HTMLDivElement;
const findInput = document.getElementById('find-input') as HTMLInputElement;
const findCase = document.getElementById('find-case') as HTMLInputElement;
const findMatchCount = document.getElementById('find-match-count') as HTMLSpanElement;
const findPrevBtn = document.getElementById('find-prev') as HTMLButtonElement;
const findNextBtn = document.getElementById('find-next') as HTMLButtonElement;
const findCloseBtn = document.getElementById('find-close') as HTMLButtonElement;
const findBtn = document.getElementById('btn-find') as HTMLButtonElement;

// Window Controls
document.getElementById('btn-minimize')?.addEventListener('click', () => window.electronAPI.minimize());
document.getElementById('btn-maximize')?.addEventListener('click', () => window.electronAPI.maximize());
document.getElementById('btn-close')?.addEventListener('click', () => window.electronAPI.close());

// New Note
document.getElementById('btn-new')?.addEventListener('click', () => createNewNote());

// Save Note (Shift+click forces Save As)
document.getElementById('btn-save')?.addEventListener('click', (e) => {
  if ((e as MouseEvent).shiftKey) saveAsCurrentNote();
  else saveCurrentNote();
});

// Open File
document.getElementById('btn-open')?.addEventListener('click', () => openFileFlow());

// Delete Note
document.getElementById('btn-delete')?.addEventListener('click', () => deleteCurrentNote());

// Markdown Viewer toggle
previewBtn?.addEventListener('click', () => togglePreview());

// Auto-create note as soon as the user starts typing a title
noteTitleInput.addEventListener('input', () => {
  if (noteTitleInput.value) void ensureActiveNote();
  // Title may toggle .py extension → re-evaluate Python mode.
  applyEditorHighlighting();
});

// Auto-save title on Enter or blur
noteTitleInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    saveTitle();
    noteContentInput.focus();
  }
});
noteTitleInput.addEventListener('blur', () => saveTitle());

// Persist content on blur so nothing is lost when focus leaves the editor
noteContentInput.addEventListener('blur', () => persistCurrentNote());

// Find bar toggle
findBtn?.addEventListener('click', () => showFindBar());
findCloseBtn?.addEventListener('click', () => hideFindBar());

// Find input events
findInput?.addEventListener('input', () => performFind());
findInput?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    if (e.shiftKey) navigateFind(-1);
    else navigateFind(1);
  }
  if (e.key === 'Escape') hideFindBar();
});
findCase?.addEventListener('change', () => performFind());
findPrevBtn?.addEventListener('click', () => navigateFind(-1));
findNextBtn?.addEventListener('click', () => navigateFind(1));

// Character count + auto-create note on first keystroke
noteContentInput.addEventListener('input', () => {
  const value = getEditorValue();
  updateCounts(value);
  if (value) void ensureActiveNote();
  // Re-tokenize Python files in place. Caret offset is preserved across
  // the innerHTML replacement.
  applyEditorHighlighting();
  // Re-run find if find bar is open
  if (findBar.style.display === 'flex') performFind();
});

noteContentInput.addEventListener('scroll', () => {
  lineNumbersEl.scrollTop = noteContentInput.scrollTop;
});

// Snapshot the pre-edit state on every input — coalesced by time, so a
// burst of typing produces one undo step, not one per character.
noteContentInput.addEventListener('beforeinput', () => {
  maybeSnapshotForBurst();
});

// Editor-scoped Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z. We have to handle these
// ourselves because applyEditorHighlighting() rewrites innerHTML, which
// trashes the browser's native undo history.
noteContentInput.addEventListener('keydown', (e) => {
  const ctrl = e.ctrlKey || e.metaKey;
  if (!ctrl) return;
  if (e.key === 'z' && !e.shiftKey) {
    e.preventDefault();
    performUndo();
  } else if ((e.key === 'y') || (e.key === 'z' && e.shiftKey)) {
    e.preventDefault();
    performRedo();
  }
});

// Tab key inserts 2 spaces instead of changing focus.
noteContentInput.addEventListener('keydown', (e) => {
  if (e.key !== 'Tab') return;
  e.preventDefault();
  // Tab is a structural edit — record state before mutating.
  snapshotEditorState();
  const value = getEditorValue();
  const { start, end } = getCaretOffset();

  if (start !== end && value.substring(start, end).includes('\n')) {
    // Multi-line selection: indent every line in the range.
    const selected = value.substring(start, end);
    const indented = selected.replace(/^/gm, '  ');
    setEditorValue(value.substring(0, start) + indented + value.substring(end));
    applyEditorHighlighting();
    setCaretOffset(start, start + indented.length);
  } else {
    // Single position (or single-line selection): just insert two spaces.
    setEditorValue(value.substring(0, start) + '  ' + value.substring(end));
    applyEditorHighlighting();
    setCaretOffset(start + 2);
  }

  // Trigger input handlers (char count, find re-run).
  noteContentInput.dispatchEvent(new Event('input', { bubbles: true }));
});

// Search (filter notes in sidebar)
searchInput.addEventListener('input', () => {
  const query = searchInput.value.toLowerCase();
  renderNotesList(query);
});

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'S' || e.key === 's')) {
    e.preventDefault();
    saveAsCurrentNote();
    return;
  }
  if ((e.ctrlKey || e.metaKey) && e.key === 's') {
    e.preventDefault();
    saveCurrentNote();
  }
  if ((e.ctrlKey || e.metaKey) && (e.key === 'o' || e.key === 'O')) {
    e.preventDefault();
    openFileFlow();
  }
  if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
    e.preventDefault();
    showFindBar();
  }
  if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'P' || e.key === 'p')) {
    e.preventDefault();
    togglePreview();
  }
  if ((e.ctrlKey || e.metaKey) && e.key === ',') {
    e.preventDefault();
    showPreferences();
  }
  if (e.key === 'Escape' && preferencesModal.style.display === 'flex') {
    e.preventDefault();
    hidePreferences();
  }
});

// Preferences wiring
preferencesBtn?.addEventListener('click', () => showPreferences());
preferencesModalClose?.addEventListener('click', () => hidePreferences());
preferencesModal?.addEventListener('click', (e) => {
  if (e.target === preferencesModal) hidePreferences();
});
fontColorRadios.forEach(radio => {
  radio.addEventListener('change', () => {
    if (radio.checked) {
      const color = radio.value === 'white' ? 'white' : 'green';
      const prefs = loadPreferences();
      prefs.fontColor = color;
      savePreferences(prefs);
      applyFontColor(color);
    }
  });
});

themeRadios.forEach(radio => {
  radio.addEventListener('change', () => {
    if (radio.checked) {
      const theme: Theme = radio.value === 'vscode' ? 'vscode' : 'matrix';
      const prefs = loadPreferences();
      prefs.theme = theme;
      savePreferences(prefs);
      applyTheme(theme);
    }
  });
});

/**
 * Load all notes from main process
 */
async function loadNotes(): Promise<void> {
  notes = await window.electronAPI.listNotes();
  renderNotesList();
  setStatus(`Loaded ${notes.length} note${notes.length !== 1 ? 's' : ''} from the Matrix.`);
}

/**
 * Render notes list in sidebar
 */
function renderNotesList(filter: string = ''): void {
  const filtered = notes.filter(n =>
    n.title.toLowerCase().includes(filter) ||
    n.content.toLowerCase().includes(filter)
  );

  if (filtered.length === 0) {
    notesListEl.innerHTML = `
      <div class="empty-state">
        <svg class="empty-state-icon" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
          <polyline points="14 2 14 8 20 8"/>
        </svg>
        <div class="empty-state-text">${filter ? 'No matching notes' : 'No notes yet'}</div>
      </div>
    `;
    return;
  }

  notesListEl.innerHTML = filtered
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    .map(note => {
      const date = new Date(note.updatedAt).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
      const preview = note.content.substring(0, 60).replace(/\n/g, ' ') || '(empty)';
      const isActive = note.id === activeNoteId;

      const displayTitle = truncateMiddle(note.title || '(untitled)', 42);
      const titleHtml = filter ? highlightText(displayTitle, filter) : escapeHtml(displayTitle);
      const previewHtml = filter ? highlightText(preview, filter) : escapeHtml(preview);
      const titleAttr = escapeHtml(note.title || '');

      return `
        <div class="note-item ${isActive ? 'active' : ''}" data-id="${note.id}" title="${titleAttr}">
          <div class="note-item-title">${titleHtml}</div>
          <div class="note-item-preview">${previewHtml}</div>
          <div class="note-item-date">${date}</div>
        </div>
      `;
    }).join('');

  notesListEl.querySelectorAll('.note-item').forEach(el => {
    el.addEventListener('click', () => {
      const id = (el as HTMLElement).dataset.id!;
      selectNote(id);
    });
  });
}

/**
 * Select a note to view/edit
 */
async function selectNote(id: string): Promise<void> {
  if (activeNoteId && activeNoteId !== id) {
    await persistCurrentNote();
  }
  activeNoteId = id;
  const note = await window.electronAPI.getNote(id);
  if (note) {
    noteTitleInput.value = note.title;
    setEditorValue(note.content);
    updateCounts(note.content);
    applyEditorHighlighting();
    // Reset undo history to this note's loaded content as the baseline.
    resetUndoTo(note.content);
    renderNotesList(searchInput.value.toLowerCase());
    setStatus(`> Viewing: ${note.title}`);
    hideFindBar();
    if (isPreviewMode) renderPreview();
  }
}

/**
 * Create a new blank note
 */
async function createNewNote(): Promise<void> {
  const note = await window.electronAPI.createNote('', '');
  activeNoteId = note.id;
  await loadNotes();
  await selectNote(note.id);
  noteTitleInput.focus();
  setStatus('> New note created.');
}

/**
 * Ensure there's an active note to edit. If none exists yet, create an empty
 * one in the store and adopt it as the active note without touching the inputs
 * (so whatever the user typed so far is preserved). Concurrent callers share
 * the same in-flight creation so we never create duplicates.
 */
async function ensureActiveNote(): Promise<void> {
  if (activeNoteId) return;
  if (!inFlightCreate) {
    inFlightCreate = (async () => {
      try {
        const note = await window.electronAPI.createNote('', '');
        activeNoteId = note.id;
        notes = await window.electronAPI.listNotes();
        renderNotesList(searchInput.value.toLowerCase());
      } finally {
        inFlightCreate = null;
      }
    })();
  }
  await inFlightCreate;
}

/**
 * Save just the title if it has changed
 */
async function saveTitle(): Promise<void> {
  const newTitle = noteTitleInput.value.trim();
  if (!activeNoteId) {
    if (!newTitle) return;
    await ensureActiveNote();
  }
  if (!activeNoteId) return;
  const currentNote = notes.find(n => n.id === activeNoteId);
  if (!currentNote || currentNote.title === newTitle) return;

  const updated = await window.electronAPI.editNote(activeNoteId, newTitle, getEditorValue());
  if (updated) {
    await loadNotes();
    setStatus('> Title saved.');
  }
}

/**
 * Persist current note (title + content) to the store if anything changed
 */
async function persistCurrentNote(): Promise<void> {
  const newTitle = noteTitleInput.value.trim();
  const newContent = getEditorValue();

  if (!activeNoteId) {
    if (!newTitle && !newContent) return;
    await ensureActiveNote();
  }
  if (!activeNoteId) return;

  const currentNote = notes.find(n => n.id === activeNoteId);
  if (!currentNote) return;
  if (currentNote.title === newTitle && currentNote.content === newContent) return;

  const updated = await window.electronAPI.editNote(activeNoteId, newTitle, newContent);
  if (updated) {
    notes = await window.electronAPI.listNotes();
  }
}

/**
 * Flash the save button for visual feedback
 */
function flashSaveBtn(): void {
  const saveBtn = document.getElementById('btn-save')!;
  saveBtn.classList.add('flash');
  setTimeout(() => saveBtn.classList.remove('flash'), 500);
}

/**
 * Apply save result: update note filePath, title, UI
 */
async function applySaveResult(filePath: string, content: string): Promise<void> {
  if (!activeNoteId) return;
  await window.electronAPI.setNoteFilePath(activeNoteId, filePath);
  await window.electronAPI.editNote(activeNoteId, filePath, content);
  noteTitleInput.value = filePath;
  notes = await window.electronAPI.listNotes();
  renderNotesList(searchInput.value.toLowerCase());
  applyEditorHighlighting();
}

/**
 * Save — writes directly to the existing filePath if any, otherwise opens Save As dialog.
 */
async function saveCurrentNote(): Promise<void> {
  await saveTitle();
  const content = getEditorValue();
  const currentNote = activeNoteId ? notes.find(n => n.id === activeNoteId) : null;
  const existingPath = currentNote?.filePath;

  if (!existingPath) {
    await saveAsCurrentNote();
    return;
  }

  try {
    const result = await window.electronAPI.saveFile(existingPath, content);
    if (result.success && result.filePath) {
      await applySaveResult(result.filePath, content);
      setStatus(`> Saved to ${result.filePath}`);
    } else {
      setStatus(`> Error saving: ${result.error}`);
    }
  } catch (err) {
    console.error('Save error:', err);
    setStatus(`> Error saving: ${String(err)}`);
  }

  flashSaveBtn();
}

/**
 * Save As — always opens the native dialog, even if the note already has a filePath.
 */
async function saveAsCurrentNote(): Promise<void> {
  await saveTitle();
  const content = getEditorValue();
  const currentNote = activeNoteId ? notes.find(n => n.id === activeNoteId) : null;
  const existingPath = currentNote?.filePath;

  // Pull the note title as a default filename for the dialog. If the title is
  // currently just mirroring the existing file path (the default shown after a
  // previous save) we skip it so we don't round-trip the full path as a name.
  const rawTitle = noteTitleInput.value.trim();
  const suggestedName = rawTitle && rawTitle !== existingPath
    ? sanitizeFilename(rawTitle)
    : undefined;

  try {
    const result = await window.electronAPI.saveAs(content, existingPath, suggestedName);
    if (result.success && result.filePath) {
      await applySaveResult(result.filePath, content);
      setStatus(`> Saved to ${result.filePath}`);
    } else if (result.filePath === null && !result.error) {
      setStatus('> Save cancelled.');
    } else {
      setStatus(`> Error saving: ${result.error}`);
    }
  } catch (err) {
    console.error('Save error:', err);
    setStatus(`> Error saving: ${String(err)}`);
  }

  flashSaveBtn();
}

/**
 * Strip characters that are invalid on Windows/macOS/Linux filenames.
 */
function sanitizeFilename(name: string): string {
  return name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim().slice(0, 200);
}

/**
 * Open a file from disk — if a note already tracks it, select that note; otherwise create a new one.
 */
async function openFileFlow(): Promise<void> {
  try {
    const result = await window.electronAPI.openFile();
    if (!result) {
      setStatus('> Open cancelled.');
      return;
    }
    if ('error' in result) {
      setStatus(`> Error opening: ${result.error}`);
      return;
    }
    await loadFileIntoEditor(result.filePath, result.content);
  } catch (err) {
    console.error('Open error:', err);
    setStatus(`> Error opening: ${String(err)}`);
  }
}

/**
 * Adopt a file (path + content) as the active note — reuse an existing one if it
 * tracks the same path, otherwise create a fresh note bound to the path.
 */
async function loadFileIntoEditor(filePath: string, content: string): Promise<void> {
  const existing = await window.electronAPI.findNoteByFilePath(filePath);
  if (existing) {
    notes = await window.electronAPI.listNotes();
    await selectNote(existing.id);
    setStatus(`> Opened existing note for ${filePath}`);
    return;
  }

  const created = await window.electronAPI.createNote(filePath, content);
  await window.electronAPI.setNoteFilePath(created.id, filePath);
  notes = await window.electronAPI.listNotes();
  await selectNote(created.id);
  setStatus(`> Loaded ${filePath}`);
}

window.electronAPI.onOpenExternalFile(async (payload) => {
  if ('error' in payload) {
    setStatus(`> Error opening ${payload.filePath}: ${payload.error}`);
    return;
  }
  try {
    await loadFileIntoEditor(payload.filePath, payload.content);
  } catch (err) {
    console.error('External open error:', err);
    setStatus(`> Error opening: ${String(err)}`);
  }
});

/**
 * Delete current note
 */
async function deleteCurrentNote(): Promise<void> {
  if (!activeNoteId) {
    setStatus('> No note selected.');
    return;
  }

  const confirmed = await customConfirm('Delete this note from the Matrix?');
  if (!confirmed) {
    noteContentInput.focus();
    return;
  }

  const deletedId = activeNoteId;
  const deleted = await window.electronAPI.deleteNote(deletedId);
  if (!deleted) return;

  notes = await window.electronAPI.listNotes();
  const nextNote = notes
    .filter(n => n.id !== deletedId)
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())[0];

  if (nextNote) {
    await selectNote(nextNote.id);
    noteContentInput.focus();
    setStatus('> Note deleted from the Matrix.');
  } else {
    activeNoteId = null;
    noteTitleInput.value = '';
    setEditorValue('');
    updateCounts('');
    applyEditorHighlighting();
    resetUndoTo('');
    renderNotesList(searchInput.value.toLowerCase());
    noteTitleInput.focus();
    setStatus('> Note deleted. No notes in the Matrix.');
  }
}

// ============================================
// MARKDOWN PREVIEW
// ============================================

function togglePreview(): void {
  if (!isPreviewMode) {
    if (!activeNoteId && !getEditorValue()) {
      setStatus('> Open or write a note first.');
      return;
    }
    renderPreview();
    noteContentInput.style.display = 'none';
    notePreviewEl.style.display = 'block';
    previewBtn.classList.add('active');
    previewBtn.title = 'Edit (Ctrl+Shift+P)';
    isPreviewMode = true;
    lineCount.style.display = 'none';
    lineNumbersEl.style.display = 'none';
    setStatus('> Preview mode.');

    if (findBar.style.display === 'flex') {
      performFind();
      findInput.focus();
    }
  } else {
    notePreviewEl.style.display = 'none';
    noteContentInput.style.display = '';
    previewBtn.classList.remove('active');
    previewBtn.title = 'Markdown Viewer (Ctrl+Shift+P)';
    isPreviewMode = false;
    lineCount.style.display = '';
    lineNumbersEl.style.display = '';
    setStatus('> Edit mode.');

    applyEditorHighlighting();
    if (findBar.style.display === 'flex') {
      performFind();
      findInput.focus();
    } else {
      noteContentInput.focus();
    }
  }
}

let mermaidRenderCounter = 0;

function renderPreview(): void {
  const raw = getEditorValue();
  const html = window.marked.parse(raw);
  notePreviewEl.innerHTML = window.DOMPurify.sanitize(html, {
    ADD_ATTR: ['target'],
  });
  highlightPythonBlocks();
  void renderMermaidBlocks();
}

function highlightPythonBlocks(): void {
  const blocks = notePreviewEl.querySelectorAll<HTMLElement>(
    'pre > code.language-python, pre > code.language-py'
  );
  for (const code of Array.from(blocks)) {
    const source = code.textContent || '';
    code.innerHTML = tokenizePython(source);
  }
}

async function renderMermaidBlocks(): Promise<void> {
  const blocks = notePreviewEl.querySelectorAll<HTMLElement>('pre > code.language-mermaid');
  if (blocks.length === 0) return;

  for (const code of Array.from(blocks)) {
    const pre = code.parentElement;
    if (!pre) continue;
    const source = code.textContent || '';
    const container = document.createElement('div');
    container.className = 'mermaid-diagram';

    try {
      mermaidRenderCounter += 1;
      const { svg } = await window.mermaid.render(
        `mermaid-svg-${Date.now()}-${mermaidRenderCounter}`,
        source
      );
      container.innerHTML = svg;
    } catch (err) {
      container.classList.add('mermaid-error');
      const message = err instanceof Error ? err.message : String(err);
      container.textContent = `> Mermaid error: ${message}`;
    }

    pre.replaceWith(container);
  }
}

// ============================================
// FIND IN CONTENT
// ============================================

// Find marks live INSIDE the contenteditable now (or inside the markdown
// preview, depending on mode). We track them as DOM elements so navigation
// can toggle the active class and scroll without re-running the search.
let findMarkElements: HTMLElement[] = [];

function showFindBar(): void {
  if (!activeNoteId) {
    setStatus('> Open a note first.');
    return;
  }
  findBar.style.display = 'flex';
  findInput.focus();

  const selection = window.getSelection()?.toString() || '';
  if (selection) {
    findInput.value = selection;
  }
  performFind();
}

function hideFindBar(): void {
  findBar.style.display = 'none';
  findInput.value = '';
  findMatchCount.textContent = '0 matches';
  findMarkElements = [];
  activeMatchIndex = -1;
  if (isPreviewMode) {
    renderPreview();
  } else {
    // Re-applying highlighting also wipes any <mark> nodes we inserted.
    applyEditorHighlighting();
    noteContentInput.focus();
  }
}

function performFind(): void {
  findMarkElements = [];
  activeMatchIndex = -1;

  const query = findInput.value;
  if (!query) {
    findMatchCount.textContent = '0 matches';
    if (isPreviewMode) renderPreview();
    else applyEditorHighlighting();
    return;
  }

  // Wipe any previous marks before re-searching.
  if (isPreviewMode) {
    renderPreview();
    findMarkElements = wrapMatchesInElement(notePreviewEl, query, findCase.checked);
  } else {
    applyEditorHighlighting();
    findMarkElements = wrapMatchesInElement(noteContentInput, query, findCase.checked);
  }

  const count = findMarkElements.length;
  findMatchCount.textContent = count === 0 ? '0 matches' : `1/${count}`;

  if (count > 0) {
    activeMatchIndex = 0;
    setActiveMark(0);
  }
}

/**
 * Walk all text nodes under `root` and wrap every occurrence of `query`
 * (case-insensitive unless `caseSensitive`) in a <mark class="find-mark">.
 * Splits text nodes around matches so syntax-token spans stay intact.
 */
function wrapMatchesInElement(root: HTMLElement, query: string, caseSensitive: boolean): HTMLElement[] {
  const marks: HTMLElement[] = [];
  if (!query) return marks;

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];
  let current: Node | null;
  while ((current = walker.nextNode())) {
    // Skip text nodes that are already inside a find-mark to avoid
    // re-wrapping (defensive; we only call this on a fresh tree).
    const parent = current.parentElement;
    if (parent?.classList.contains('find-mark')) continue;
    textNodes.push(current as Text);
  }

  const lowerQuery = caseSensitive ? query : query.toLowerCase();

  for (const node of textNodes) {
    const text = node.nodeValue || '';
    if (!text) continue;
    const haystack = caseSensitive ? text : text.toLowerCase();
    let idx = haystack.indexOf(lowerQuery);
    if (idx === -1) continue;

    const parent = node.parentNode;
    if (!parent) continue;

    const fragment = document.createDocumentFragment();
    let last = 0;
    while (idx !== -1) {
      if (idx > last) {
        fragment.appendChild(document.createTextNode(text.substring(last, idx)));
      }
      const mark = document.createElement('mark');
      mark.className = 'find-mark';
      mark.textContent = text.substring(idx, idx + query.length);
      fragment.appendChild(mark);
      marks.push(mark);
      last = idx + query.length;
      idx = haystack.indexOf(lowerQuery, last);
    }
    if (last < text.length) {
      fragment.appendChild(document.createTextNode(text.substring(last)));
    }
    parent.replaceChild(fragment, node);
  }
  return marks;
}

function navigateFind(direction: number): void {
  const count = findMarkElements.length;
  if (count === 0) return;

  activeMatchIndex += direction;
  if (activeMatchIndex < 0) activeMatchIndex = count - 1;
  if (activeMatchIndex >= count) activeMatchIndex = 0;

  setActiveMark(activeMatchIndex);
  findMatchCount.textContent = `${activeMatchIndex + 1}/${count}`;
}

function setActiveMark(idx: number): void {
  findMarkElements.forEach((m, i) => {
    m.classList.toggle('find-mark-active', i === idx);
  });
  const target = findMarkElements[idx];
  if (!target) return;
  target.scrollIntoView({ behavior: 'smooth', block: 'center' });

  // In edit mode also drop the caret onto the match so Esc → keep typing
  // resumes from the right position.
  if (!isPreviewMode) {
    const range = document.createRange();
    range.selectNodeContents(target);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  }
}

// ============================================
// PREFERENCES
// ============================================

type FontColor = 'green' | 'white';
type Theme = 'matrix' | 'vscode';
interface Preferences {
  fontColor: FontColor;
  theme: Theme;
}

const PREFS_KEY = 'morpheus:preferences';
const DEFAULT_PREFS: Preferences = { fontColor: 'green', theme: 'matrix' };

function loadPreferences(): Preferences {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      const fontColor: FontColor =
        parsed?.fontColor === 'white' ? 'white' : 'green';
      const theme: Theme =
        parsed?.theme === 'vscode' ? 'vscode' : 'matrix';
      return { fontColor, theme };
    }
  } catch {
    // fall through to defaults
  }
  return { ...DEFAULT_PREFS };
}

function savePreferences(prefs: Preferences): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch (err) {
    console.error('Failed to save preferences:', err);
  }
}

function applyFontColor(color: FontColor): void {
  document.body.classList.toggle('font-color-white', color === 'white');
}

function applyTheme(theme: Theme): void {
  document.body.classList.toggle('theme-vscode', theme === 'vscode');
}

function showPreferences(): void {
  const prefs = loadPreferences();
  fontColorRadios.forEach(r => { r.checked = r.value === prefs.fontColor; });
  themeRadios.forEach(r => { r.checked = r.value === prefs.theme; });
  preferencesModal.style.display = 'flex';
  preferencesModalClose.focus();
}

function hidePreferences(): void {
  preferencesModal.style.display = 'none';
  noteContentInput.focus();
}

/**
 * In-app confirm modal — returns a Promise<boolean>
 */
function customConfirm(message: string): Promise<boolean> {
  return new Promise((resolve) => {
    confirmModalMessage.textContent = message;
    confirmModal.style.display = 'flex';
    confirmModalOk.focus();

    const cleanup = (result: boolean) => {
      confirmModal.style.display = 'none';
      confirmModalOk.removeEventListener('click', onOk);
      confirmModalCancel.removeEventListener('click', onCancel);
      document.removeEventListener('keydown', onKey);
      resolve(result);
    };
    const onOk = () => cleanup(true);
    const onCancel = () => cleanup(false);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); cleanup(false); }
      if (e.key === 'Enter') { e.preventDefault(); cleanup(true); }
    };

    confirmModalOk.addEventListener('click', onOk);
    confirmModalCancel.addEventListener('click', onCancel);
    document.addEventListener('keydown', onKey);
  });
}

/**
 * Set status bar text
 */
function setStatus(text: string): void {
  statusText.textContent = text;
}

/**
 * Escape HTML to prevent XSS
 */
function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * Highlight matching search terms in text
 */
function highlightText(text: string, query: string): string {
  if (!query) return escapeHtml(text);
  const escaped = escapeHtml(text);
  const escapedQuery = escapeHtml(query);
  const regex = new RegExp(`(${escapeRegex(escapedQuery)})`, 'gi');
  return escaped.replace(regex, '<span class="search-highlight">$1</span>');
}

/**
 * Escape special regex characters
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Truncate a string in the middle, preserving head and tail.
 * Useful for file paths: "C:\Users\foo\bar\baz.txt" → "C:\Users\f…ar\baz.txt"
 */
function truncateMiddle(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  const keep = Math.max(1, Math.floor((maxLen - 1) / 2));
  return text.slice(0, keep) + '…' + text.slice(text.length - keep);
}

// ============================================
// PYTHON SYNTAX HIGHLIGHTING
// ============================================

const PY_KEYWORDS = new Set([
  'False', 'None', 'True', 'and', 'as', 'assert', 'async', 'await',
  'break', 'class', 'continue', 'def', 'del', 'elif', 'else', 'except',
  'finally', 'for', 'from', 'global', 'if', 'import', 'in', 'is',
  'lambda', 'nonlocal', 'not', 'or', 'pass', 'raise', 'return', 'try',
  'while', 'with', 'yield', 'match', 'case',
]);

const PY_BUILTINS = new Set([
  'abs', 'all', 'any', 'ascii', 'bin', 'bool', 'bytearray', 'bytes',
  'callable', 'chr', 'classmethod', 'compile', 'complex', 'delattr',
  'dict', 'dir', 'divmod', 'enumerate', 'eval', 'exec', 'filter',
  'float', 'format', 'frozenset', 'getattr', 'globals', 'hasattr',
  'hash', 'help', 'hex', 'id', 'input', 'int', 'isinstance',
  'issubclass', 'iter', 'len', 'list', 'locals', 'map', 'max',
  'memoryview', 'min', 'next', 'object', 'oct', 'open', 'ord', 'pow',
  'print', 'property', 'range', 'repr', 'reversed', 'round', 'set',
  'setattr', 'slice', 'sorted', 'staticmethod', 'str', 'sum', 'super',
  'tuple', 'type', 'vars', 'zip', '__import__',
  'Exception', 'ValueError', 'TypeError', 'KeyError', 'IndexError',
  'AttributeError', 'RuntimeError', 'StopIteration', 'FileNotFoundError',
  'NameError', 'ZeroDivisionError', 'NotImplementedError', 'OSError',
  'ImportError', 'ModuleNotFoundError', 'AssertionError', 'LookupError',
]);

/**
 * Tokenize Python source into HTML with token spans. The output is
 * inserted into the .code-overlay div which sits behind the (transparent)
 * textarea, giving the illusion of an editable highlighter.
 */
function tokenizePython(source: string): string {
  let i = 0;
  const n = source.length;
  let out = '';
  let plain = '';

  const flush = () => {
    if (plain) {
      out += escapeHtml(plain);
      plain = '';
    }
  };
  const emit = (cls: string, text: string) => {
    flush();
    out += `<span class="tok-${cls}">${escapeHtml(text)}</span>`;
  };

  // Lookback over already-emitted plain to find the last non-space char
  const prevNonSpace = (): string => {
    for (let k = plain.length - 1; k >= 0; k--) {
      const c = plain[k];
      if (c !== ' ' && c !== '\t') return c;
    }
    return '';
  };

  const isIdStart = (c: string) => /[A-Za-z_]/.test(c);
  const isIdCont = (c: string) => /[A-Za-z0-9_]/.test(c);

  while (i < n) {
    const c = source[i];

    // Comment to end of line
    if (c === '#') {
      let j = i;
      while (j < n && source[j] !== '\n') j++;
      emit('comment', source.substring(i, j));
      i = j;
      continue;
    }

    // String literals (including triple-quoted, with optional prefix)
    const sm = source.substring(i).match(/^(?:[rRbBuUfF]{0,2})(?:"""|''')/);
    if (sm) {
      const prefixLen = sm[0].length - 3;
      const quote = sm[0].slice(prefixLen);
      const start = i;
      let j = i + sm[0].length;
      while (j < n && source.substring(j, j + 3) !== quote) j++;
      j = Math.min(n, j + (source.substring(j, j + 3) === quote ? 3 : 0));
      emit('string', source.substring(start, j));
      i = j;
      continue;
    }
    const sm2 = source.substring(i).match(/^([rRbBuUfF]{0,2})(['"])/);
    if (sm2) {
      const quote = sm2[2];
      const start = i;
      let j = i + sm2[0].length;
      while (j < n && source[j] !== quote && source[j] !== '\n') {
        if (source[j] === '\\' && j + 1 < n) j += 2;
        else j++;
      }
      if (j < n && source[j] === quote) j++;
      emit('string', source.substring(start, j));
      i = j;
      continue;
    }

    // Decorator: @name(.name)*
    if (c === '@' && i + 1 < n && isIdStart(source[i + 1])) {
      // Only treat as decorator at start of (possibly indented) line
      const before = prevNonSpace();
      if (before === '' || before === '\n') {
        let j = i + 1;
        while (j < n && (isIdCont(source[j]) || source[j] === '.')) j++;
        emit('decorator', source.substring(i, j));
        i = j;
        continue;
      }
    }

    // Numbers
    if (/[0-9]/.test(c) || (c === '.' && i + 1 < n && /[0-9]/.test(source[i + 1]))) {
      const m = source.substring(i).match(
        /^(?:0[xX][0-9a-fA-F_]+|0[bB][01_]+|0[oO][0-7_]+|(?:\d[\d_]*\.?\d*|\.\d[\d_]*)(?:[eE][+-]?\d+)?[jJ]?)/
      );
      if (m) {
        emit('number', m[0]);
        i += m[0].length;
        continue;
      }
    }

    // Identifiers / keywords
    if (isIdStart(c)) {
      let j = i + 1;
      while (j < n && isIdCont(source[j])) j++;
      const word = source.substring(i, j);

      if (PY_KEYWORDS.has(word)) {
        emit('keyword', word);
      } else if (word === 'self' || word === 'cls') {
        emit('self', word);
      } else if (PY_BUILTINS.has(word)) {
        emit('builtin', word);
      } else {
        // Function call: identifier followed by '(' (skipping spaces)
        let k = j;
        while (k < n && (source[k] === ' ' || source[k] === '\t')) k++;
        if (k < n && source[k] === '(') {
          emit('function', word);
        } else if (/^[A-Z]/.test(word) && word.length > 1) {
          emit('class', word);
        } else {
          plain += word;
        }
      }
      i = j;
      continue;
    }

    plain += c;
    i++;
  }

  flush();
  return out;
}

const PY_CONTENT_RE = /(?:^|\n)\s*(?:def\s+\w+\s*\(|class\s+\w+\b|from\s+[\w.]+\s+import\b|import\s+[\w.]+|@\w+|if\s+__name__\s*==)/m;
const PY_SHEBANG_RE = /^#!.*\bpython/i;

function looksLikePython(content: string): boolean {
  if (!content) return false;
  if (PY_SHEBANG_RE.test(content)) return true;
  return PY_CONTENT_RE.test(content);
}

function isPythonFile(): boolean {
  const note = activeNoteId ? notes.find(n => n.id === activeNoteId) : null;
  const path = (note?.filePath || '').toLowerCase();
  const title = noteTitleInput.value.trim().toLowerCase();
  if (path.endsWith('.py') || title.endsWith('.py')) return true;
  return looksLikePython(getEditorValue());
}

/**
 * Apply (or clear) syntax highlighting in-place inside the contenteditable.
 * Caret position is preserved across the innerHTML rewrite by saving and
 * restoring its character offset. Skipped in preview mode and while the
 * find bar is open (find owns the inline marks during search).
 */
function applyEditorHighlighting(): void {
  if (isPreviewMode) return;

  const isPython = isPythonFile();
  noteContentInput.classList.toggle('python-mode', isPython);

  const value = getEditorValue();
  const wasFocused = document.activeElement === noteContentInput;
  const caret = wasFocused ? getCaretOffset() : null;

  if (isPython) {
    setEditorHTML(tokenizePython(value));
  } else {
    // Plain mode: only re-set textContent when there's HTML cruft to
    // clear (e.g., leftover token spans after switching out of Python).
    // Replacing it unconditionally would wipe the caret and the browser's
    // composition state for no benefit.
    if (noteContentInput.querySelector('span, mark')) {
      setEditorValue(value);
    }
  }

  if (caret) setCaretOffset(caret.start, caret.end);
}

// Initialize
window.mermaid.initialize({
  startOnLoad: false,
  securityLevel: 'strict',
  theme: 'base',
  fontFamily: '"JetBrains Mono", monospace',
  themeVariables: {
    background: '#18181b',
    primaryColor: '#27272a',
    primaryTextColor: '#e4e4e7',
    primaryBorderColor: '#38bdf8',
    lineColor: '#7dd3fc',
    secondaryColor: '#1f1f23',
    tertiaryColor: '#27272a',
    textColor: '#e4e4e7',
    mainBkg: '#27272a',
    nodeBorder: '#38bdf8',
    clusterBkg: '#1f1f23',
    clusterBorder: '#3f3f46',
    edgeLabelBackground: '#18181b',
  },
});
const initialPrefs = loadPreferences();
applyFontColor(initialPrefs.fontColor);
applyTheme(initialPrefs.theme);
loadNotes();