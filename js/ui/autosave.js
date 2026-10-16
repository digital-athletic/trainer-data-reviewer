// Keeps a copy of the current work file in localStorage, one entry per data fingerprint.
// Each backup belongs to one Exercises.json: the app offers only the entry of the loaded file.
import * as workfile from '../core/workfile.js';

/** The localStorage key of a backup is this prefix plus the data fingerprint. */
export const PREFIX = 'cdr.work.';

/**
 * @typedef {{ unsaved: boolean, text: string }} Backup  text is the work file, unsaved tells whether
 *   the trainer has saved this work as a file since the last change.
 * @typedef {{ work: import('../core/workfile.js').Work, unsaved: boolean }} SavedWork
 */

export class AutoSave {
  #key;
  #build;
  #delay;
  #onFail;
  /** @type {ReturnType<typeof setTimeout> | null} */
  #timer = null;
  #failed = false;
  #written = false;

  /**
   * @param {string} fingerprint data fingerprint the backup belongs to
   * @param {() => Backup | null} build returns the backup to write, or null when the session has no commands
   * @param {{ delay?: number, onFail?: () => void }} [opts] onFail runs once when the browser refuses to store
   */
  constructor(fingerprint, build, { delay = 400, onFail = () => {} } = {}) {
    this.#key = PREFIX + fingerprint;
    this.#build = build;
    this.#delay = delay;
    this.#onFail = onFail;
  }

  /** Writes the backup once changes have paused. */
  schedule() {
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = setTimeout(() => this.flush(), this.#delay);
  }

  /**
   * Writes the backup now. Until this AutoSave has written a backup, a session without commands
   * keeps the stored one: it belongs to an earlier session, and the trainer decides on it.
   * After the first write, a session without commands removes it.
   */
  flush() {
    this.cancel();
    try {
      const backup = this.#build();
      if (backup) {
        localStorage.setItem(this.#key, JSON.stringify(backup));
        this.#written = true;
      } else if (this.#written) {
        localStorage.removeItem(this.#key);
      }
    } catch {
      if (this.#failed) return;
      this.#failed = true;
      this.#onFail();
    }
  }

  /** Drops a pending write. */
  cancel() {
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = null;
  }

  /** Returns the backup of this fingerprint, or null. @returns {SavedWork | null} */
  read() {
    try {
      const entry = JSON.parse(localStorage.getItem(this.#key) ?? 'null');
      if (typeof entry?.text !== 'string' || entry.text.length > workfile.MAX_FILE_BYTES) return null;
      const parsed = workfile.parse(entry.text);
      return parsed.ok ? { work: parsed.value, unsaved: entry.unsaved !== false } : null;
    } catch {
      return null;
    }
  }

  /** Removes the backup of this fingerprint and drops a pending write. */
  forget() {
    this.cancel();
    try {
      localStorage.removeItem(this.#key);
    } catch {
      // Storage is unavailable, so there is no backup to delete.
    }
  }
}
