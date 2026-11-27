# Animationen für Kehrwasser schreiben

Jede Übung bekommt eine stumme, sich wiederholende Animation einer Figur («das kurze Video»). Sie entsteht aus wenigen
**Posen** (Keyframes), zwischen denen die App weich überblendet. Geschrieben wird in TypeScript, eine Datei pro Gruppe:
`dehnen/src/data/anim/<gruppe>.ts`, die `export const anims: AnimSet = { "<übungs-id>": { … } }` enthält.
Vorlage mit fünf fertigen Beispielen: `dehnen/src/data/anim/muster.ts`. Bausteine: `dehnen/src/figure/bases.ts`. Typen: `dehnen/src/figure/pose.ts`.

## Welt

- Meter. `+Y` oben, Boden bei `y = 0`. Eine stehende Figur schaut nach `+Z`. **Ihre linke Seite ist `+X`.**
- Einseitige Übungen werden für die **LINKE** Seite als Zielseite geschrieben (linke Hüfte wird gedehnt usw.). Die rechte Seite spiegelt die App selbst.
- Die Matte liegt längs `Z`. Liegende Figuren: Kopf Richtung `-Z` (Rückenlage, Seitlage) oder `+Z` (Bauchlage, Vierfüssler).

## Eine Pose = Richtungen

Für jeden Körperteil wird gesagt, **wohin er zeigt** (ein Vektor, Länge egal). Die Figur wird danach von selbst auf den Boden (oder auf Kiste/Rolle) gesetzt.

```ts
const pose: Pose = {
  pelvis: { up: [0, 1, 0], fwd: [0, 0, 1] },   // up = entlang der Wirbelsäule Richtung Kopf, fwd = wohin der Bauch schaut
  chest:  { up: [-0.2, 0.98, 0], fwd: [0, 0, 1] }, // Brustkorb genauso (fehlt er: wie Becken = gerader Rücken)
  head:   { up: [0, 1, 0], fwd: [0, 0, 1] },   // up = Scheitel, fwd = Blick (fehlt er: wie Brustkorb)
  legL: { thigh: [0, -1, 0], shank: [0, -1, 0] },        // Oberschenkel Hüfte→Knie, Unterschenkel Knie→Knöchel
  legR: { thigh: [-0.03, 0, 1], shank: [0, -1, 0.02] },
  armL: { upper: [0.14, -1, 0], fore: [0.06, -1, 0.14] }, // Oberarm Schulter→Ellbogen, Unterarm Ellbogen→Handgelenk
  armR: { wrist: { at: "kneeR", offset: [0, 0.09, -0.1] } }, // oder: das Handgelenk greift nach einem Punkt
  anchor: "kneeL",   // dieser Punkt bleibt am Ort [x, z] = at (Standard: "pelvis" bei [0, 0])
};
```

- Becken/Brustkorb/Kopf: Seitneigung, Beugung, Drehung entstehen durch **unterschiedliche** Rahmen von Becken und Brustkorb.
  Beispiele `up`: aufrecht `[0,1,0]`; 20° nach rechts geneigt `[-0.34,0.94,0]`; Rückenlage `[0,0,-1]` mit `fwd [0,1,0]`; Vierfüssler `[0,0.2,1]` mit `fwd [0,-1,0.2]`.
  Drehung nach links um 45°: `fwd: flat(45)`.
- Bein: `foot` (Ferse→Zehen) oder `point` (Grad Spitzfuss: 0 = rechter Winkel, 68–75 = Fussrücken liegt am Boden wie beim Knien, negativ = Zehen angezogen). Ohne Angabe steht der Fuss rechtwinklig zum Schienbein.
- `space: "body"` bei Arm oder Bein: Vektoren relativ zum Brustkorb bzw. Becken `[links, Richtung Kopf, nach vorn]` (praktisch, wenn sich der Rumpf dreht).
- **Greifen** (empfohlen für Hände am Boden, an Körperteilen, an Geräten): `armL: { wrist: ZIEL, bend?: Richtung des Ellbogens, hand?: Richtung der Finger }`,
  `legR: { ankle: ZIEL, bend?: Richtung des Knies }`. ZIEL ist
  `{ floor: [x, z] }` (liegt auf Boden/Kiste auf) · `{ under: "shoulderL", offset?: [dx, dz] }` · `{ at: "kneeL", offset: [x, y, z] }` (Gelenk plus Abstand in Weltrichtung; 7–10 cm Abstand, sonst steckt die Hand im Körper) · `[x, y, z]`.
  Gelenknamen: pelvis waist chest neck head, und mit L/R: hip knee ankle toe heel shoulder elbow wrist hand.
  Ein Ziel, das in beiden Keyframes gleich bleibt, bleibt auch in der Bewegung **fest** (aufgestützte Hand, stehender Fuss).
- `anchor`/`at`: der Körperteil, der sich in der ganzen Animation **nicht bewegt** (Standfuss, Knie am Boden). In allen Keyframes gleich lassen. Koordinaten von `floor`-Zielen und Geräten beziehen sich darauf.
- `y`: Höhe der Beckenmitte von Hand festlegen (nur nötig, wenn beide Beine greifen oder der Körper an etwas hängt). Sonst weglassen.

Helfer aus `bases.ts`: `sag(grad)` Richtung in der Ebene vorn-hinten (0 unten, 90 vorn, 180 oben, -90 hinten) · `lat(grad)` Ebene links-rechts (0 unten, 90 links, -90 rechts) ·
`flat(grad, steigung?)` auf dem Boden (0 vorn, 90 links, 180 hinten) · `turn(v, achse, grad)` · `between(a, b, t)` · `turnFrame(rahmen, achse, grad)` · `withPose(basis, { … })` ·
`UPRIGHT ON_BACK ON_BELLY ALL_FOURS` · `armDownL/R armHipL/R` · `CHAIR` (Kiste zum Sitzen).

**Grundhaltungen** `BASES.*` (kopieren und abwandeln, das hält alle Übungen einheitlich): `stand tallKneel halfKneel lunge quadruped heelSit childPose squat longSit crossSit butterfly straddle sit9090 pigeon downDog plank supine supineHook prone sideLying chairSit`.
Bei `halfKneel`/`lunge` ist das LINKE Knie am Boden (bei [0,0]) und der rechte Fuss vorn fest aufgesetzt; `sit9090`/`pigeon`: linkes Bein vorn; `sideLying`: liegt auf der rechten Seite, linke Seite oben, Bauch Richtung `-X`.
Alle ansehen: `node scripts/dehnen/sheet.ts --bases --overview` → `.sheets/overview.png`.

## Animation

```ts
"hb-halbkniestand": { ...hold(start, ende), camera: { az: 70 }, spots: ["hipFrontL"] },
"rq-katze-kuh":     { ...flow(6, [katze, kuh], 0, 0.4), camera: { az: 65, el: 14 }, spots: ["lowBack"] },
```

- **Statisch** (`kind: "statisch"`): immer `hold(start, ende)` (oder `hold3(start, mitte, ende)`): Start = Ausgangsstellung, Ende = die Dehnung. Der Rhythmus ist damit bei allen gleich.
- **Dynamisch/aktiv**: `flow(tempo, [pose0, pose1, …], main?, pause?)`: eine Runde dauert `tempo` Sekunden (Feld `tempo` der Übung). `main` = Index der Pose für das Standbild. Die Runde schliesst von der letzten Pose zurück zur ersten.
- `camera.az`: Standort der Kamera in Grad um die Figur: 0 = von vorn (ins Gesicht einer Figur, die nach +Z schaut), 90 = von ihrer linken Seite, -90 = von rechts, 180 = von hinten. `el` = Höhe (Standard 12).
  So wählen, dass die Zielseite und die Bewegung gut zu sehen sind (Seitneigung von vorn/hinten, Beugen/Strecken von der Seite, oft etwas schräg: 20–40 oder 60–75).
- `spots`: wo man es spürt, 1–3 Stück: `hipSide hipFront glute groin innerThigh outerThigh quad hamstring kneeBack calf shin ankle foot flank lat chest shoulder shoulderBack triceps biceps forearm wrist neckSide` jeweils mit `L`/`R`, dazu `lowBack midBack upperBack belly neckBack neckFront`.
- `props` (Koordinaten relativ zum Anker): `{ type: "box", at: [x, z], size: [breit, hoch, tief] }` (Stuhl, Bank, Stufe, Block; der Körper liegt/sitzt darauf auf) ·
  `{ type: "wall", axis: "z", at: 0.5, faces: -1 }` (Wand bei z = 0.5, Raum auf der Seite -z; die Figur von Hand passend davor stellen, Hand an die Wand mit `wrist: [x, y, z]`) ·
  `{ type: "stick", a: { at: "handL" }, b: { at: "handR" }, extend: 0.3, paddle: true }` (Paddel/Stab durch zwei Punkte) ·
  `{ type: "roller", at: [x, z], axis: "x" }` · `{ type: "band", a: ZIEL, b: ZIEL }`.

## Prüfen (Pflicht)

```
node scripts/dehnen/sheet.ts <gruppe> <id> [<id> …]      # je Übung ein Bild .sheets/<id>.png (jede Pose aus 4 Richtungen) + Textbericht
node scripts/dehnen/sheet.ts <gruppe> --overview         # alle der Datei in einem Bild: .sheets/overview.png (Hauptpose, Kamera und +90°)
node scripts/dehnen/sheet.ts <gruppe> <id> --film        # dazu ein Streifen mit 8 Bildern der Bewegung
```

Der Textbericht nennt pro Pose, was den Boden **berührt** («touching»), was knapp darüber schwebt, Gelenkwinkel und WARNUNGEN
(Hand erreicht Ziel nicht, Gelenk überdehnt, Körperteile stecken ineinander, Körper schwebt). Bild ansehen (Read auf die PNG-Datei) und vergleichen mit dem Feld `motion` der Übung.

Eine Animation ist gut, wenn:
1. man die Übung auf dem Bild **erkennt** und sie zum Text passt (richtige Seite: LINKS ist Zielseite; richtige Stützpunkte am Boden);
2. nichts schwebt, was aufliegen soll (Füsse, Knie, Hände, Gesäss, Rücken), und nichts im Boden steckt;
3. keine Arme durch den Körper gehen und kein Gelenk unmöglich steht (WARNUNGEN lesen; gekreuzte Beine dürfen sich leicht berühren);
4. Start und Ende sich sichtbar unterscheiden, die Bewegung dazwischen plausibel ist (`--film`), der Anker fest bleibt;
5. die Kamera die Sache zeigt, die `spots` an der richtigen Stelle leuchten.

Regeln für die Dateien: Importe mit Endung (`from "../../figure/bases.ts"`), Typen mit `import type`, keine `enum`. Nur die eigene Datei ändern. Kleine Hilfsfunktionen in der eigenen Datei sind erwünscht (Varianten einer Übung teilen sich die Pose und ändern nur, was anders ist).
