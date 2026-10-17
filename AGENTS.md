# AGENTS.md

## Project overview

The coach data reviewer is a static web page that checks and corrects `Exercises.json` and the skill tree files of the athlete app. Plain HTML, CSS and native ES modules: no build step, no dependencies. `README.md` describes the app for the trainer and the developer; `docs/core-api.md` lists the modules.

## Folder structure

| Path | Purpose |
|---|---|
| `index.html` | Page shell, loads `js/ui/main.js` |
| `css/app.css` | Design tokens in `:root` and the shared components |
| `css/exercises.css` | Exercises list, detail page and value matrix |
| `js/core/` | Data model, edits, loader, changelog. No DOM access |
| `js/ui/` | Screens, dialogs and the dictionaries `locale-de.js` and `locale-en.js` |
| `js/ui/terms.js` | Names of tag groups and tags |
| `spec/` | Node test runner specs and `fixtures/sample/` |
| `dev/serve.js` | Local static server |

## Commands

```bash
npm start                    # http://127.0.0.1:8080/
npm start -- 8093 0.0.0.0    # other port, all interfaces
npm test                     # specs on the sample fixture
CDR_DATA_DIR=/home/node/app/athlete-mobile/assets/data/generator npm test   # plus the real-data specs
```

The real-data specs pin counts from `js/core/config.js`. When the athlete app data changes, they fail until `PINNED_TESTS` follows.

## Rules

- **Texts:** every UI text needs a key in `locale-de.js` and `locale-en.js`. German is the default. `npm test` fails on a missing key and on English prose in `js/ui`.
- **Domain terms:** use the German and English terms of the athlete app locales (`/home/node/app/athlete-mobile/src/i18n/locales/`) and the glossary (`/home/node/app/athlete-mobile/docs/specs/glossary.md`).
- **Tags:** a tag shows its name and its code. Names live under `tagValue.<group>` in both dictionaries; a new tag group needs an entry in `model.TAG_GROUPS`, `tagGroup` and `tagValue`.
- **Styles:** the look follows the trainer web app (`/home/node/app/trainer-web`): neutral gray, red primary, 8px radius, system sans. Rules use the CSS variables from `:root` in `css/app.css`; a new colour gets a token there first. No images or logos.
- **CSP:** `index.html` allows only same-origin scripts and styles. No inline styles, no inline scripts, no external requests.
- **No dependencies:** keep `package.json` free of packages. Scratch scripts go outside the repository.

## E2E and screenshots

The repository has no e2e suite yet. To drive the app in a real browser, use the shared `playwright` container from `/home/node/app/docker-compose.yml`. Do not install browsers locally: the dev container lacks the system libraries Chromium needs.

1. Serve the app on all interfaces, so the browser container reaches it:

   ```bash
   npm start -- 8093 0.0.0.0
   ```

2. Connect a Playwright client to `ws://playwright:9323` and open the app under this container's hostname (`hostname` prints it), for example `http://e5a682939723:8093/`. The client package is in `/home/node/app/node_modules/.pnpm/playwright@1.62.1`; the server runs 1.62.1, and a newer client is refused.

   ```js
   import { createRequire } from 'node:module';
   const require = createRequire('/home/node/app/node_modules/.pnpm/playwright@1.62.1/node_modules/playwright/');
   const { chromium } = require('playwright');

   const browser = await chromium.connect('ws://playwright:9323');
   const page = await browser.newPage({ viewport: { width: 1360, height: 900 } });
   ```

3. Load data through the hidden file inputs. `setInputFiles` uploads the local file to the remote browser:

   ```js
   await page.setInputFiles('#exercises-input', '/home/node/app/athlete-mobile/assets/data/generator/Exercises.json');
   await page.waitForSelector('.exl-table tbody tr');
   ```

Pitfalls:

- **Secure context:** a container hostname over plain http is no secure context, so `crypto.randomUUID` is missing and the list fails to render. Localhost and the https deploy have it. In the test only, add a shim with `page.addInitScript` before `page.goto`; do not change the app for it.
- **Hash routes** such as `#/exercises/429` keep the loaded data; a full reload drops it, so navigate by hash after the upload.
- **Dialogs** fade in for 0.18 s; wait for the content before a screenshot. Esc in a dialog search field clears the text first, so close a dialog with its Cancel button.
- **Language:** the DE / EN buttons sit in `#lang-slot`. Select by element and class, not by translated text.
