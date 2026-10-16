// Screens register here when their module loads; app.js routes to them.

/**
 * @typedef {{ id?: string }} RouteParams
 *   The `exercises` route sets `id`. Absent route parts stay `undefined`.
 * @typedef {{ ds: import('../core/model.js').Dataset, editor: import('../core/edits.js').Editor,
 *   review: import('../core/review.js').ReviewStatus, navigate: (hash: string) => void }} Ctx
 *   The session context app.js hands to every view. review is the review part of the work file.
 * @typedef {{
 *   render:(root: HTMLElement, ctx: Ctx, params: RouteParams, signal: AbortSignal) => void,
 *   onDataChange?: (ctx: Ctx) => void }} ViewSpec
 *   Without onDataChange the app renders the view again after each edit. The signal aborts
 *   when the app renders another screen.
 */

/** @type {Map<string, ViewSpec>} */
const views = new Map();

/** @param {string} name @param {ViewSpec} spec */
export function registerView(name, spec) {
  views.set(name, spec);
}

/** @param {string} name @returns {ViewSpec | undefined} */
export const getView = (name) => views.get(name);
