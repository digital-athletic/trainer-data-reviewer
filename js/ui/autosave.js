// Keeps a copy of the current work file in localStorage, one entry per data fingerprint.
import * as workfile from '../core/workfile.js';

const PREFIX = 'cdr.work.';

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

  /**
   * @param {string} fingerprint data fingerprint the backup belongs to
   * @param {() => Backup | null} build returns the backup to write, or null when there is nothing to keep
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

  /** Writes the backup now. */
  flush() {
    this.cancel();
    try {
      const backup = this.#build();
      if (backup) localStorage.setItem(this.#key, JSON.stringify(backup));
      else localStorage.removeItem(this.#key);
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

  /** @returns {SavedWork | null} */
  read() {
    try {
      const entry = JSON.parse(localStorage.getItem(this.#key) ?? 'null');
      if (typeof entry?.text !== 'string') return null;
      const parsed = workfile.parse(entry.text);
      return parsed.ok ? { work: parsed.value, unsaved: entry.unsaved !== false } : null;
    } catch {
      return null;
    }
  }

  forget() {
    this.cancel();
    try {
      localStorage.removeItem(this.#key);
    } catch {
      // Storage is unavailable, so there is no backup to delete.
    }
  }
}
