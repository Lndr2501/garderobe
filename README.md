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
- **KI** (optional, jede OpenAI-kompatible API und Cloudflare Workers AI): erkennt Name, Kategorie, Farbe und Material, schlägt Outfits vor, Chat-Assistent „Bügel“, Packlisten, Shopping-Check, virtuelle Anprobe. Für jeden Bereich (Texte, Erkennung, Studio-Bild, Anprobe) lässt sich ein eigener Anbieter und ein eigenes Modell wählen.
- **Studio-Bild**: Aus dem eigenen Foto malt ein Bildmodell (z.B. FLUX.2 auf Cloudflare) ein sauberes Produktfoto mit Volumen („Ghost Mannequin“). Die App stellt es frei und zeigt es auf der Detailseite in 3D (Neigen per Maus oder Handy-Sensor). Auf Cloudflare bleibt die App im Gratis-Kontingent und wartet sonst bis zum nächsten Tag.
- **Ohne KI** laufen alle Vorschläge regelbasiert (Wetter, Farbharmonie, Tragehistorie).
- **Outfits**: Tagesvorschläge nach Wetter (Open-Meteo), Baukasten in Lagen (Oberkörper, Beine, Füsse, Extras – z.B. Thermoshirt → T-Shirt → Pulli → Jacke, Socken → Schuhe) mit Zufall, Sperren, Wärme-Check und 3D-Avatar, der die Lagen auffächert.
- **Getragen**: „Anziehen“ im Schrank oder „Heute getragen“ beim Teil; fliesst in Statistik und Vorschläge ein (kein eigener Kalender mehr).
- **Statistik**: Lieblinge, Ladenhüter, Kosten pro Tragen, Farben und Kategorien.
- **Reisen**: Packliste aus Ziel, Datum, Wettervorhersage und Aktivitäten, mit Abhaken.

## Technik

| Teil | Stack |
| --- | --- |
| Frontend | React 19, wouter, TanStack Query (offline gecacht), Vite+ |
| Backend | Node.js 24 (Hono), SQLite (`node:sqlite`), Bilder als Dateien, eigene Job-Warteschlange für die KI |
| Betrieb | Ein Docker-Container, alle Daten in `/data` (`garderobe.db` + `images/`) |
| Auth | Ein App-Passwort (PBKDF2), signiertes Session-Cookie (365 Tage), Login-Drossel, Origin-Prüfung |
| KI | `src/worker/ai.ts`: Streaming (SSE) und JSON, `<think>`-Filter, `/models`, `/images/edits`, Workers AI · `aisettings.ts`: Anbieter pro Bereich · `studio.ts`: Studio-Bild-Job mit Tagesbudget |

Das Datenbankschema migriert sich beim ersten Request selbst (`src/worker/db.ts`).

## Entwicklung

```bash
npm install
npm run dev          # API auf :8787 (Daten in .dev/data) + Vite mit Hot Reload
npm run typecheck    # Server + Client
npm test             # Server-/Unit-Tests (vitest, SQLite im Speicher)
npm run e2e          # Playwright: Desktop-Chrome + iPhone-WebKit, mit Mock-KI
npm run icons        # PNG-Icons aus public/icons/icon.svg
```

Lokal ist die Ersteinrichtung des Passworts in der App erlaubt (`ALLOW_SETUP=true`), in Produktion nicht:
dort wird der Passwort-Hash direkt in SQLite (`meta.password_hash`) gesetzt.

## Betrieb (Docker)

```bash
docker build -t garderobe .
docker run -d --name garderobe -p 8000:8000 -v /srv/garderobe/data:/data garderobe
```

| Variable | Standard | Zweck |
| --- | --- | --- |
| `DATA_DIR` | `/data` | SQLite-Datei und Bilder |
| `PORT` | `8000` | HTTP-Port |
| `ALLOW_SETUP` | `false` | Passwort-Ersteinrichtung in der App erlauben |
| `TRUST_PROXY` | `true` | `X-Forwarded-Proto/Host` vom Reverse-Proxy übernehmen (für Cookies) |

Der Container braucht HTTPS davor (Reverse-Proxy), sonst funktionieren Service-Worker und Login-Cookie
auf dem iPhone nicht. Backup = den Ordner `/data` sichern.

### Update einspielen

1. Datenbank sichern (läuft im Container, ohne Ausfall):
   ```bash
   docker exec garderobe node --disable-warning=ExperimentalWarning -e \
     "const {DatabaseSync}=require('node:sqlite'); new DatabaseSync('/data/garderobe.db').exec(\"VACUUM INTO '/data/backup-$(date +%Y%m%d-%H%M).db'\")"
   chmod 600 /srv/garderobe/data/backup-*.db   # enthält KI-Schlüssel und Passwort-Hash
   ```
2. Altes Image markieren: `docker tag garderobe garderobe:vor-$(date +%Y%m%d)`
3. Neuen Stand holen (`git pull` oder `git archive <commit>`), dann `docker compose build && docker compose up -d`
4. Prüfen: `/api/health` antwortet mit 200, `/api/items` ohne Login mit 401.

Das Schema migriert sich beim Start selbst. **Zurück:** Container mit dem `vor-…`-Image starten und bei
Bedarf `garderobe.db` durch das Backup ersetzen (alte Versionen kennen neue Spalten nicht).

## KI einrichten

In der App unter **Einstellungen → KI**:

1. Anbieter hinzufügen (Voreinstellungen: Cloudflare, OpenAI, OpenRouter, Ollama, LM Studio, eigener) und „Testen“ drücken.
2. Unter „Wer macht was?“ für Texte, Erkennung, Studio-Bild und Anprobe je Anbieter und Modell wählen.
3. Cloudflare braucht die Account-ID und ein API-Token mit „Workers AI“-Recht. FLUX.2 kostet pro Bild
   etwa 3 000–7 500 Neuronen (je nach Qualität); der Free-Plan hat 10 000 pro Tag.
4. Für Studio-Bilder „Automatisch für alle Teile“ einschalten und „Speichern“. Ist das Tagesbudget
   aufgebraucht, warten die Bilder bis kurz nach Mitternacht (UTC) und laufen dann weiter.

**Cloudflare-Token anlegen:** Dashboard → My Profile → API Tokens → Create Token → Vorlage
„Workers AI“ → Token kopieren und in der App beim Cloudflare-Anbieter eintragen. Die Account-ID
steht im Dashboard rechts unter „Account details“.

Schlüssel bleiben auf dem Server und werden nie wieder angezeigt.

### Studio-Bilder lokal auf einem Mac (FLUX.2 Klein 4B)

Bei **Original freistellen** schickt der App-Server das gespeicherte Foto per SSH
an den Mac. Dort bestimmt macOS Vision den Vordergrund; Muster, Farbe und Logos
werden nicht neu gezeichnet. Hat das Original bereits einen transparenten Hintergrund,
wird seine Maske wiederverwendet. Mit **KI-3D-Variante** lässt sich separat
`Flux2CLI i2i --model klein-4b` starten. Die App legt dafür die Referenz auf ein
weißes Quadrat mit ca. 4 % Rand pro Seite: 512 × 512 für Oberteile und Sneaker,
1024 × 1024 für Hosen und Hausschuhe. Die Prompts berücksichtigen u. a. Strick,
Reißverschluss, Jeanswaschung und Schuhnähte. Trotzdem kann die KI Details verändern.
Beide Varianten liefern ein Bild ohne Hintergrund. Das Original bleibt auswählbar.
Es gibt kein Cloudflare-Kontingent und keinen automatischen Cloud-Fallback für lokale Jobs.

1. **Mac (macOS 14 oder neuer):** „Remote Login“ (Entfernte Anmeldung) aktivieren.
   Der SSH-Benutzer braucht Zugriff auf Flux2CLI und die Klein-4B-Modelle in seinem
   Benutzerkonto. Den Vision-Helfer kompilieren (Xcode Command Line Tools) und beide
   Helfer auf dem Mac installieren:
   ```bash
   mkdir -p "$HOME/.local/libexec"
   xcrun swiftc -O scripts/studio-cutout.swift -o "$HOME/.local/libexec/garderobe-studio-cutout"
   chmod 700 "$HOME/.local/libexec/garderobe-studio-cutout"
   install -m 700 scripts/garderobe-flux.sh "$HOME/.local/libexec/garderobe-flux"
   ```
   Standardpfad ist `/Applications/Flux2CLI`. Bei Bedarf kann das erzwungene SSH-Kommando
   `FLUX2CLI_PATH` auf einen anderen absoluten Pfad setzen. Falls eine Einzeldatei-Installation
   mit „Failed to load the default metallib“ abbricht, braucht sie die passende
   `mlx.metallib` neben dem Programm. Eine Kopie der CLI samt Bibliothek unter
   `~/.local/libexec/garderobe-flux-runtime/` wird automatisch bevorzugt.
2. **SSH:** Einen separaten Ed25519-Schlüssel für die App erzeugen. Den öffentlichen Teil
   beim Mac-Benutzer in `~/.ssh/authorized_keys` auf den Helfer beschränken. Im folgenden
   Beispiel den macOS-Kontonamen und den gesamten öffentlichen Schlüssel ersetzen:
   ```text
   restrict,command="/bin/bash /Users/macuser/.local/libexec/garderobe-flux" ssh-ed25519 AAAA... garderobe
   ```
   Den Hostschlüssel des Macs von einer vertrauenswürdigen Quelle übernehmen, etwa von
   `/etc/ssh/ssh_host_ed25519_key.pub` direkt am Mac. In die serverseitige `known_hosts`
   kommt der konfigurierte Host (bei einem anderen Port: `[host]:port`), gefolgt von
   Schlüsseltyp und öffentlichem Hostschlüssel. Die App akzeptiert keine unbekannten oder
   geänderten Hostschlüssel.
3. **App-Server:** Den privaten App-Schlüssel und `known_hosts` nur lesbar in den
   Container mounten, z. B. unter `/run/flux-ssh/`. Der Nutzer des Node-Prozesses muss
   sie lesen können (privater Schlüssel: Modus `0600`). Keine Schlüssel ins Repo oder
   in die App-Einstellungen kopieren. Beispiel für die Serverumgebung:
   ```dotenv
   FLUX_SSH_HOST=mac.example.lan
   FLUX_SSH_USER=macuser
   FLUX_SSH_PORT=22
   FLUX_SSH_KEY_FILE=/run/flux-ssh/id_ed25519
   FLUX_SSH_KNOWN_HOSTS=/run/flux-ssh/known_hosts
   ```
   Bei einem Betrieb ohne Docker muss der OpenSSH-Client (`ssh`) im `PATH` liegen.
4. **App:** Unter **Einstellungen → KI → Studio-Bild** den Anbieter **FLUX.2 Klein 4B
   (Mac per SSH)** wählen und speichern. Dann in einem Teil **Original freistellen** drücken.
   Aktiviere **Automatisch für alle Teile** nur, wenn auch bestehende Teile ohne
   Studio-Bild und neue Uploads automatisch verarbeitet werden sollen. Der Mac
   muss für die Verarbeitung wach und vom App-Server erreichbar sein.
