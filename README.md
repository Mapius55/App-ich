# Bucket List

**Deine Ziele. Deine Zeit.** Die App läuft unter https://mapius55.github.io/bucket-list/ (bis das Repository umbenannt ist, noch unter https://mapius55.github.io/App-ich/; sie funktioniert unter beiden Adressen).

Ein persönlicher Coach für deine Zeit und für die Träume, die du in deinem Leben noch erleben möchtest. Beim ersten Öffnen lernt er dich im Gespräch kennen: wer du bist, was du machst, was dir wichtig ist und welche Natur du liebst. Danach begrüsst dich jedes Mal ein leuchtender Kreis. Er fragt, wie es dir geht, sagt dir das Wichtigste zuerst (z.B. ein Rennen am Wochenende) und hilft dir, einen Fokus für den Tag zu finden.

## Marke
- **Name:** Bucket List, Untertitel „Deine Ziele. Deine Zeit.“ (früher hiess die App „I am“)
- **Logo:** „Bucket“ und „List“ auf zwei Zeilen, zentriert, in Bodoni Moda, auf dem blauen Pinsel-Hintergrund. Dateien liegen in `brand/` (`wordmark.svg`, `icon.svg`, `banner.svg`, `banner.png`), die App-Icons in `public/`. Neu erzeugen lassen sie sich mit `scripts/brand/` (siehe Kommentar in `make.cjs`).
- **Schriften:** Inter Tight (fette Titel in Grossbuchstaben, Labels, Knöpfe) und Bodoni Moda (Logo, Text des Coaches). Beide sind frei (SIL Open Font License).
- **Farben:** Das Blau gehört nur zum Logo. Die App nimmt **Farbwelten**: abgestimmte Kombinationen aus fünf Farben (z.B. „Tannennacht“, „Erstes Licht“, „Sommerhimmel“, „Glut“, „Regenblau“) in `src/lib/worlds.ts`, gebaut nach Harmonie-Regeln aus der Forschung (nahe Farbtöne, klare Helligkeitsstufen, keine trüben Braun- oder Olivtöne) und mit Wadas „Dictionary of Color Combinations“ als Vorlage. Welche Welt gilt, hängt vom Sonnenstand an deinem Ort, Wetter, Jahreszeit und Höhe über Meer ab. Zwischen zwei Welten wird fliessend über den Farbkreis gewechselt (OKLCh), nie über Grau. Stimmung und Lieblingsnatur färben leicht mit. Welche Welt gerade gilt, zeigt beim Kreis die Pille „Farben heute“.
- **Hintergrund:** Fast schwarzer Grund, darauf Lichtfelder in den Farben der Welt, als Pinselstreifen. Die Felder überlagern sich wie Licht, nicht wie Farbe, deshalb entsteht kein Braun (WebGL, in niedriger Auflösung, schont den Akku).
- **Kreis:** Ein flacher Kreis, wie aus Papier ausgeschnitten, durch den man auf weiche, ineinanderfliessende Farben sieht, wie unscharfe Wolken mit feinem Korn. Sie ziehen, falten sich, wirbeln ab und zu und folgen dem Wetter. Drückt man darauf, kommt der Himmel näher. Zieht man den Finger, verschiebt sich der Himmel. Er reagiert auch auf die Stimme und auf jedes Wort des Coaches.
- **Animationen:** Die Wörter des Coaches erscheinen weich, Seiten zoomen ineinander, Elemente gleiten herein.

## Was schon funktioniert

- **Login mit Benutzername und Passwort.** Danach bleibst du eingeloggt und landest bei jedem Öffnen direkt beim Kreis.
- **Kennenlernen (Onboarding)** als Gespräch mit der KI (Claude), etwa acht bis zehn Fragen.
- **Der Kreis und der Himmel**: Die Farben entstehen aus dem Sonnenstand an deinem Ort, der Jahreszeit, dem Live-Wetter (Open-Meteo), der Höhe über Meer, deiner Stimmung und deiner Lieblingsnatur (siehe *Marke*).
- **Sprachmodus**: Der Kreis füllt den Bildschirm, der Coach spricht mit einer echten Stimme (ElevenLabs, warme weibliche Stimme) und zeigt keinen Text. Du tippst auf den weissen Knopf und sprichst. Die App merkt an der Pause, wann du fertig bist, und schickt ab. Tippst du während der Coach spricht, unterbrichst du ihn. „Nochmal hören“ spielt die letzte Antwort erneut ab. Ein kleines Tastatur-Symbol öffnet bei Bedarf ein Textfeld, die Antwort kommt trotzdem als Stimme. Ohne ElevenLabs-Schlüssel spricht die Stimme des Handys.
- **Täglicher Check-in**: Der Coach fragt, wie es dir geht, sagt dir das Wichtigste zuerst und hilft, einen Fokus zu setzen. Der Fokus steht unter der Begrüssung, darunter die nächsten Termine der Woche.
- **Gedächtnis**: Der Coach merkt sich vor allem
  - deine **Energie**: wann du viel oder wenig hast, was sie dir gibt oder nimmt, und Muster über die letzten zwei Wochen,
  - **wohin du gehst**: Reisen, Ausflüge, Trainingsorte,
  - **Rennen und Termine** mit Datum. Danach fragt er, wie es lief.

  Smalltalk und zu Persönliches speichert er nicht. Einmal am Tag räumt er still auf und löscht, was unwichtig, zu persönlich, doppelt oder lange vorbei ist. Was du selbst einträgst oder bearbeitest, lässt er stehen. Alles ist unter Du → „Was ich über dich weiss“ sichtbar und lässt sich ändern oder löschen.
- **Bucket List**: Rechts vom Kreis stehen zuoberst die Träume, die du in deinem Leben noch erleben möchtest. Erzählst du dem Coach davon („einmal Polarlichter sehen“), setzt er sie auf die Liste. Erfüllte Träume bleiben als schöne Erinnerung stehen: Sie leuchten im Farbfluss des Kreises, mit Datum und dem, was du davon erzählt hast. Darunter folgen konkrete Ziele (Training, Prüfung, Projekt) und Gewohnheiten.
- **Zeit, die nicht verloren geht**: Das Jahr zeigt sanft, wie viel davon vorbei ist und welche Träume und Ziele darin noch offen sind. Ganz unten liegt „Leben“: 90 Jahre in Wochen, jede Woche ein Punkt (braucht nur dein Geburtsjahr). Und im Gespräch erinnert dich der Coach ab und zu an einen Traum, der lange liegt oder für den bald ein guter Moment kommt.
- **Kalender „Bucket List“**: Erzählst du dem Coach von einem Termin (z.B. „Samstag um 9 habe ich ein Rennen“), trägt er ihn direkt ein, mit Erinnerung 30 Minuten vorher. Ganztägige Termine erinnern um 8 Uhr. Dein iPhone abonniert den Kalender einmal, danach erscheint alles von selbst. Feste Zeiten, die jede Woche wiederkehren („Dienstag und Donnerstag um 18 Uhr“), bietet der Coach einmal pro Ziel als Wochenrhythmus an: Die Tage stehen acht Wochen voraus im Kalender und kommen von selbst nach (bei jedem Gespräch und einmal am Tag, Zeitplan `i-am-series` aus der Migration). Ein einzelner Tag lässt sich verschieben oder streichen, ohne dass sich der Rhythmus ändert. Unter dem Kreis zeigen Tag und Woche die Termine, dort kannst du auch selbst welche eintragen oder löschen. Wecker in der Uhr-App kann eine Web-App nicht stellen. Stattdessen gibt es Termine mit Erinnerungston.
- **Nachrichten vom Coach** (Push), zu Zeiten, die du wählst: am Morgen, was heute ansteht („Heute: 09:00 Rennen.“); am Abend ein kurzer Blick auf deinen Tag („Heute 45 Minuten für Halbmarathon Zürich.“). Keine Fragen, und keine Nachricht, wenn du schon da warst.
- **Einstellungen**: Name, Benachrichtigungen, Standort, alle Daten herunterladen, Konto löschen.
- **Sprechen statt Tippen** über den Mikrofon-Knopf, sofern der Browser das kann (Chrome, Safari, Edge).
- **Installierbar als App** auf dem Handy (PWA), läuft auch offline weiter. Bei Fehlern gibt es „Nochmal versuchen“.
- **Demo-Modus**: Solange Supabase nicht eingerichtet ist, läuft die App mit einem einfachen, vorgeschriebenen Coach ohne KI. Er versteht auch einfache Termine wie „Samstag um 9 Rennen“. So kannst du alles sofort ausprobieren.

## Einrichten (einmalig, etwa 15 Minuten)

Alles läuft über GitHub: Du trägst einmal ein paar Schlüssel ein, danach bringen zwei Workflows App und Server automatisch online.

### 1. Supabase-Projekt anlegen
1. Auf [supabase.com](https://supabase.com) ein Gratis-Projekt anlegen. Als Region eignet sich z.B. *Central EU (Zurich)*. Das Datenbank-Passwort, das du dabei wählst, brauchst du gleich.
2. **Authentication → Sign In / Providers → Email**: **„Confirm email“ ausschalten.** Weil man sich mit Benutzernamen statt E-Mail anmeldet, kann keine Bestätigungs-Mail ankommen.

### 2. Schlüssel bei GitHub eintragen
Im Repository unter **Settings → Secrets and variables → Actions**:

| Art | Name | Woher |
|---|---|---|
| Variable | `SUPABASE_PROJECT_REF` | Supabase → Project Settings → General → *Project ID* |
| Variable | `VITE_SUPABASE_ANON_KEY` | Supabase → Project Settings → API Keys → *anon/publishable* (darf öffentlich sein) |
| Secret | `SUPABASE_ACCESS_TOKEN` | supabase.com → Account → Access Tokens → *Generate new token* |
| Secret | `SUPABASE_DB_PASSWORD` | das Datenbank-Passwort aus Schritt 1 |
| Secret | `ANTHROPIC_API_KEY` | [platform.claude.com](https://platform.claude.com) → API Keys |
| Secret | `PUSH_CRON_SECRET` | ein beliebiges langes Passwort, z.B. aus einem Passwort-Manager |

**Stimme (ElevenLabs):** Den Schlüssel von elevenlabs.io (Profil → API Keys) bei Supabase unter *Edge Functions → Secrets* als `ELEVENLABS_API_KEY` eintragen. Optional: `ELEVENLABS_VOICE_ID` für eine bestimmte Stimme.

Die Schlüssel für Claude und die Datenbank liegen damit nur bei GitHub und auf dem Server, nie in der App oder auf dem Handy.

### 3. Online bringen
1. **Settings → Pages → Build and deployment → Source: „GitHub Actions“**.
2. Den Code auf `main` bringen (Pull Request mergen). Dann laufen automatisch:
   - **Deploy Supabase**: Datenbank-Schema und Server-Funktionen (Coach, Kalender, Benachrichtigungen, Konto),
   - **Deploy to GitHub Pages**: die App unter `https://<dein-github-name>.github.io/<repository-name>/` (hier `bucket-list`; der Pfad folgt dem Namen des Repositorys),
   - **Coach-Nachrichten**: alle 15 Minuten der Versand der Morgen- und Abendnachricht.

   Beide Deploy-Workflows lassen sich auch unter **Actions → … → Run workflow** von Hand starten.

### 4. Aufs iPhone
1. Die Seite in **Safari** öffnen → **Teilen → „Zum Home-Bildschirm“**, dann „Bucket List“ vom Home-Bildschirm öffnen.
2. **Du → Benachrichtigungen → „Auf diesem Gerät erlauben“** (geht auf dem iPhone nur so, ab iOS 16.4).
3. **Du → Verbindungen → iPhone-Kalender → „Kalender abonnieren“ → Abonnieren**. Dabei **„Hinweise entfernen“ ausschalten**, sonst klingeln die Erinnerungen nicht. Neue Termine kommen schneller, wenn du unter *Einstellungen → Kalender → Accounts → Abrufen* „Alle 15 Minuten“ wählst.

Auf Android: Seite in Chrome öffnen → Menü → **„App installieren“**.

### Die neue Ansicht ist der Standard
Die App öffnet bei Jetzt mit dem Kreis. Darunter liegen Tag, Woche, Jahr und Leben, links ist Du, rechts die Bucket List.
- Zur alten Ansicht: **Du → Einstellungen → Alte Ansicht öffnen**, oder die Adresse mit `?space=0` öffnen. Die App merkt sich die Wahl pro Browser und pro App vom Home-Bildschirm.
- Zurück zur neuen: **Menü → Einstellungen → Neue Ansicht öffnen**, oder `?space=1`.
- Wer früher mit `?space=0` die alte Ansicht gewählt hat, bleibt dort.

### Neue Adresse (`App-ich` → `bucket-list`)
Die App rechnet alle Pfade von ihrer eigenen Adresse aus und läuft unter beiden. Nach dem Umbenennen des Repositorys:
1. Auf dem iPhone die alte App vom Home-Bildschirm löschen, https://mapius55.github.io/bucket-list/ in Safari öffnen, neu hinzufügen und dort einmal anmelden (gleicher Benutzername, gleiches Passwort). Wer die alte Ansicht gewählt hatte: **Menü → Einstellungen → Neue Ansicht öffnen** (siehe oben).
2. Benachrichtigungen dort einmal erlauben (Du → Benachrichtigungen). In einem Browser, in dem du sie schon für dein Konto eingeschaltet hattest, meldet die App das Gerät beim Start still neu an; nie für ein anderes Konto und nie nach „Auf diesem Gerät ausschalten“. Beim Abmelden entfernt die App die Benachrichtigungen dieses Geräts.
3. Das Kalender-Abo und WHOOP laufen weiter: Sie hängen an der Supabase-Adresse, nicht an der App-Adresse. WHOOP schickt dich nach der Anmeldung an die Adresse zurück, von der du gestartet bist.

<details>
<summary>Ohne GitHub-Workflows (von Hand mit der Supabase CLI)</summary>

```bash
supabase login
supabase link --project-ref <projekt-id>
supabase db push
supabase secrets set ANTHROPIC_API_KEY=<schlüssel> PUSH_CRON_SECRET=<passwort>
supabase functions deploy coach --no-verify-jwt
supabase functions deploy account --no-verify-jwt
supabase functions deploy calendar --no-verify-jwt
supabase functions deploy push --no-verify-jwt
```
Dann bei GitHub die Variablen `VITE_SUPABASE_URL` (`https://<projekt-id>.supabase.co`) und `VITE_SUPABASE_ANON_KEY` setzen.
</details>

## Kosten
- GitHub Pages, GitHub Actions (öffentliche oder kleine private Repos), Supabase (Gratis-Stufe) und Open-Meteo kosten nichts.
- Claude wird pro Nutzung abgerechnet. Der Coach nutzt *Claude Opus 5.5*. Grob gerechnet kostet eine Nachricht ein paar Rappen. Der feste Teil der Anweisungen wird zwischengespeichert (Prompt-Caching) und ist dadurch günstiger.

## Lokal entwickeln
```bash
npm install
cp .env.example .env.local   # optional: Supabase-Werte eintragen, sonst Demo-Modus
npm run dev
npm test                     # Tests: Kalender, Zeitzonen, Farben, Push-Verschlüsselung
```

## Aufbau
```
src/
  lib/palette.ts, worlds.ts      Farb-Engine und Farbwelten
  lib/sun.ts, weather.ts         Sonnenstand, Live-Wetter
  components/Portal.tsx          der Kreis (WebGL)
  components/SkyBackground.tsx   der fliessende Himmel (WebGL)
  components/VoiceConversation.tsx   Sprachmodus: Zuhören mit Pausen-Erkennung, Stimme Satz für Satz
  lib/voice.ts                   Aufnahme, Wiedergabe, Fallback auf die Handy-Stimme
  screens/                       Login, Kennenlernen, Startseite, Gedächtnis, Kalender, Einstellungen
  lib/supabaseBackend.ts, demoBackend.ts   echte Daten bzw. Demo
  lib/push.ts, sw.ts             Benachrichtigungen (Service Worker)
supabase/
  migrations/                    Datenbank-Schema mit Row Level Security
  functions/coach/               KI-Coach (Claude): Charakter in prompt.ts, Werkzeuge in index.ts
  functions/calendar/            Kalender „Bucket List“ als Abo (iCalendar)
  functions/push/                Morgen- und Abendnachricht (Web Push, ohne Fremdbibliothek)
  functions/account/             Konto löschen
  functions/voice/               Stimme und Spracherkennung (ElevenLabs)
  functions/_shared/             iCalendar- und Web-Push-Bausteine
tests/                           automatische Tests (vitest)
docs/farben-recherche.md         Farbforschung und Plan für Wada-Kombinationen (pausiert)
```

Charakter und Regeln des Coaches stehen auf Deutsch in `supabase/functions/coach/prompt.ts` und lassen sich dort direkt anpassen.

## Nächste Schritte (geplant)
- Kalender lesen (Google/Apple), damit der Coach auch deine anderen Termine kennt
- Strava oder andere Sport-Apps (Trainings und Rennen)
- Passwort vergessen: braucht später eine echte E-Mail-Adresse, z.B. für die öffentliche Version
