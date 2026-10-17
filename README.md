# Coach data reviewer

The coach data reviewer is a web page. You use it to check and correct the exercise catalog (Übungskatalog) that the app builds training plans from. The app reads `Exercises.json` and, if you add them, the skill tree files. You need no extra software. The page reads the files inside the browser and never uploads them.

The app has one screen:

- **Exercises**: the whole exercise catalog with search and filters. Open an exercise to change its name, levels, tags, start values (Startwerte) and target values (Zielwerte).

The app shows German by default. The DE / EN buttons at the top right switch to English and back. The browser remembers the choice. `changelog.md` stays in English, because it goes to the developer.

## For the trainer

The steps below name the buttons as the English mode shows them. Click EN at the top right to see the same labels.

### 1. Open the app

Open the address the developer gave you, for example `https://<user>.github.io/<repo>/`, in Chrome, Edge or Firefox. Save it as a bookmark.

### 2. Choose Exercises.json

The app does not contain the training data. You keep the file `Exercises.json` on your computer.

1. Get `Exercises.json`: download the project from GitHub ("Code", then "Download ZIP") and unzip it. You find the file at `athlete-mobile/assets/data/generator/Exercises.json`. The developer can also send it to you.
2. Did your browser save the file as `Exercises (1).json`? Rename it to `Exercises.json` first. The app reads a file with that exact name only.
3. In the app, click "Choose Exercises.json" and pick the file.

The header then shows "1,210 exercises". If you picked another file, the file holds no valid exercise list, or the file is larger than 50 MB, the app tells you what it expected.

### 2a. Optional: choose the skill tree files

With the skill tree files, the app shows which branches use an exercise and refuses to delete an exercise that a branch still uses. Without them, the exercise page shows "Skill trees not loaded".

1. Click "Choose skill tree files", on the start page or in the "Work file" menu.
2. Open the folder `athlete-mobile/assets/data/generator/skillTrees` and select all `.json` files in it, for example with Ctrl+A.

The header then also shows the branch and skill tree counts. The app keeps the skill trees when you choose another `Exercises.json`. Picking skill tree files again replaces the earlier ones. If you deleted an exercise before you loaded the skill trees and a branch uses it, the app takes the delete back and tells you.

### 3. Correct the exercises

1. Find an exercise in the **Exercises** list by id or name, or narrow the list with the filters. Click a row to open it.
2. Correct the exercise where needed. "Undo" (or Ctrl+Z) takes back the last change.

The badge at the top shows how many changes you have not exported yet.

### 4. Export and send the file

1. Click **Export changes**. The app offers the changed `Exercises.json`.
2. Click "Download the file" and "Download changelog.md".
3. If the browser saved the file as `Exercises (1).json`, rename it to `Exercises.json`.
4. Send `Exercises.json` and `changelog.md` to the developer, or upload the file on GitHub: open the folder `athlete-mobile/assets/data/generator` on the project page, click "Add file", then "Upload files", and drop the file in. Paste the text of `changelog.md` into the description.

`changelog.md` lists every change with the old and the new value, plus notes the developer needs.

### 5. Save the work file

The work file holds all your changes in one file.

1. Click "Work file" at the top, then "Save work file".
2. The browser saves `coach-review-work-DATE.json` in your downloads folder. Keep the newest one.

The app also keeps a backup of your work in this browser after every change. Each backup belongs to one `Exercises.json`. When you choose that same file again, the app offers to restore the backup. Another `Exercises.json` gets no offer, and its backup stays untouched. A backup stays until you choose its `Exercises.json` again and decline the restore, or undo every change. The backup stays in this browser only, so save the work file before you switch computers or clear the browser data.

### 6. Next time

1. Open the app and choose `Exercises.json`, and the skill tree files if you use them.
2. Click "Open work file" and pick the newest `coach-review-work-DATE.json`. Your changes come back. The work file fits with and without the skill tree files.

If the developer has merged your changes in the meantime, get a fresh `Exercises.json` first. The app then warns that the work file belongs to other data and lists the changes that no longer fit. A work file saved with the older app version, which read the whole data folder, gets the same warning.

### Good to know

- **Ids stay reserved.** A deleted exercise keeps its number forever, because athletes may have trained it. New exercises always get a new number.
- **You cannot delete Pause.** Exercise 999999 (Pause) is a system exercise.
- **Empty value cells are not always a mistake.** The training plan fills some empty start and target values from its intensity settings.
- **Chrome may ask about several downloads.** Click "Allow" so all files download.
- **Shortcuts:** `/` jumps to the search box, Ctrl+Z undoes the last change, Esc closes a dialog.

## For the developer

The app is plain HTML, CSS and native ES modules. It has no build step and no dependencies. `index.html` loads `js/ui/main.js`, every path is relative, so the app runs under any sub-path. `docs/core-api.md` lists the modules in `js/core/`. `js/core/config.js` holds the values that depend on the target repository: the data path and the pinned tests.

The UI texts live in `js/ui/locale-de.js` and `js/ui/locale-en.js`, and `js/ui/i18n.js` looks them up. Core returns its messages with a code from `js/core/messages.js`, and the UI shows them in the chosen language. A new text needs a key in both dictionaries; `npm test` fails when a key is missing or when a UI module holds English prose.

### Run it locally

Browsers load ES modules over HTTP only, so opening `index.html` from disk does not work.

```bash
npm start          # serves the folder on http://127.0.0.1:8080/
npm start -- 9000  # another port
```

### Specs

```bash
npm test
```

The specs use Node's test runner (Node 24) and the sample data in `spec/fixtures/sample/`. The real-data specs read the folder in `CDR_DATA_DIR` and skip when it is missing:

```bash
CDR_DATA_DIR=/path/to/generator npm test
```

Without the variable they look in `spec/fixtures/real/generator`, which git ignores. `spec/README.md` has the details.

### GitHub Pages

`.github/workflows/pages.yml` runs `npm test` and then publishes `index.html`, `css/` and `js/` to GitHub Pages. The specs, `dev/` and `docs/` stay out of the site.

GitHub runs workflows from `.github/workflows/` at the repository root. In the repository settings, set Pages → Source to GitHub Actions.

### Move the folder to its own repository

1. Create an empty repository on GitHub, for example `coach-data-reviewer`.
2. Copy the content of this folder to the root of the new repository, hidden files included (`.github/`, `.gitignore`).
3. Push to `main`.
4. On GitHub, open "Settings", then "Pages", and set "Source" to "GitHub Actions".
5. The next push runs the workflow. The app then opens at `https://<user>.github.io/<repo>/`.
6. Check `js/core/config.js`: the data path and the pinned tests still point to the athlete app repository, where the trainer's files go.
