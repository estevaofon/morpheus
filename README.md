# Morpheus

Matrix-themed desktop notepad, built with Electron + TypeScript.

## Features

- Note CRUD with local JSON persistence in `notes/index.json`
- Open existing `.txt` / `.md` files; notes remember their file path for later Save
- Save (overwrite existing file) and Save As (native dialog with suggested filename)
- Platform-aware line endings on disk: CRLF on Windows, LF elsewhere
- Incremental sidebar search across note titles and content, with inline match highlighting
- Find-in-note (Ctrl+F) with match count, prev/next navigation, and case-sensitive toggle — works in both edit and preview modes
- Markdown preview (Ctrl+Shift+P) rendered with `marked` and sanitized through DOMPurify
- Mermaid diagrams rendered from ```` ```mermaid ```` fenced blocks, themed to match the Matrix palette
- Custom frameless window with built-in minimize / maximize / close controls
- Native right-click context menu (cut, copy, paste, select all) on editable fields
- Tab key inserts 2 spaces, or indents the entire selection on multi-line ranges
- Preferences modal (Ctrl+,) — switch font color between green and white, persisted in `localStorage`
- Auto-save on blur; auto-create a note on first keystroke so drafts are never lost
- Bundled JetBrains Mono font

## Stack

- **Electron 28** — desktop runtime (`contextIsolation: true`, `nodeIntegration: false`)
- **TypeScript** — main process and renderer, compiled by two separate `tsconfig` projects
- **marked** — Markdown parsing
- **DOMPurify** — HTML sanitization before injection into the preview
- **mermaid** — diagram rendering (running in `strict` security mode)
- Persistence in `notes/index.json` within the app's working directory

## Structure

```
src/
  main.ts       # Electron main: window, IPC handlers, native dialogs, context menu
  preload.ts    # contextBridge — exposes `electronAPI` to the renderer
  notepad.ts    # Note CRUD + filePath tracking (fs/promises)
renderer/
  index.html    # Titlebar, sidebar, editor, find bar, modals
  app.ts        # UI logic, find, preview, preferences, mermaid wiring
  styles.css
  fonts/        # JetBrains Mono
  marked.umd.js
  purify.min.js
  mermaid.min.js
```

## Scripts

```bash
npm install        # install dependencies
npm run build      # compile main (tsconfig.json) + renderer (tsconfig.renderer.json)
npm start          # run app (requires build)
npm run dev        # tsc --watch for both projects + electron
npm run package    # build installer via electron-builder
```

## Shortcuts

| Shortcut       | Action                                               |
| -------------- | ---------------------------------------------------- |
| `Ctrl+S`       | Save — writes to the file path, else falls back to Save As |
| `Ctrl+Shift+S` | Save As — always opens the native dialog             |
| `Ctrl+O`       | Open a file from disk                                |
| `Ctrl+F`       | Find in current note                                 |
| `Ctrl+Shift+P` | Toggle Markdown preview                              |
| `Ctrl+,`       | Open Preferences                                     |
| `Tab`          | Insert 2 spaces (indents the whole selection)        |

Shift-clicking the **Save** button also forces Save As.

## Build

The root `tsconfig.json` compiles `src/` to `dist/`; `tsconfig.renderer.json` compiles `renderer/*.ts` to JS alongside the sources. `electron-builder` packages for Windows as both an NSIS installer and a portable executable (see `build.win.target` in `package.json`).

### Building your own executable

Prerequisites: Node.js 18+ and npm. On Windows, run the commands below from PowerShell or Git Bash at the repo root.

```bash
npm install        # first time only
npm run build      # compile TypeScript (main + renderer)
npm run package    # run electron-builder
```

Artifacts land in `release/`:

- `Morpheus Setup <version>.exe` — NSIS installer (adds Start Menu shortcut, supports uninstall)
- `Morpheus <version>.exe` — portable single-file executable (no install required)
- `release/win-unpacked/` — raw unpacked app directory, useful for debugging the packaged build

The version in the filenames comes from `version` in `package.json`. Targets are defined in `build.win.target`; remove `portable` or `nsis` there to produce only one of them. To build for macOS or Linux, add the matching `build.mac` / `build.linux` entries and run `npm run package` on that platform (electron-builder does not cross-compile Windows installers from other OSes without extra setup).

A custom icon can be set via `build.win.icon` pointing to a `.ico` file (256×256 recommended); otherwise the default Electron icon is used.

## Security

- Renderer runs with `contextIsolation: true` and `nodeIntegration: false`; all access to Node APIs goes through the preload bridge.
- Strict Content-Security-Policy in `index.html` (`default-src 'self'`; no remote scripts).
- Markdown HTML passes through DOMPurify before being written to the preview pane.
- Mermaid is initialized with `securityLevel: 'strict'`.
