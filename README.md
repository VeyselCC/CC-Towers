# 🚀 Space Towers

Tri-Peaks-Solitaire im Weltraum, mit normalen Spielkarten. Du spielst allein oder mit bis zu 8 Freunden gleichzeitig im Browser.

## Spielregeln

- Drei Türme aus **28 Karten**. Spielbar sind nur **offene** Karten, also Karten, die von keiner anderen verdeckt werden.
- Lege eine offene Karte auf die Ablage, wenn ihr Wert **genau eins höher oder tiefer** ist. Die Farbe ist egal. Auf eine 7 passt also eine 6 oder eine 8.
- Optional gilt **König ↔ Ass**: Auf einen König darf ein Ass folgen und umgekehrt.
- Passt keine Karte, ziehst du eine neue vom **Nachziehstapel** (23 Karten).
- **Bonus-Stapel:** Legst du 3 Karten in Folge ab, erscheint ein Bonus-Stapel mit 3 Zusatzkarten. Sie passen der Reihe nach auf die Ablage und verlängern deine Kette. Ziehst du eine neue Karte, verschwindet er.
- Ziel: alle drei Türme abräumen, bevor der Stapel leer ist.

### Punkte

| Aktion | Punkte |
| --- | --- |
| Karte in einer Kette (1., 2., 3. …), auch vom Bonus-Stapel | 10, 20, 30 … |
| Turmspitze abgeräumt (1. und 2. Turm) | +250 |
| Alle drei Türme abgeräumt | +1000 |
| Jede übrige Stapelkarte beim Sieg | +50 |

Ziehst du vom Stapel, beginnt die Kette wieder bei 10 Punkten.

## Mit Freunden spielen

1. Auf **Raum erstellen** tippen. Du bekommst einen 4-stelligen Code.
2. Den **Einladungslink** an deine Freunde schicken, oder sie geben den Code unter **Beitreten** ein.
3. Als Host stellst du Runden (Standard **10**), Zeit pro Runde und König ↔ Ass ein und startest das Turnier.
4. In jeder Runde bekommen alle **dasselbe Kartenblatt**. Die Punkte jeder Runde werden zur Gesamtpunktzahl addiert.
5. **💀 Totenkopf:** Ab 3 Spielern scheidet nach bestimmten Runden der Spieler mit den wenigsten Gesamtpunkten aus und schaut ab dann zu. Das passiert so oft, dass am Ende zwei Spieler übrig sind, gleichmäßig über das Turnier verteilt (bei 4 Spielern und 10 Runden nach Runde 3 und 7). Neben der Rundenanzeige steht dann der Totenkopf.
6. Es gewinnt, wer bis zum Schluss dabei ist und die meisten Gesamtpunkte hat.

Während des Spiels siehst du live, wie weit die anderen sind, und kannst Emojis schicken. Lädst du die Seite neu oder bricht kurz die Verbindung ab, kommst du automatisch zurück ins Spiel. Dafür hast du 30 Sekunden Zeit.

Der Server prüft jeden Zug selbst. Ungültige Züge oder falsche Punktzahlen sind dadurch nicht möglich.

## Sofort spielen (ohne eigenen Server)

Das Spiel ist als claude.ai-Artifact veröffentlicht: **https://claude.ai/artifact/FashYrL3JVpGCbG6xiB6c9**

- Solo funktioniert sofort.
- Für den Mehrspieler-Modus teilst du die Seite über das **Share-Menü** des Artifacts mit deinen Freunden. Sie brauchen dafür ein claude.ai-Konto. Dann erstellst du einen Raum und nennst ihnen den 4-stelligen Code.
- Technisch läuft der Mehrspieler-Modus dort über die eingebaute „room“-Funktion von claude.ai statt über `server.js`. Der Browser des Hosts übernimmt die Rolle des Servers, und jeder Browser prüft alle Züge durch Nachspielen ab dem gemeinsamen Seed. Verlässt der Host die Seite, übernimmt automatisch ein anderer Spieler.
- Neu bauen nach Änderungen: `npm run build:artifact` erzeugt `artifact/space-towers.html`.

## Auf GitHub Pages (kostenlos, ohne Server)

Die Datei `dist/pages/index.html` (gebaut mit `npm run build:pages`) liegt im Branch `gh-pages`. Ist GitHub Pages für diesen Branch eingeschaltet, läuft das Spiel unter **https://veyselcc.github.io/CC-Towers/**.

- Mehrspieler läuft dort direkt zwischen den Browsern (Peer-to-Peer über den kostenlosen Dienst [PeerJS](https://peerjs.com)). Deine Freunde brauchen kein Konto: Raum erstellen, Einladungslink schicken, fertig.
- Der Browser des Raumerstellers ist der Knotenpunkt. Schließt er die Seite, übernimmt automatisch ein anderer Spieler.
- In manchen Firmen- oder Schulnetzen sind solche Direktverbindungen gesperrt. Dann hilft ein anderes Netz (z. B. mobile Daten) oder der eigene Server unten.
- Aktualisieren nach Änderungen: `npm run build:pages`, dann den Inhalt von `dist/pages/` in den Branch `gh-pages` übernehmen.

## Starten (eigener Server)

Du brauchst nur [Node.js](https://nodejs.org) ab Version 18. Weitere Pakete sind nicht nötig.

```bash
npm start
# → http://localhost:3000
```

Im selben WLAN können Freunde über `http://<deine-IP>:3000` mitspielen.

### Online stellen (kostenlos)

Damit Freunde von überall mitspielen können, muss der Server im Internet laufen, zum Beispiel bei [Render](https://render.com):

1. Dort mit GitHub anmelden und **New → Blueprint** wählen.
2. Dieses Repository auswählen. Die Datei `render.yaml` richtet alles automatisch ein.
3. Nach ein paar Minuten bekommst du eine Adresse wie `https://space-towers.onrender.com`. Diesen Link schickst du deinen Freunden.

Andere Node-Hoster wie Railway oder Fly.io funktionieren genauso: Startbefehl `node server.js`, den Port liest der Server aus der Umgebungsvariable `PORT`.

## Steuerung

| Taste | Aktion |
| --- | --- |
| Klick / Tippen | Karte ablegen bzw. nachziehen |
| Leertaste | Nachziehen |
| Z | Rückgängig (nur solo) |
| H | Hilfe (spielbare Karten hervorheben) an/aus |
| M | Ton an/aus |
| Esc | Menü |

## Entwicklung

```bash
npm test   # Tests für Spiellogik und Server
```

| Datei | Inhalt |
| --- | --- |
| `public/game.js` | Spiellogik, gemeinsam für Browser und Server |
| `public/app.js` | Oberfläche, Animationen, Sound, Netzwerk |
| `public/style.css` | Design |
| `server.js` | HTTP- und WebSocket-Server ohne Abhängigkeiten, Spielräume |
| `public/room-transport.js` | Mehrspieler über claude.ai „room“, wenn die Seite als Artifact läuft |
| `scripts/build-artifact.js` | baut die Einzeldatei `artifact/space-towers.html` |
