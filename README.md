# I am

Ein persönlicher Coach für deine Zeit. Beim ersten Öffnen lernt er dich im Gespräch kennen: wer du bist, was du machst, was dir wichtig ist und welche Natur du liebst. Danach begrüsst dich jedes Mal ein leuchtender Kreis. Er fragt, wie es dir geht, sagt dir das Wichtigste zuerst (z.B. ein Rennen am Wochenende) und hilft dir, einen Fokus für den Tag zu finden.

## Marke
- **Name:** I am
- **Logo:** „I am“ in Bodoni Moda mit feiner Schwung-Linie, auf dem blauen Pinsel-Hintergrund. Dateien liegen in `brand/` (`wordmark.svg`, `icon.svg`, `banner.png`), die App-Icons in `public/`. Neu erzeugen lassen sie sich mit `scripts/brand/` (siehe Kommentar in `make.cjs`).
- **Schriften:** Bodoni Moda (Titel, Coach-Text) und Jost (Bedienelemente), beide frei (SIL Open Font License).
- **Hintergrund:** Pinselstriche, deren Farben dem Himmel folgen: nachts tiefes Blau, beim Sonnenuntergang warm, am Tag hell.
- **Kreis:** eine Gradient Sphere (WebGL), deren Farben aus Tageszeit, Wetter, Stimmung und Lieblingsnatur entstehen.

## Was schon funktioniert

- **Login mit Benutzername und Passwort.** Danach bleibst du eingeloggt und landest bei jedem Öffnen direkt beim Kreis.
- **Kennenlernen (Onboarding)** als Gespräch mit der KI (Claude), etwa acht bis zehn Fragen.
- **Der lebendige Kreis**: Seine Farben entstehen aus
  - der Tageszeit, berechnet aus dem echten Sonnenstand an deinem Ort (Morgendämmerung, Tag, goldene Stunde, Sonnenuntergang, blaue Stunde, Nacht),
  - der Jahreszeit,
  - dem Live-Wetter (Open-Meteo, gratis): Bei Wolken, Regen oder Nebel wird er gedämpfter, bei Schnee heller,
  - deiner Stimmung von heute: Bei einem schweren Tag werden die Farben sanfter und ruhiger, bei viel Energie bewegt er sich schneller,
  - deiner Lieblingsnatur: Die KI wählt im Kennenlernen fünf Farben daraus (z.B. „Bergsee im Engadin“),
  - einer kleinen täglichen Variation, damit er jeden Tag ein bisschen anders ist.
  Der Hintergrund der ganzen App wechselt mit. Am Tag ist er hell und ruhig, abends gibt es Sonnenuntergangsfarben.
- **Täglicher Check-in**: Der Coach fragt, wie es dir geht, erinnert dich an Anstehendes und hilft, einen Fokus zu setzen. Der Fokus steht dann unter dem Kreis.
- **Gedächtnis**: Der Coach merkt sich vor allem
  - deine **Energie**: wann du viel oder wenig hast, was sie dir gibt oder nimmt, und Muster über die letzten zwei Wochen,
  - **wohin du gehst**: Reisen, Ausflüge, Trainingsorte,
  - **Rennen und Termine** mit Datum. Danach fragt er, wie es lief.

  Smalltalk und zu Persönliches speichert er nicht. Einmal am Tag räumt er still auf und löscht, was unwichtig, zu persönlich, doppelt oder lange vorbei ist. Was du selbst einträgst oder bearbeitest, lässt er stehen. Alles ist unter Menü → „Was ich über dich weiss“ sichtbar und lässt sich ändern oder löschen.
- **Sprechen statt Tippen** über den Mikrofon-Knopf, sofern der Browser das kann (Chrome, Safari, Edge).
- **Installierbar als App** auf dem Handy (PWA).
- **Demo-Modus**: Solange Supabase nicht eingerichtet ist, läuft die App mit einem einfachen, vorgeschriebenen Coach ohne KI. So kannst du Kreis und Ablauf sofort ausprobieren.

## Einrichten (einmalig)

### 1. App auf GitHub Pages veröffentlichen
1. Auf GitHub: **Settings → Pages → Build and deployment → Source: „GitHub Actions“**.
2. Sobald der Code auf `main` ist, baut der Workflow `.github/workflows/deploy.yml` die App automatisch. Sie ist dann erreichbar unter
   `https://<dein-github-name>.github.io/App-ich/`.
   Ohne Schritt 2 bis 4 läuft sie im Demo-Modus.

### 2. Supabase (Login + Daten)
1. Auf [supabase.com](https://supabase.com) ein Gratis-Projekt anlegen. Als Region eignet sich z.B. *Central EU (Zurich)*.
2. **Authentication → Sign In / Providers → Email**: **„Confirm email“ ausschalten.** Weil man sich mit Benutzernamen statt E-Mail anmeldet, kann keine Bestätigungs-Mail ankommen.
3. **SQL Editor**: die Dateien in `supabase/migrations/` **der Reihe nach** einfügen und ausführen (zuerst `…000000_init.sql`, dann `…010000_memory_source_and_places.sql`). Damit entstehen die Tabellen, und jede Person sieht nur ihre eigenen Daten (Row Level Security). Mit der Supabase CLI geht das auch in einem Schritt: `supabase db push`.

### 3. KI-Coach (Claude) auf Supabase
1. Einen API-Schlüssel auf [platform.claude.com](https://platform.claude.com) erstellen.
2. Die [Supabase CLI](https://supabase.com/docs/guides/cli) installieren und im Projektordner ausführen:
   ```bash
   supabase login
   supabase link --project-ref <deine-projekt-id>
   supabase secrets set ANTHROPIC_API_KEY=<dein-schlüssel>
   supabase functions deploy coach
   ```
   Der Schlüssel liegt nur auf dem Server und nie in der App oder auf dem Handy.

### 4. App mit Supabase verbinden
Auf GitHub unter **Settings → Secrets and variables → Actions → Variables** zwei *Variables* anlegen:
- `VITE_SUPABASE_URL`: aus Supabase → Project Settings → API (z.B. `https://abcd.supabase.co`)
- `VITE_SUPABASE_ANON_KEY`: der „anon“- bzw. „publishable“-Key von derselben Seite. Dieser Key darf öffentlich sein.

Danach unter **Actions → Deploy to GitHub Pages → Run workflow** neu bauen.

### 5. Aufs Handy
- **iPhone**: Seite in Safari öffnen → Teilen → **„Zum Home-Bildschirm“**.
- **Android**: Seite in Chrome öffnen → Menü → **„App installieren“**.

## Kosten
- GitHub Pages, Supabase (Gratis-Stufe) und Open-Meteo kosten nichts.
- Claude wird pro Nutzung abgerechnet. Der Coach nutzt *Claude Opus 5.5*. Grob gerechnet kostet eine Nachricht ein paar Rappen. Der feste Teil der Anweisungen wird zwischengespeichert (Prompt-Caching) und ist dadurch günstiger.

## Lokal entwickeln
```bash
npm install
cp .env.example .env.local   # optional: Supabase-Werte eintragen, sonst Demo-Modus
npm run dev
```

## Aufbau
```
src/
  lib/palette.ts        Farb-Engine: Sonnenstand, Jahreszeit, Wetter, Stimmung, Natur → Farben
  lib/sun.ts            Sonnenstand (NOAA-Formel)
  lib/weather.ts        Live-Wetter von Open-Meteo
  components/Orb.tsx    der animierte Kreis (Canvas)
  components/Conversation.tsx   Gespräch mit Streaming + Spracheingabe
  screens/              Login, Kennenlernen, Startseite, „Was ich über dich weiss“
  lib/supabaseBackend.ts / demoBackend.ts   echte Daten bzw. Demo
supabase/
  migrations/           Datenbank-Schema mit Row Level Security
  functions/coach/      KI-Coach (Claude): Charakter in prompt.ts, Werkzeuge in index.ts
```

Charakter und Regeln des Coaches stehen auf Deutsch in `supabase/functions/coach/prompt.ts` und lassen sich dort direkt anpassen.

## Nächste Schritte (geplant)
- Kalender verbinden (Google/Apple)
- Strava oder andere Sport-Apps (Trainings und Rennen)
- Name der App festlegen
- Passwort vergessen: braucht später eine echte E-Mail-Adresse, z.B. für die öffentliche Version
