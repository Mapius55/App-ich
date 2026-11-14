# I am

Ein persönlicher Coach für deine Zeit. Beim ersten Öffnen lernt er dich im Gespräch kennen: wer du bist, was du machst, was dir wichtig ist und welche Natur du liebst. Danach begrüsst dich jedes Mal ein leuchtender Kreis. Er fragt, wie es dir geht, sagt dir das Wichtigste zuerst (z.B. ein Rennen am Wochenende) und hilft dir, einen Fokus für den Tag zu finden.

## Marke
- **Name:** I am
- **Logo:** „I am“ in Bodoni Moda mit feiner Schwung-Linie, auf dem blauen Pinsel-Hintergrund. Dateien liegen in `brand/` (`wordmark.svg`, `icon.svg`, `banner.png`), die App-Icons in `public/`. Neu erzeugen lassen sie sich mit `scripts/brand/` (siehe Kommentar in `make.cjs`).
- **Schriften:** Inter Tight (fette Titel in Grossbuchstaben, Labels, Knöpfe) und Bodoni Moda (Logo, Text des Coaches). Beide sind frei (SIL Open Font License).
- **Farben:** Das Blau gehört nur zum Logo. Die App nimmt ihre Farben aus einer Bibliothek von 100 benannten Farben (`src/lib/colors100.ts`). Sie wählt laufend die passendsten nach Sonnenstand am Ort, Wetter, Jahreszeit, Höhe über Meer, Stimmung und Lieblingsnatur. Nachts sind es dunkle Grün- und Blautöne. Im Menü steht unter „Farben heute“, welche gerade aktiv sind.
- **Hintergrund:** Fast schwarzer Grund, darauf fliessendes Licht in Pinselstreifen, das ständig durch die Tagesfarben wandert (WebGL, in niedriger Auflösung, schont den Akku).
- **Kreis:** Ein flacher Kreis, wie aus Papier ausgeschnitten, durch den man auf einen ziehenden Wolkenhimmel sieht. Drückt man darauf, kommt der Himmel näher. Zieht man den Finger, verschiebt sich der Himmel. Er reagiert auch auf die Stimme und auf jedes Wort des Coaches.
- **Animationen:** Die Wörter des Coaches erscheinen weich, Seiten zoomen ineinander, Elemente gleiten herein.

## Was schon funktioniert

- **Login mit Benutzername und Passwort.** Danach bleibst du eingeloggt und landest bei jedem Öffnen direkt beim Kreis.
- **Kennenlernen (Onboarding)** als Gespräch mit der KI (Claude), etwa acht bis zehn Fragen.
- **Der Kreis und der Himmel**: Die Farben entstehen aus dem Sonnenstand an deinem Ort, der Jahreszeit, dem Live-Wetter (Open-Meteo), der Höhe über Meer, deiner Stimmung und deiner Lieblingsnatur (siehe *Marke*).
- **Täglicher Check-in**: Der Coach fragt, wie es dir geht, sagt dir das Wichtigste zuerst und hilft, einen Fokus zu setzen. Der Fokus steht unter der Begrüssung, darunter die nächsten Termine der Woche.
- **Gedächtnis**: Der Coach merkt sich vor allem
  - deine **Energie**: wann du viel oder wenig hast, was sie dir gibt oder nimmt, und Muster über die letzten zwei Wochen,
  - **wohin du gehst**: Reisen, Ausflüge, Trainingsorte,
  - **Rennen und Termine** mit Datum. Danach fragt er, wie es lief.

  Smalltalk und zu Persönliches speichert er nicht. Einmal am Tag räumt er still auf und löscht, was unwichtig, zu persönlich, doppelt oder lange vorbei ist. Was du selbst einträgst oder bearbeitest, lässt er stehen. Alles ist unter Menü → „Was ich über dich weiss“ sichtbar und lässt sich ändern oder löschen.
- **Kalender „I am“**: Erzählst du dem Coach von einem Termin (z.B. „Samstag um 9 habe ich ein Rennen“), trägt er ihn direkt ein, mit Erinnerung 30 Minuten vorher. Ganztägige Termine erinnern um 8 Uhr. Dein iPhone abonniert den Kalender einmal, danach erscheint alles von selbst. Menü → Kalender zeigt die Termine, dort kannst du auch selbst welche eintragen oder löschen. Wecker in der Uhr-App kann eine Web-App nicht stellen. Stattdessen gibt es Termine mit Erinnerungston.
- **Nachrichten vom Coach** (Push): eine Morgenfrage („Wie geht es dir heute? Heute steht an: 09:00 Rennen.“) und ein Abendrückblick („Wie lief es mit … ?“) zu Zeiten, die du wählst.
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

Die Schlüssel für Claude und die Datenbank liegen damit nur bei GitHub und auf dem Server, nie in der App oder auf dem Handy.

### 3. Online bringen
1. **Settings → Pages → Build and deployment → Source: „GitHub Actions“**.
2. Den Code auf `main` bringen (Pull Request mergen). Dann laufen automatisch:
   - **Deploy Supabase**: Datenbank-Schema und Server-Funktionen (Coach, Kalender, Benachrichtigungen, Konto),
   - **Deploy to GitHub Pages**: die App unter `https://<dein-github-name>.github.io/App-ich/`,
   - **Coach-Nachrichten**: alle 15 Minuten der Versand von Morgenfrage und Abendrückblick.

   Beide Deploy-Workflows lassen sich auch unter **Actions → … → Run workflow** von Hand starten.

### 4. Aufs iPhone
1. Die Seite in **Safari** öffnen → **Teilen → „Zum Home-Bildschirm“**, dann „I am“ vom Home-Bildschirm öffnen.
2. **Menü → Einstellungen → Benachrichtigungen → „Auf diesem Gerät erlauben“** (geht auf dem iPhone nur so, ab iOS 16.4).
3. **Menü → Kalender → „Kalender abonnieren“ → Abonnieren**. Dabei **„Hinweise entfernen“ ausschalten**, sonst klingeln die Erinnerungen nicht. Neue Termine kommen schneller, wenn du unter *Einstellungen → Kalender → Accounts → Abrufen* „Alle 15 Minuten“ wählst.

Auf Android: Seite in Chrome öffnen → Menü → **„App installieren“**.

<details>
<summary>Ohne GitHub-Workflows (von Hand mit der Supabase CLI)</summary>

```bash
supabase login
supabase link --project-ref <projekt-id>
supabase db push
supabase secrets set ANTHROPIC_API_KEY=<schlüssel> PUSH_CRON_SECRET=<passwort>
supabase functions deploy coach
supabase functions deploy account
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
  lib/palette.ts, colors100.ts   Farb-Engine und 100er-Farbbibliothek
  lib/sun.ts, weather.ts         Sonnenstand, Live-Wetter
  components/Portal.tsx          der Kreis (WebGL)
  components/SkyBackground.tsx   der fliessende Himmel (WebGL)
  components/Conversation.tsx    Gespräch: Streaming, Spracheingabe, Kalender-Karten
  screens/                       Login, Kennenlernen, Startseite, Gedächtnis, Kalender, Einstellungen
  lib/supabaseBackend.ts, demoBackend.ts   echte Daten bzw. Demo
  lib/push.ts, sw.ts             Benachrichtigungen (Service Worker)
supabase/
  migrations/                    Datenbank-Schema mit Row Level Security
  functions/coach/               KI-Coach (Claude): Charakter in prompt.ts, Werkzeuge in index.ts
  functions/calendar/            Kalender „I am“ als Abo (iCalendar)
  functions/push/                Morgenfrage und Abendrückblick (Web Push, ohne Fremdbibliothek)
  functions/account/             Konto löschen
  functions/_shared/             iCalendar- und Web-Push-Bausteine
tests/                           automatische Tests (vitest)
docs/farben-recherche.md         Farbforschung und Plan für Wada-Kombinationen (pausiert)
```

Charakter und Regeln des Coaches stehen auf Deutsch in `supabase/functions/coach/prompt.ts` und lassen sich dort direkt anpassen.

## Nächste Schritte (geplant)
- Farben aus Sanzo Wadas „Dictionary of Color Combinations“ (siehe `docs/farben-recherche.md`)
- Kalender lesen (Google/Apple), damit der Coach auch deine anderen Termine kennt
- Strava oder andere Sport-Apps (Trainings und Rennen)
- Passwort vergessen: braucht später eine echte E-Mail-Adresse, z.B. für die öffentliche Version
