# Morpheus

Bloco de notas desktop com tema Matrix, construído com Electron + TypeScript.

## Funcionalidades

- Criar, editar e excluir notas com persistência local em JSON
- Busca incremental nas notas da sidebar
- Find-in-note (Ctrl+F) com navegação e case-sensitive opcional
- Preview de Markdown com sanitização via DOMPurify (Ctrl+Shift+P)
- Save As para exportar notas como `.txt` ou `.md`
- Janela custom frameless com controles próprios
- Efeito visual de Matrix rain no fundo

## Stack

- **Electron 28** — runtime desktop
- **TypeScript** — main process e renderer
- **marked** + **DOMPurify** — renderização segura de Markdown
- Persistência em `notes/index.json` no diretório de trabalho

## Estrutura

```
src/
  main.ts       # Electron main process, IPC handlers
  preload.ts    # Bridge contextIsolated
  notepad.ts    # CRUD de notas (fs)
renderer/
  index.html
  app.ts        # Lógica da UI
  matrix-rain.ts
  styles.css
```

## Scripts

```bash
npm install        # instalar dependências
npm run build      # compilar main + renderer
npm start          # rodar app (requer build)
npm run dev        # watch mode + electron
npm run package    # gerar instalador via electron-builder
```

## Atalhos

| Atalho         | Ação                  |
| -------------- | --------------------- |
| `Ctrl+S`       | Save As               |
| `Ctrl+F`       | Find in note          |
| `Ctrl+Shift+P` | Toggle Markdown preview |

## Build

O `tsconfig` principal compila `src/` para `dist/`; o `tsconfig.renderer.json` compila `renderer/*.ts` para JS ao lado dos `.ts`. O `electron-builder` empacota para Windows (NSIS) por padrão.
