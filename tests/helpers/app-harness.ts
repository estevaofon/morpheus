/**
 * Loads renderer/app.ts inside the jsdom test environment.
 *
 * app.ts is written as a classic browser script: at load time it queries
 * dozens of DOM elements by id, wires event listeners, reads localStorage,
 * initialises mermaid and kicks off loadNotes(). To require() it from a test
 * we must first reproduce the page it expects — so we inject the *real*
 * renderer/index.html body (guaranteeing the element ids match production)
 * and stub the window globals the preload/CDN scripts normally provide.
 *
 * The functions under test are exposed through the guarded `module.exports`
 * block at the bottom of app.ts (a no-op in the browser).
 */
import fs from 'fs';
import path from 'path';

export interface AppModule {
  computeOutdent: (
    value: string,
    start: number,
    end: number,
  ) => { value: string; start: number; end: number } | null;
  computeJsonFoldRegions: (
    source: string,
  ) => Array<{ startLine: number; endLine: number; openChar: '{' | '[' }>;
  tokenizePython: (source: string) => string;
  tokenizeJson: (source: string) => string;
  tokenizeJsonLine: (
    source: string,
    state: { inBlockComment: boolean },
  ) => { html: string; state: { inBlockComment: boolean } };
  tokenizeMarkdown: (source: string) => string;
  wrapMatchesInElement: (
    root: HTMLElement,
    query: string,
    caseSensitive: boolean,
  ) => HTMLElement[];
  spliceReplacements: (
    text: string,
    ranges: Array<{ start: number; length: number }>,
    replacement: string,
  ) => string;
  looksLikePython: (content: string) => boolean;
  looksLikeJson: (content: string) => boolean;
  isJsonByPathOrTitle: (...names: Array<string | undefined>) => boolean;
  tryPrettyPrintJson: (content: string) => string | null;
  maybePrettyPrintJson: (filePathOrTitle: string | undefined, content: string) => string;
  sanitizeFilename: (name: string) => string;
  truncateMiddle: (text: string, maxLen: number) => string;
  escapeRegex: (str: string) => string;
  escapeHtml: (text: string) => string;
  highlightText: (text: string, query: string) => string;
}

/** Minimal stub of the preload-exposed electronAPI used at app load time. */
function makeElectronApiStub(): Record<string, unknown> {
  const noopUnsub = () => () => {};
  return {
    listNotes: () => Promise.resolve([]),
    getNote: () => Promise.resolve(null),
    createNote: () =>
      Promise.resolve({ id: 'stub', title: '', content: '', createdAt: '', updatedAt: '' }),
    editNote: () => Promise.resolve(null),
    deleteNote: () => Promise.resolve(false),
    minimize: () => {},
    maximize: () => {},
    close: () => {},
    saveAs: () => Promise.resolve({ success: false, filePath: null }),
    saveFile: () => Promise.resolve({ success: false, filePath: null }),
    openFile: () => Promise.resolve(null),
    setNoteFilePath: () => Promise.resolve(null),
    findNoteByFilePath: () => Promise.resolve(null),
    onOpenExternalFile: noopUnsub,
    onExternalFileChange: noopUnsub,
  };
}

let cached: AppModule | null = null;

/**
 * Prepare the DOM + window globals, then require app.ts once. Subsequent
 * calls return the cached module (require itself is cached per test file).
 */
export function loadApp(): AppModule {
  if (cached) return cached;

  const htmlPath = path.join(__dirname, '..', '..', 'renderer', 'index.html');
  const html = fs.readFileSync(htmlPath, 'utf-8');
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  const body = (bodyMatch ? bodyMatch[1] : '').replace(/<script[\s\S]*?<\/script>/gi, '');
  document.body.innerHTML = body;

  const w = window as unknown as Record<string, unknown>;
  w.electronAPI = makeElectronApiStub();
  w.marked = { parse: (s: string) => s, setOptions: () => {} };
  w.DOMPurify = { sanitize: (s: string) => s };
  w.mermaid = { initialize: () => {}, render: () => Promise.resolve({ svg: '' }) };

  // jsdom doesn't implement layout APIs that some editor paths call; stub the
  // ones that could fire during load so a require() never throws.
  if (!(Element.prototype as unknown as { scrollIntoView?: unknown }).scrollIntoView) {
    (Element.prototype as unknown as { scrollIntoView: () => void }).scrollIntoView = () => {};
  }

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  cached = require('../../renderer/app') as AppModule;
  return cached;
}
