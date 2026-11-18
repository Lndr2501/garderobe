# Garderobe

Virtuelle Garderobe als Web-App/PWA (iPhone „Zum Home-Bildschirm“, MacBook im Browser).
Jedes Kleidungsstück wird fotografiert, auf dem Gerät freigestellt und hängt dann an einer
Kleiderstange. Dazu kommen Outfits, ein Trage-Tagebuch, Statistiken, Packlisten und eine
OpenAI-kompatible KI-Schnittstelle.

## Funktionen

- **Schrank**: Kleiderstange (Karussell, echte Bügel im Foto werden erkannt) oder Raster, Filter nach Kategorie, Farbe, Saison und Favoriten, Suche.
- **Fotos**: Kamera, Mediathek, Drag & Drop, Einfügen. Hintergrund wird im Browser entfernt (`@imgly/background-removal`), Ränder werden geglättet und Krümel entfernt, dunkle Fotos automatisch aufgehellt. Vorder- und Rückseite möglich.
- **Bild bearbeiten**: Radierer für Bügel, Hände und Reste, „Foto verbessern“, „Ränder glätten“. In den Einstellungen optimiert „Bilder optimieren“ alle vorhandenen Teile auf einmal.
- **Bildformat**: WebP (auf Safari per WASM-Encoder `@jsquash/webp`), Vollbild 1400 px, Vorschau 640 px.
- **KI** (optional, jede OpenAI-kompatible API): erkennt Name, Kategorie, Farbe und Material, schlägt Outfits vor, Chat-Assistent „Bügel“, Packlisten, Shopping-Check, virtuelle Anprobe (`/images/edits` oder Chat mit Bildausgabe).
- **Ohne KI** laufen alle Vorschläge regelbasiert (Wetter, Farbharmonie, Tragehistorie).
- **Outfits**: Tagesvorschläge nach Wetter (Open-Meteo), Baukasten mit Zufall und Sperren, Avatar-Ansicht.
- **Getragen**: „Anziehen“ im Schrank oder „Heute getragen“ beim Teil; fliesst in Statistik und Vorschläge ein (kein eigener Kalender mehr).
- **Statistik**: Lieblinge, Ladenhüter, Kosten pro Tragen, Farben und Kategorien.
- **Reisen**: Packliste aus Ziel, Datum, Wettervorhersage und Aktivitäten, mit Abhaken.

## Technik

| Teil | Stack |
| --- | --- |
| Frontend | React 19, wouter, TanStack Query (offline gecacht), Vite+ |
| Backend | Cloudflare Worker (Hono), D1 (Daten), KV (Bilder; R2 wird genutzt, sobald ein `BUCKET`-Binding existiert) |
| Auth | Ein App-Passwort (PBKDF2), signiertes Session-Cookie (365 Tage), Login-Drossel, Origin-Prüfung |
| KI | `src/worker/ai.ts`: Streaming (SSE) und JSON, `<think>`-Filter, `/models`, `/images/edits` |

Das Datenbankschema migriert sich beim ersten Request selbst (`src/worker/db.ts`).

## Entwicklung

```bash
npm install
npm run dev          # cf dev (Vite + lokales D1/KV)
npm run typecheck    # Worker + Client
npm test             # Worker-/Unit-Tests (vitest, workerd)
npm run e2e          # Playwright: Desktop-Chrome + iPhone-WebKit, mit Mock-KI
npm run icons        # PNG-Icons aus public/icons/icon.svg
```

Lokal ist die Ersteinrichtung des Passworts in der App erlaubt (`ALLOW_SETUP=true`), in Produktion nicht:
dort wird der Passwort-Hash direkt in D1 (`meta.password_hash`) gesetzt.

## Deploy

```bash
npm run build -- --mode production
cf deploy --prebuilt --mode production
```

## KI einrichten

In der App unter **Einstellungen → KI-Schnittstelle**: Base-URL, API-Key, Text-Modell (optional Vision-
und Bildmodell) eintragen und „Verbindung testen“ drücken. Der Key bleibt auf dem Server.
Voreinstellungen für OpenAI, OpenRouter, Ollama und LM Studio sind eingebaut.
