# Coach data reviewer

The coach data reviewer is a web page. You use it to check and correct the exercise catalog (Übungskatalog) that the app builds training plans from. It also reads the skill trees (Skill Trees) to show where each exercise is used. You need no extra software. The page reads your data files inside the browser and never uploads them.

The app has one screen:

- **Exercises**: the whole exercise catalog with search and filters. Open an exercise to change its name, levels, tags, start values (Startwerte) and target values (Zielwerte).

## For the trainer

### 1. Open the app

Open the address the developer gave you, for example `https://<user>.github.io/<repo>/`, in Chrome, Edge or Firefox. Save it as a bookmark.

### 2. Choose the data folder

The app does not contain the training data. You keep the data folder on your computer.

1. Get the data folder `generator`: download the project from GitHub ("Code", then "Download ZIP") and unzip it. The folder is `athlete-mobile/assets/data/generator`. The developer can also send it to you.
2. In the app, click "Choose data folder" and choose the folder `generator`.
3. The browser asks whether to upload all files in the folder (about 110). Confirm it. Nothing leaves your computer: "upload" here means the page may read the files inside this browser window.

The header then shows "1,210 exercises · 852 branches · 27 skill trees". If you chose the wrong folder, the app tells you what it expected.

### 3. Correct the exercises

1. Find an exercise in the **Exercises** list by id or name, or narrow the list with the filters. Click a row to open it.
2. Correct the exercise where needed. "Undo" (or Ctrl+Z) takes back the last change.

The badge at the top shows how many changes you have not exported yet.

### 4. Export and send the files

1. Click **Export changes**. The app lists every changed file.
2. Click "Download all" and "Download changelog.md".
3. If the browser saved a file as `Exercises (1).json`, rename it to `Exercises.json`.
4. Send the files and `changelog.md` to the developer, or upload them on GitHub: open the matching folder on the project page, click "Add file", then "Upload files", and drop the files in. Paste the text of `changelog.md` into the description.

The export dialog shows where each file belongs, for example `Exercises.json` goes into the `generator` folder. `changelog.md` lists every change with the old and the new value, plus notes the developer needs.

### 5. Save the work file

The work file holds all your changes in one file.

1. Click "Work file" at the top, then "Save work file".
2. The browser saves `coach-review-work-DATE.json` in your downloads folder. Keep the newest one.

The app also keeps a backup of your work in this browser after every change. When you choose the same data folder again, it offers to restore that backup. The backup stays in this browser only, so save the work file before you switch computers or clear the browser data.

### 6. Next time

1. Open the app and choose the data folder.
2. Click "Open work file" and pick the newest `coach-review-work-DATE.json`. Your changes come back.

If the developer has merged your changes in the meantime, get a fresh data folder first. The app then warns that the work file belongs to other data files and lists the changes that no longer fit.

### Good to know

- **Ids stay reserved.** A deleted exercise keeps its number forever, because athletes may have trained it. New exercises always get a new number.
- **Pause cannot be deleted.** Exercise 999999 (Pause) is a system exercise.
- **Empty value cells are not always a mistake.** The training plan fills some empty start and target values from its intensity settings.
- **Chrome may ask about several downloads.** Click "Allow" so all files download.
- **Shortcuts:** `/` jumps to the search box, Ctrl+Z undoes the last change, Esc closes a dialog.

## For the developer

The app is plain HTML, CSS and native ES modules. It has no build step and no dependencies. `index.html` loads `js/ui/main.js`, every path is relative, so the app runs under any sub-path. `docs/core-api.md` lists the modules in `js/core/`. `js/core/config.js` holds the values that depend on the target repository: the data path and the pinned tests.

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
CDR_DATA_DIR=/path/to/generator npm run test:real
```

Without the variable they look in `spec/fixtures/real/generator`, which git ignores. `spec/README.md` has the details.

### GitHub Pages

`.github/workflows/pages.yml` runs `npm test` and then publishes `index.html`, `css/` and `js/` to GitHub Pages. The specs, `dev/` and `docs/` stay out of the site. `.nojekyll` tells Pages to serve the files as they are.

GitHub reads workflows only from the root of a repository, so the workflow starts to work once this folder is its own repository.

### Move the folder to its own repository

1. Create an empty repository on GitHub, for example `coach-data-reviewer`.
2. Copy the content of this folder to the root of the new repository, hidden files included (`.github/`, `.gitignore`, `.nojekyll`).
3. Push to `main`.
4. On GitHub, open "Settings", then "Pages", and set "Source" to "GitHub Actions".
5. The next push runs the workflow. The app then opens at `https://<user>.github.io/<repo>/`.
6. Check `js/core/config.js`: the data path and the pinned tests still point to the athlete app repository, where the trainer's files go.
