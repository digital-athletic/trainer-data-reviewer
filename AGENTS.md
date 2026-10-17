# AGENTS.md

## Project overview

The coach data reviewer is a static web page that checks and corrects an exercise catalog (`Exercises.json`) and optional skill tree files. Plain HTML, CSS and native ES modules: no build step, no dependencies. `README.md` describes the app for the trainer and the developer, `docs/core-api.md` lists the modules, `docs/glossary.md` defines the terms.

## Folder structure

| Path | Purpose |
|---|---|
| `index.html` | Page shell, loads `js/ui/main.js` |
| `css/app.css` | Design tokens in `:root` and the shared components |
| `css/exercises.css` | Exercises list, detail page and value matrix |
| `js/core/` | Data model, edits, loader, changelog. No DOM access |
| `js/core/config.js` | The only file that knows paths of the target repository |
| `js/ui/` | Screens, dialogs and the dictionaries `locale-de.js` and `locale-en.js` |
| `js/ui/terms.js` | Names of tag groups and tags |
| `spec/` | Node test runner specs and `fixtures/sample/` |
| `dev/serve.js` | Local static server |

## Commands

```bash
npm start                        # http://127.0.0.1:8080/
npm start -- 8093 0.0.0.0        # other port, all interfaces
npm test                         # specs on the sample fixture
CDR_DATA_DIR=/path/to/generator npm test   # plus the real-data specs
```

The real-data specs pin counts from `js/core/config.js`. When the data changes, they fail until `PINNED_TESTS` follows.

## Rules

- **Terms:** use the terms of `docs/glossary.md`. Add a new term there before it reaches the UI.
- **Texts:** every UI text needs a key in `locale-de.js` and `locale-en.js`. German is the default. `npm test` fails on a missing key and on English prose in `js/ui`.
- **Tags:** a tag shows its name and its code. A new tag group needs an entry in `TAG_GROUPS` (`js/core/model.js`), under `tagGroup` and under `tagValue` in both dictionaries.
- **Styles:** neutral gray, red primary, 8px radius, system sans. Rules use the CSS variables from `:root` in `css/app.css`; a new colour gets a token there first. No images or logos.
- **CSP:** `index.html` allows only same-origin scripts and styles. No inline styles, no inline scripts, no external requests.
- **No dependencies:** keep `package.json` free of packages. Scratch scripts go outside the repository.
- **Paths:** docs and code reference files relative to the repository root. No absolute paths, no paths into other projects outside `js/core/config.js`.

## E2E and screenshots

The repository has no e2e suite yet. To drive the app in a real browser, connect a Playwright client to a Playwright server (`npx playwright run-server`) instead of installing browsers next to the app. The client must not be newer than the server; a newer client is refused.

1. Serve the app on all interfaces, so the browser on the server side reaches it:

   ```bash
   npm start -- 8093 0.0.0.0
   ```

2. Connect to the server and open the app under a hostname the server can resolve:

   ```js
   import { chromium } from 'playwright';

   const browser = await chromium.connect(process.env.PLAYWRIGHT_WS_ENDPOINT); // for example ws://playwright:9323
   const page = await browser.newPage({ viewport: { width: 1360, height: 900 } });
   await page.goto(process.env.APP_URL); // for example http://<this host>:8093/
   ```

3. Load data through the hidden file inputs. `setInputFiles` uploads a local file to the remote browser; `spec/fixtures/sample/Exercises.json` works without real data:

   ```js
   await page.setInputFiles('#exercises-input', 'spec/fixtures/sample/Exercises.json');
   await page.waitForSelector('.exl-table tbody tr');
   ```

Pitfalls:

- **Secure context:** a plain http URL on any host other than localhost is no secure context, so `crypto.randomUUID` is missing and the list fails to render. Localhost and the https deploy have it. In the test only, add a shim with `page.addInitScript` before `page.goto`; do not change the app for it.
- **Hash routes** such as `#/exercises/429` keep the loaded data; a full reload drops it, so navigate by hash after the upload.
- **Dialogs** fade in for 0.18 s; wait for the content before a screenshot. Esc in a dialog search field clears the text first, so close a dialog with its Cancel button.
- **Language:** the DE / EN buttons sit in `#lang-slot`. Select by element and class, not by translated text.
