/*
 * Baut artifact/space-towers.html: eine einzelne HTML-Datei mit allem
 * eingebettet (CSS, Spiellogik, Oberfläche). Sie läuft als claude.ai-Artifact
 * (Mehrspieler über die "room"-Fähigkeit) oder einfach lokal im Browser (solo).
 * Aufruf: npm run build:artifact
 */
'use strict';
const fs = require('fs');
const path = require('path');

const pub = path.join(__dirname, '..', 'public');
const read = (f) => fs.readFileSync(path.join(pub, f), 'utf8');
const html = read('index.html');

const body = html.slice(html.indexOf('<body>') + 6, html.indexOf('</body>'));
const inlined = body.replace(/<script src="([^"]+)"><\/script>/g, (m, src) =>
  '<script>\n' + read(src).replace(/<\/script/gi, '<\\/script') + '\n</script>');

const icon = 'data:image/svg+xml;base64,' + Buffer.from(read('icon.svg')).toString('base64');
const out =
  '<title>Space Towers</title>\n' +
  '<meta name="description" content="Tri-Peaks-Solitaire im Weltraum. Allein oder mit Freunden im Browser.">\n' +
  '<link rel="icon" href="' + icon + '">\n' +
  '<style>\n' + read('style.css') + '\n</style>\n' +
  inlined.trim().replace('src="icon.svg"', 'src="' + icon + '"') + '\n';

const dest = path.join(__dirname, '..', 'artifact', 'space-towers.html');
fs.writeFileSync(dest, out);
console.log('geschrieben:', path.relative(process.cwd(), dest), (out.length / 1024).toFixed(1) + ' KB');
