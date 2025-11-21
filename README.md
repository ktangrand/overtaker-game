# Endless Overtake

A minimal Vite + React + Three.js setup that bundles the racing prototype with Tailwind CSS.

## Scripts

- `npm run dev` — start the dev server with hot reload.
- `npm run build` — build the optimized production bundle.
- `npm run preview` — serve the built bundle from `dist/` for a production-like check.
- `npm run lint` — run ESLint on the TypeScript/TSX source.

Run `npm install` once to install dependencies, then use the scripts above from the project root.
For a production check, run `npm run build` followed by `npm run preview` instead of opening
`index.html` directly, so the compiled JavaScript is served with the correct MIME types.
