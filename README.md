# 🚀 Space Towers

Tri-Peaks-Solitaire im Weltraum, mit normalen Spielkarten. Du spielst allein oder mit bis zu 8 Freunden gleichzeitig im Browser.

## Spielregeln

- Drei Türme aus **28 Karten**. Spielbar sind nur **offene** Karten, also Karten, die von keiner anderen verdeckt werden.
- Lege eine offene Karte auf die Ablage, wenn ihr Wert **genau eins höher oder tiefer** ist. Die Farbe ist egal. Auf eine 7 passt also eine 6 oder eine 8.
- Optional gilt **König ↔ Ass**: Auf einen König darf ein Ass folgen und umgekehrt.
- Passt keine Karte, ziehst du eine neue vom **Nachziehstapel** (23 Karten).
- Ziel: alle drei Türme abräumen, bevor der Stapel leer ist.

### Punkte

| Aktion | Punkte |
| --- | --- |
| Karte in einer Kette (1., 2., 3. …) | 10, 20, 30 … |
| Turmspitze abgeräumt (1. und 2. Turm) | +250 |
| Alle drei Türme abgeräumt | +1000 |
| Jede übrige Stapelkarte beim Sieg | +50 |

Ziehst du vom Stapel, beginnt die Kette wieder bei 10 Punkten.

## Mit Freunden spielen

1. Auf **Raum erstellen** tippen. Du bekommst einen 4-stelligen Code.
2. Den **Einladungslink** an deine Freunde schicken, oder sie geben den Code unter **Beitreten** ein.
3. Als Host stellst du Runden (1–10), Zeit pro Runde und König ↔ Ass ein und startest das Spiel.
4. Alle bekommen **dasselbe Kartenblatt**. Wer die meisten Punkte holt, gewinnt die Runde. Bei Gleichstand gewinnt, wer weniger Restkarten hat. Am Ende zählt die Gesamtpunktzahl.

Während des Spiels siehst du live, wie weit die anderen sind, und kannst Emojis schicken. Lädst du die Seite neu oder bricht kurz die Verbindung ab, kommst du automatisch zurück ins Spiel. Dafür hast du 30 Sekunden Zeit.

Der Server prüft jeden Zug selbst. Ungültige Züge oder falsche Punktzahlen sind dadurch nicht möglich.

## Starten

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
