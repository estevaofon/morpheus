"use strict";
// Matrix Notepad — Main App Logic
// State
let notes = [];
let activeNoteId = null;
// Find state
let findMatches = [];
let activeMatchIndex = -1;
// DOM Elements
const notesListEl = document.getElementById('notes-list');
const searchInput = document.getElementById('search-input');
const noteTitleInput = document.getElementById('note-title');
const noteContentInput = document.getElementById('note-content');
const statusText = document.getElementById('status-text');
const charCount = document.getElementById('char-count');
// Find bar elements
const findBar = document.getElementById('find-bar');
const findInput = document.getElementById('find-input');
const findCase = document.getElementById('find-case');
const findMatchCount = document.getElementById('find-match-count');
const findPrevBtn = document.getElementById('find-prev');
const findNextBtn = document.getElementById('find-next');
const findCloseBtn = document.getElementById('find-close');
const findBtn = document.getElementById('btn-find');
const findOverlay = document.getElementById('find-highlight-overlay');
// Window Controls
document.getElementById('btn-minimize')?.addEventListener('click', () => window.electronAPI.minimize());
document.getElementById('btn-maximize')?.addEventListener('click', () => window.electronAPI.maximize());
document.getElementById('btn-close')?.addEventListener('click', () => window.electronAPI.close());
// New Note
document.getElementById('btn-new')?.addEventListener('click', () => createNewNote());
// Save Note
document.getElementById('btn-save')?.addEventListener('click', () => saveCurrentNote());
// Delete Note
document.getElementById('btn-delete')?.addEventListener('click', () => deleteCurrentNote());
// Auto-save title on Enter or blur
noteTitleInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        e.preventDefault();
        saveTitle();
        noteContentInput.focus();
    }
});
noteTitleInput.addEventListener('blur', () => saveTitle());
// Find bar toggle
findBtn?.addEventListener('click', () => showFindBar());
findCloseBtn?.addEventListener('click', () => hideFindBar());
// Find input events
findInput?.addEventListener('input', () => performFind());
findInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        e.preventDefault();
        if (e.shiftKey)
            navigateFind(-1);
        else
            navigateFind(1);
    }
    if (e.key === 'Escape')
        hideFindBar();
});
findCase?.addEventListener('change', () => performFind());
findPrevBtn?.addEventListener('click', () => navigateFind(-1));
findNextBtn?.addEventListener('click', () => navigateFind(1));
// Character count
noteContentInput.addEventListener('input', () => {
    charCount.textContent = `${noteContentInput.value.length} chars`;
    // Re-run find if find bar is open
    if (findBar.style.display === 'flex')
        performFind();
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
        }
        else {
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
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        saveCurrentNote();
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault();
        showFindBar();
    }
});
/**
 * Load all notes from main process
 */
async function loadNotes() {
    notes = await window.electronAPI.listNotes();
    renderNotesList();
    setStatus(`Loaded ${notes.length} note${notes.length !== 1 ? 's' : ''} from the Matrix.`);
}
/**
 * Render notes list in sidebar
 */
function renderNotesList(filter = '') {
    const filtered = notes.filter(n => n.title.toLowerCase().includes(filter) ||
        n.content.toLowerCase().includes(filter));
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
        const titleHtml = filter ? highlightText(note.title || '(untitled)', filter) : escapeHtml(note.title) || '(untitled)';
        const previewHtml = filter ? highlightText(preview, filter) : escapeHtml(preview);
        return `
        <div class="note-item ${isActive ? 'active' : ''}" data-id="${note.id}">
          <div class="note-item-title">${titleHtml}</div>
          <div class="note-item-preview">${previewHtml}</div>
          <div class="note-item-date">${date}</div>
        </div>
      `;
    }).join('');
    notesListEl.querySelectorAll('.note-item').forEach(el => {
        el.addEventListener('click', () => {
            const id = el.dataset.id;
            selectNote(id);
        });
    });
}
/**
 * Select a note to view/edit
 */
async function selectNote(id) {
    activeNoteId = id;
    const note = await window.electronAPI.getNote(id);
    if (note) {
        noteTitleInput.value = note.title;
        noteContentInput.value = note.content;
        charCount.textContent = `${note.content.length} chars`;
        renderNotesList(searchInput.value.toLowerCase());
        setStatus(`> Viewing: ${note.title}`);
        hideFindBar();
    }
}
/**
 * Create a new blank note
 */
async function createNewNote() {
    const note = await window.electronAPI.createNote('', '');
    activeNoteId = note.id;
    await loadNotes();
    await selectNote(note.id);
    noteTitleInput.focus();
    setStatus('> New note created.');
}
/**
 * Save just the title if it has changed
 */
async function saveTitle() {
    if (!activeNoteId)
        return;
    const currentNote = notes.find(n => n.id === activeNoteId);
    const newTitle = noteTitleInput.value.trim();
    if (!currentNote || currentNote.title === newTitle)
        return;
    const updated = await window.electronAPI.editNote(activeNoteId, newTitle, noteContentInput.value);
    if (updated) {
        await loadNotes();
        setStatus('> Title saved.');
    }
}
/**
 * Save current note — opens native Save As dialog
 */
async function saveCurrentNote() {
    await saveTitle();
    const content = noteContentInput.value;
    const title = noteTitleInput.value.trim() || 'untitled';
    try {
        const result = await window.electronAPI.saveAs(content);
        if (result.success) {
            const fileName = result.filePath.split(/[\\/]/).pop();
            setStatus(`> Saved "${fileName}" to the Matrix.`);
        }
        else if (result.filePath === null && !result.error) {
            setStatus('> Save cancelled.');
        }
        else {
            setStatus(`> Error saving: ${result.error}`);
        }
    }
    catch (err) {
        console.error('Save error:', err);
        setStatus(`> Error saving: ${String(err)}`);
    }
    const saveBtn = document.getElementById('btn-save');
    saveBtn.style.color = '#00ff41';
    saveBtn.style.boxShadow = '0 0 10px #00ff41';
    setTimeout(() => {
        saveBtn.style.color = '';
        saveBtn.style.boxShadow = '';
    }, 500);
}
/**
 * Delete current note
 */
async function deleteCurrentNote() {
    if (!activeNoteId) {
        setStatus('> No note selected.');
        return;
    }
    if (!confirm('Delete this note from the Matrix?'))
        return;
    const deleted = await window.electronAPI.deleteNote(activeNoteId);
    if (deleted) {
        activeNoteId = null;
        noteTitleInput.value = '';
        noteContentInput.value = '';
        charCount.textContent = '0 chars';
        await loadNotes();
        setStatus('> Note deleted from the Matrix.');
    }
}
// ============================================
// FIND IN CONTENT
// ============================================
function showFindBar() {
    if (!activeNoteId) {
        setStatus('> Open a note first.');
        return;
    }
    findBar.style.display = 'flex';
    findInput.focus();
    const selection = noteContentInput.value.substring(noteContentInput.selectionStart || 0, noteContentInput.selectionEnd || 0);
    if (selection) {
        findInput.value = selection;
    }
    performFind();
}
function hideFindBar() {
    findBar.style.display = 'none';
    findInput.value = '';
    findMatchCount.textContent = '0 matches';
    findMatches = [];
    activeMatchIndex = -1;
    findOverlay.innerHTML = '';
    noteContentInput.classList.remove('searching');
    noteContentInput.focus();
}
function performFind() {
    findMatches = [];
    activeMatchIndex = -1;
    const query = findInput.value;
    if (!query) {
        findMatchCount.textContent = '0 matches';
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
function renderFindHighlights() {
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
function navigateFind(direction) {
    if (findMatches.length === 0)
        return;
    activeMatchIndex += direction;
    if (activeMatchIndex < 0)
        activeMatchIndex = findMatches.length - 1;
    if (activeMatchIndex >= findMatches.length)
        activeMatchIndex = 0;
    const match = findMatches[activeMatchIndex];
    noteContentInput.setSelectionRange(match.start, match.end);
    noteContentInput.focus();
    findMatchCount.textContent = `${activeMatchIndex + 1}/${findMatches.length}`;
}
/**
 * Set status bar text
 */
function setStatus(text) {
    statusText.textContent = text;
}
/**
 * Escape HTML to prevent XSS
 */
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}
/**
 * Highlight matching search terms in text
 */
function highlightText(text, query) {
    if (!query)
        return escapeHtml(text);
    const escaped = escapeHtml(text);
    const escapedQuery = escapeHtml(query);
    const regex = new RegExp(`(${escapeRegex(escapedQuery)})`, 'gi');
    return escaped.replace(regex, '<span class="search-highlight">$1</span>');
}
/**
 * Escape special regex characters
 */
function escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
// Initialize
loadNotes();
//# sourceMappingURL=app.js.map