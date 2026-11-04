/*
 * Baut Einzeldatei-Versionen des Spiels (CSS und JavaScript eingebettet):
 *
 *   npm run build:artifact → artifact/space-towers.html
 *     für claude.ai; Mehrspieler über die "room"-Fähigkeit
 *   npm run build:pages    → dist/pages/index.html
 *     für GitHub Pages; Mehrspieler per Peer-to-Peer (PeerJS)
 */
'use strict';
const fs = require('fs');
const path = require('path');

const mode = process.argv[2] === 'pages' ? 'pages' : 'artifact';
const root = path.join(__dirname, '..');
const pub = path.join(root, 'public');
const read = (f) => fs.readFileSync(path.join(pub, f), 'utf8');
const inlineScript = (code) => '<script>\n' + code.replace(/<\/script/gi, '<\\/script') + '\n</script>';

const html = read('index.html');
let body = html.slice(html.indexOf('<body>') + 6, html.indexOf('</body>'));
const icon = 'data:image/svg+xml;base64,' + Buffer.from(read('icon.svg')).toString('base64');

if (mode === 'pages') {
  // PeerJS und die Peer-Verbindung vor room-transport.js einhängen
  body = body.replace(
    '<script src="room-transport.js"></script>',
    '<script>window.ST_STATIC = true;</script>\n' +
    '  <script src="https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js"></script>\n' +
    '  <script src="peer-transport.js"></script>\n' +
    '  <script src="room-transport.js"></script>'
  );
}

const inlined = body
  .replace(/<script src="(?!https?:)([^"]+)"><\/script>/g, (m, src) => inlineScript(read(src)))
  .trim()
  .replace('src="icon.svg"', 'src="' + icon + '"');

const head =
  '<meta charset="utf-8">\n' +
  '<title>Space Towers</title>\n' +
  '<meta name="description" content="Tri-Peaks-Solitaire im Weltraum. Allein oder mit Freunden im Browser.">\n' +
  '<link rel="icon" href="' + icon + '">\n' +
  '<style>\n' + read('style.css') + '\n</style>\n';

let out, dest;
if (mode === 'pages') {
  out = '<!doctype html>\n<html lang="de">\n<head>\n' +
    '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, user-scalable=no">\n' +
    '<meta name="theme-color" content="#070b1f">\n' +
    head + '</head>\n<body>\n' + inlined + '\n</body>\n</html>\n';
  dest = path.join(root, 'dist', 'pages', 'index.html');
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(path.join(path.dirname(dest), '.nojekyll'), '');
} else {
  out = head + inlined + '\n';
  dest = path.join(root, 'artifact', 'space-towers.html');
}
fs.writeFileSync(dest, out);
console.log('geschrieben:', path.relative(process.cwd(), dest), (out.length / 1024).toFixed(1) + ' KB');
