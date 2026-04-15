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
let findMatches: { start: number; end: number }[] = [];
let findPreviewMatches: HTMLElement[] = [];
let activeMatchIndex: number = -1;

// DOM Elements
const notesListEl = document.getElementById('notes-list')!;
const searchInput = document.getElementById('search-input') as HTMLInputElement;
const noteTitleInput = document.getElementById('note-title') as HTMLInputElement;
const noteContentInput = document.getElementById('note-content') as HTMLTextAreaElement;
const notePreviewEl = document.getElementById('note-preview') as HTMLDivElement;
const previewBtn = document.getElementById('btn-preview') as HTMLButtonElement;
const statusText = document.getElementById('status-text')!;
const charCount = document.getElementById('char-count')!;

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

// Find bar elements
const findBar = document.getElementById('find-bar') as HTMLDivElement;
const findInput = document.getElementById('find-input') as HTMLInputElement;
const findCase = document.getElementById('find-case') as HTMLInputElement;
const findMatchCount = document.getElementById('find-match-count') as HTMLSpanElement;
const findPrevBtn = document.getElementById('find-prev') as HTMLButtonElement;
const findNextBtn = document.getElementById('find-next') as HTMLButtonElement;
const findCloseBtn = document.getElementById('find-close') as HTMLButtonElement;
const findBtn = document.getElementById('btn-find') as HTMLButtonElement;
const findOverlay = document.getElementById('find-highlight-overlay') as HTMLDivElement;

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
  charCount.textContent = `${noteContentInput.value.length} chars`;
  if (noteContentInput.value) void ensureActiveNote();
  // Re-run find if find bar is open
  if (findBar.style.display === 'flex') performFind();
});

// Tab key inserts 2 spaces instead of changing focus
noteContentInput.addEventListener('keydown', (e) => {
  if (e.key === 'Tab') {
    e.preventDefault();
    const start = noteContentInput.selectionStart;
    const end = noteContentInput.selectionEnd;
    const value = noteContentInput.value;

    // If there's a selection spanning multiple lines, indent each line
    const selected = value.substring(start, end);
    if (selected.includes('\n')) {
      const indented = selected.replace(/^/gm, '  ');
      noteContentInput.value = value.substring(0, start) + indented + value.substring(end);
      noteContentInput.selectionStart = start;
      noteContentInput.selectionEnd = start + indented.length;
    } else {
      // Simple case: insert 2 spaces at cursor
      noteContentInput.value = value.substring(0, start) + '  ' + value.substring(end);
      noteContentInput.selectionStart = noteContentInput.selectionEnd = start + 2;
    }

    // Trigger input event so char count and find update
    noteContentInput.dispatchEvent(new Event('input'));
  }
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
      <div class="empty-state" style="padding: 40px 20px;">
        <div class="empty-state-icon">&#9002;</div>
        <div class="empty-state-text">${filter ? '> No matching notes.' : '> No notes in the Matrix...'}</div>
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
    noteContentInput.value = note.content;
    charCount.textContent = `${note.content.length} chars`;
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

  const updated = await window.electronAPI.editNote(activeNoteId, newTitle, noteContentInput.value);
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
  const newContent = noteContentInput.value;

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
  saveBtn.style.color = '#00ff41';
  saveBtn.style.boxShadow = '0 0 10px #00ff41';
  setTimeout(() => {
    saveBtn.style.color = '';
    saveBtn.style.boxShadow = '';
  }, 500);
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
}

/**
 * Save — writes directly to the existing filePath if any, otherwise opens Save As dialog.
 */
async function saveCurrentNote(): Promise<void> {
  await saveTitle();
  const content = noteContentInput.value;
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
  const content = noteContentInput.value;
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

    const existing = await window.electronAPI.findNoteByFilePath(result.filePath);
    if (existing) {
      notes = await window.electronAPI.listNotes();
      await selectNote(existing.id);
      setStatus(`> Opened existing note for ${result.filePath}`);
      return;
    }

    const created = await window.electronAPI.createNote(result.filePath, result.content);
    await window.electronAPI.setNoteFilePath(created.id, result.filePath);
    notes = await window.electronAPI.listNotes();
    await selectNote(created.id);
    setStatus(`> Loaded ${result.filePath}`);
  } catch (err) {
    console.error('Open error:', err);
    setStatus(`> Error opening: ${String(err)}`);
  }
}

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
    noteContentInput.value = '';
    charCount.textContent = '0 chars';
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
    if (!activeNoteId && !noteContentInput.value) {
      setStatus('> Open or write a note first.');
      return;
    }
    renderPreview();
    noteContentInput.style.display = 'none';
    notePreviewEl.style.display = 'block';
    previewBtn.classList.add('active');
    previewBtn.title = 'Edit (Ctrl+Shift+P)';
    isPreviewMode = true;
    setStatus('> Preview mode.');

    findOverlay.innerHTML = '';
    noteContentInput.classList.remove('searching');
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
    setStatus('> Edit mode.');

    if (findBar.style.display === 'flex') {
      performFind();
      findInput.focus();
    } else {
      noteContentInput.focus();
    }
  }
}

function renderPreview(): void {
  const raw = noteContentInput.value || '';
  const html = window.marked.parse(raw);
  notePreviewEl.innerHTML = window.DOMPurify.sanitize(html, {
    ADD_ATTR: ['target'],
  });
}

// ============================================
// FIND IN CONTENT
// ============================================

function showFindBar(): void {
  if (!activeNoteId) {
    setStatus('> Open a note first.');
    return;
  }
  findBar.style.display = 'flex';
  findInput.focus();

  let selection = '';
  if (isPreviewMode) {
    selection = window.getSelection()?.toString() || '';
  } else {
    selection = noteContentInput.value.substring(
      noteContentInput.selectionStart || 0,
      noteContentInput.selectionEnd || 0
    );
  }
  if (selection) {
    findInput.value = selection;
  }
  performFind();
}

function hideFindBar(): void {
  findBar.style.display = 'none';
  findInput.value = '';
  findMatchCount.textContent = '0 matches';
  findMatches = [];
  findPreviewMatches = [];
  activeMatchIndex = -1;
  findOverlay.innerHTML = '';
  noteContentInput.classList.remove('searching');
  if (isPreviewMode) {
    renderPreview();
  } else {
    noteContentInput.focus();
  }
}

function performFind(): void {
  findMatches = [];
  findPreviewMatches = [];
  activeMatchIndex = -1;

  const query = findInput.value;
  if (!query) {
    findMatchCount.textContent = '0 matches';
    if (isPreviewMode) {
      renderPreview();
    } else {
      findOverlay.innerHTML = '';
      noteContentInput.classList.remove('searching');
    }
    return;
  }

  if (isPreviewMode) {
    performFindInPreview(query);
    return;
  }

  const content = noteContentInput.value;
  const caseSensitive = findCase.checked;
  const searchContent = caseSensitive ? content : content.toLowerCase();
  const searchQuery = caseSensitive ? query : query.toLowerCase();

  let idx = searchContent.indexOf(searchQuery);
  while (idx !== -1) {
    findMatches.push({ start: idx, end: idx + query.length });
    idx = searchContent.indexOf(searchQuery, idx + 1);
  }

  findMatchCount.textContent = `${findMatches.length} match${findMatches.length !== 1 ? 'es' : ''}`;

  renderFindHighlights();
}

function performFindInPreview(query: string): void {
  renderPreview();

  const caseSensitive = findCase.checked;
  const searchQuery = caseSensitive ? query : query.toLowerCase();

  const walker = document.createTreeWalker(notePreviewEl, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];
  let current: Node | null;
  while ((current = walker.nextNode())) {
    textNodes.push(current as Text);
  }

  for (const textNode of textNodes) {
    const text = textNode.nodeValue || '';
    if (!text) continue;
    const searchText = caseSensitive ? text : text.toLowerCase();

    let idx = searchText.indexOf(searchQuery);
    if (idx === -1) continue;

    const parent = textNode.parentNode;
    if (!parent) continue;

    const fragment = document.createDocumentFragment();
    let lastIdx = 0;

    while (idx !== -1) {
      if (idx > lastIdx) {
        fragment.appendChild(document.createTextNode(text.substring(lastIdx, idx)));
      }
      const mark = document.createElement('mark');
      mark.className = 'find-preview-mark';
      mark.textContent = text.substring(idx, idx + query.length);
      fragment.appendChild(mark);
      findPreviewMatches.push(mark);
      lastIdx = idx + query.length;
      idx = searchText.indexOf(searchQuery, lastIdx);
    }

    if (lastIdx < text.length) {
      fragment.appendChild(document.createTextNode(text.substring(lastIdx)));
    }

    parent.replaceChild(fragment, textNode);
  }

  findMatchCount.textContent = `${findPreviewMatches.length} match${findPreviewMatches.length !== 1 ? 'es' : ''}`;
}

function renderFindHighlights(): void {
  const query = findInput.value;
  if (!query) {
    findOverlay.innerHTML = '';
    noteContentInput.classList.remove('searching');
    return;
  }

  const content = noteContentInput.value;
  if (!content) {
    findOverlay.innerHTML = '';
    noteContentInput.classList.remove('searching');
    return;
  }

  const caseSensitive = findCase.checked;
  const searchContent = caseSensitive ? content : content.toLowerCase();
  const searchQuery = caseSensitive ? query : query.toLowerCase();

  let result = '';
  let pos = 0;
  let matchIdx = searchContent.indexOf(searchQuery, pos);
  let hasMatch = false;

  while (matchIdx !== -1) {
    hasMatch = true;
    if (matchIdx > pos) {
      result += escapeHtml(content.substring(pos, matchIdx));
    }
    result += '<mark>' + escapeHtml(content.substring(matchIdx, matchIdx + query.length)) + '</mark>';
    pos = matchIdx + query.length;
    matchIdx = searchContent.indexOf(searchQuery, pos);
  }

  if (!hasMatch) {
    findOverlay.innerHTML = escapeHtml(content);
    noteContentInput.classList.remove('searching');
    return;
  }

  if (pos < content.length) {
    result += escapeHtml(content.substring(pos));
  }

  findOverlay.innerHTML = result;
  noteContentInput.classList.add('searching');
}

function navigateFind(direction: number): void {
  const count = isPreviewMode ? findPreviewMatches.length : findMatches.length;
  if (count === 0) return;

  activeMatchIndex += direction;
  if (activeMatchIndex < 0) activeMatchIndex = count - 1;
  if (activeMatchIndex >= count) activeMatchIndex = 0;

  if (isPreviewMode) {
    findPreviewMatches.forEach((m, i) => {
      m.classList.toggle('find-preview-mark-active', i === activeMatchIndex);
    });
    findPreviewMatches[activeMatchIndex].scrollIntoView({
      behavior: 'smooth',
      block: 'center',
    });
  } else {
    const match = findMatches[activeMatchIndex];
    noteContentInput.setSelectionRange(match.start, match.end);
    noteContentInput.focus();
  }

  findMatchCount.textContent = `${activeMatchIndex + 1}/${count}`;
}

// ============================================
// PREFERENCES
// ============================================

type FontColor = 'green' | 'white';
interface Preferences {
  fontColor: FontColor;
}

const PREFS_KEY = 'morpheus:preferences';

function loadPreferences(): Preferences {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && (parsed.fontColor === 'green' || parsed.fontColor === 'white')) {
        return { fontColor: parsed.fontColor };
      }
    }
  } catch {
    // fall through to defaults
  }
  return { fontColor: 'green' };
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

function showPreferences(): void {
  const prefs = loadPreferences();
  fontColorRadios.forEach(r => { r.checked = r.value === prefs.fontColor; });
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

// Initialize
applyFontColor(loadPreferences().fontColor);
loadNotes();