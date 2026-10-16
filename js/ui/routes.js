// Hash builders for the screens and the parser app.js routes with.

/** @param {string | number} id */
export const exerciseHash = (id) => `#/exercises/${encodeURIComponent(id)}`;

function safeDecode(s) {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/**
 * Splits a hash such as "#/exercises/429" into a screen name and its params.
 * @param {unknown} hash @returns {{ name: string, params: import('./registry.js').RouteParams } | null}
 *   null for a hash that names no screen
 */
export function parseRoute(hash) {
  const [name, a] = String(hash ?? '').replace(/^#\/?/, '').split('/').filter(Boolean).map(safeDecode);
  switch (name) {
    case 'exercises': return { name, params: { id: a } };
    default: return null;
  }
}
