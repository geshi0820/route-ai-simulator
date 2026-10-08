# route-ai-simulator

Interactive Route AI algorithm simulator (tour optimization demo).
Published at https://geshi0820.github.io/route-ai-simulator/

The app is **one static file** — `index.html`. There is no build step: open it in a
browser, or push to `main` and GitHub Pages serves it.

## Tests

```
npm install     # also installs the Chromium that Playwright drives (postinstall)
npm test        # unit (vitest + jsdom) then e2e (Playwright)
```

- `npm run test:unit` — loads `index.html` in jsdom and calls the page's own
  top-level functions. Nothing is exported from `index.html` for the tests' sake.
- `npm run test:e2e` — opens `index.html` over `file://` in Chromium and drives
  the real controls.

If `npm install` ran with `--ignore-scripts`, install the browser by hand:

```
npx playwright install chromium
```
