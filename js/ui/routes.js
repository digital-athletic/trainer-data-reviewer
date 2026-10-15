// Hash builders for the screens. app.js parses the same shapes.

/** @param {string | number} id */
export const exerciseHash = (id) => `#/exercises/${encodeURIComponent(id)}`;
