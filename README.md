# Morpheus

Matrix-themed desktop notepad, built with Electron + TypeScript.

## Features

- Create, edit, and delete notes with local JSON persistence
- Incremental search across sidebar notes
- Find-in-note (Ctrl+F) with navigation and optional case-sensitive matching
- Markdown preview with DOMPurify sanitization (Ctrl+Shift+P)
- Save As to export notes as `.txt` or `.md`
- Custom frameless window with built-in controls
- Matrix rain visual effect in the background

## Stack

- **Electron 28** — desktop runtime
- **TypeScript** — main process and renderer
- **marked** + **DOMPurify** — safe Markdown rendering
- Persistence in `notes/index.json` within the working directory

## Structure

```
src/
  main.ts       # Electron main process, IPC handlers
  preload.ts    # contextIsolated bridge
  notepad.ts    # Note CRUD (fs)
renderer/
  index.html
  app.ts        # UI logic
  matrix-rain.ts
  styles.css
```

## Scripts

```bash
npm install        # install dependencies
npm run build      # compile main + renderer
npm start          # run app (requires build)
npm run dev        # watch mode + electron
npm run package    # build installer via electron-builder
```

## Shortcuts

| Shortcut       | Action                  |
| -------------- | ----------------------- |
| `Ctrl+S`       | Save As                 |
| `Ctrl+F`       | Find in note            |
| `Ctrl+Shift+P` | Toggle Markdown preview |

## Build

The main `tsconfig` compiles `src/` to `dist/`; `tsconfig.renderer.json` compiles `renderer/*.ts` to JS alongside the `.ts` files. `electron-builder` packages for Windows (NSIS) by default.
