# ReadStein landing page

A standalone Vite + React landing page for ReadStein. It is intentionally
isolated from the Readest application in the parent repository.

## Run locally

```bash
cd Landing-page
npm install
npm run dev
```

Vite serves the site at `http://localhost:5173`.

## Production build

```bash
npm run build
npm run preview
```

The static production output is written to `dist/`.

## Structure

- `src/App.tsx` — page sections, product mock, theme behavior, and copy
- `src/components/LibraryFlowScene.tsx` — lazy-loaded Three.js sparkle layer
- `src/styles.css` — responsive light/dark design system and motion
- `public/images/` — generated campaign imagery and app icon
- `public/fonts/` — the same Inter variable font used by the reader app

All temporary GitHub/download links currently point to:

`https://github.com/CodeUpdaterBot/StreamStein`

Light and dark follow the visitor's system preference unless they use the
header toggle. The choice is saved in `localStorage`. Motion is reduced when
the visitor has `prefers-reduced-motion` enabled.
