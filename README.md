# restlos

Schulden-Tracker im Browser: Schulden erfassen, Tilgungsplan sehen und wissen, in wie vielen Monaten du schuldenfrei bist. Ohne Server, deine Daten bleiben lokal.

## Funktionen

- **Countdown:** Wie viele Monate noch bis schuldenfrei, plus Monat der letzten Rate.
- **Überblick:** Restschuld, monatliche Rate gesamt, Zinsen bis zum Ende und Fortschritt in Prozent.
- **Verlauf:** Gestapeltes Diagramm der Restschuld je Schuld (mit Maus, Touch und Pfeiltasten bedienbar).
- **Raten als Festbetrag oder prozentual** (z. B. Kreditkarte: 3 % vom Restbetrag, mindestens 25 €).
- **Tilgungsplan** pro Schuld mit Rate, Zinsen und Restbetrag je Monat.
- **Nächste Zahlungen** nach Monat gruppiert.
- **Warnungen**, wenn eine Rate die Zinsen nicht deckt oder die Tilgung über 50 Jahre dauert.
- **Import / Export** als JSON (Datei oder Zwischenablage), mit Ersetzen oder Ergänzen.
- **Hell- und Dunkelmodus** nach Systemeinstellung.

## So wird gerechnet

- Zinsen fallen monatlich an: Zinssatz p. a. ÷ 12 auf den Restbetrag, auf Cent gerundet.
- Prozentuale Raten beziehen sich auf den Restbetrag inklusive Monatszinsen, nie unter dem Mindestbetrag.
- Raten mit einem Datum vor heute gelten als bezahlt.
- Fällt die Rate z. B. auf den 31., wird sie in kürzeren Monaten am letzten Tag fällig.
- Die Prognose reicht höchstens 50 Jahre.

## Starten

Es gibt keinen Build-Schritt und keine Abhängigkeiten. Die App lädt nichts von externen Servern (auch keine Schriften).

`index.html` direkt im Browser öffnen oder einen kleinen lokalen Server starten:

```bash
python3 -m http.server 8000
# dann http://localhost:8000 öffnen
```

Läuft auch auf jedem statischen Hosting (z. B. GitHub Pages).

## Projektstruktur

```
index.html          Markup
css/style.css       Styles, Farben (inkl. Dark Mode) und @font-face
js/app.js           Rechenlogik (zwischen LOGIC-START und LOGIC-END, ohne DOM) und Oberfläche
assets/fonts/       Recursive als WOFF2 (latin, latin-ext) + Lizenz
assets/favicon.svg  Icon
```

## Daten

Alles liegt im `localStorage` deines Browsers unter dem Schlüssel `restlos.v1`. Auf anderen Geräten oder nach dem Löschen der Browserdaten sind die Daten weg, also ab und zu über „Import / Export“ sichern.

Export-Format:

```json
{
  "app": "Restlos",
  "version": 1,
  "exportedAt": "2026-10-01T08:00:00.000Z",
  "debts": [
    {
      "id": "d…",
      "name": "Autokredit",
      "amount": 9800,
      "startAmount": 15000,
      "rate": 5.9,
      "mode": "fixed",
      "payment": 289,
      "percent": 0,
      "minPayment": 0,
      "firstDue": "2026-11-01",
      "dueDay": 1,
      "color": 0,
      "createdAt": null
    }
  ]
}
```

`mode` ist `"fixed"` (dann zählt `payment`) oder `"percent"` (dann zählen `percent` und `minPayment`).

## Lizenzen

- Code: siehe [LICENSE](LICENSE).
- Schrift [Recursive](https://github.com/arrowtype/recursive): SIL Open Font License 1.1, siehe [assets/fonts/OFL.txt](assets/fonts/OFL.txt).
