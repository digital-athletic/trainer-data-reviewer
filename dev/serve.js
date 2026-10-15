// Serves the app folder for local development: node dev/serve.js [port]
import { createServer } from 'node:http';
import { readFile, realpath, stat } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';

const ROOT = await realpath(join(import.meta.dirname, '..'));
const HOST = '127.0.0.1';
const PORT = Number(process.argv[2] ?? process.env.PORT ?? 8080);

const MIME = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.md', 'text/markdown; charset=utf-8'],
  ['.png', 'image/png'],
  ['.ico', 'image/x-icon'],
  ['.txt', 'text/plain; charset=utf-8']
]);

const inRoot = (file) => file === ROOT || file.startsWith(ROOT + sep);

// Maps a URL path to a file inside ROOT, or null when the path leaves ROOT.
function resolvePath(urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return null;
  }
  if (decoded.includes('\0')) return null;
  const file = normalize(join(ROOT, decoded));
  return inRoot(file) ? file : null;
}

// Dot folders and files (.git, .github, .env) stay private.
const isHidden = (urlPath) => urlPath.split('/').some((seg) => seg.startsWith('.'));

// Follows symlinks and refuses a target outside ROOT.
async function findFile(file) {
  const info = await stat(file);
  const real = await realpath(info.isDirectory() ? join(file, 'index.html') : file);
  if (!inRoot(real)) throw new Error('Outside the app folder');
  return real;
}

const send = (res, status, body, type = 'text/plain; charset=utf-8') => {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(body);
};

const server = createServer(async (req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed');
  const { pathname } = new URL(req.url ?? '/', 'http://localhost');
  const file = resolvePath(pathname);
  if (!file) return send(res, 403, 'Forbidden');
  if (isHidden(file.slice(ROOT.length).split(sep).join('/'))) return send(res, 404, 'Not found');
  try {
    const target = await findFile(file);
    const body = await readFile(target);
    const type = MIME.get(extname(target).toLowerCase()) ?? 'application/octet-stream';
    return send(res, 200, req.method === 'HEAD' ? undefined : body, type);
  } catch {
    return send(res, 404, 'Not found');
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Coach data reviewer: http://${HOST}:${PORT}/`);
});
