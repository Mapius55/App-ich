// Checks the exercise texts in dehnen/src/data/text/*.json against the contract in dehnen/src/types.ts.
// Usage: node scripts/dehnen/check-text.mjs [file.json ...]   (no arguments = all files)
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const dir = resolve(here, "../../dehnen/src/data/text");

const REGIONS = ["huefte_seitlich", "hueftbeuger", "adduktoren", "gesaess_rotatoren", "hamstrings", "quadrizeps", "waden_sprunggelenk", "lws_ql", "bws_rotation", "schulter_lat", "brust", "nacken", "unterarm_handgelenk"];
const KINDS = ["statisch", "dynamisch", "aktiv"];
const POSITIONS = ["stehend", "kniend", "sitzend", "rueckenlage", "bauchlage", "seitlage", "vierfuessler", "hocke"];
const EQUIPMENT = ["wand", "stuhl", "paddel", "rolle", "band", "block"];
const TAGS = ["aufwaermen", "cooldown", "abend", "morgen", "k1", "c1"];
const KEYS = ["id", "name", "alias", "family", "variant", "kind", "position", "regions", "equipment", "unilateral", "level", "seconds", "tempo", "tags", "intro", "steps", "cues", "avoid", "feel", "slalom", "caution", "motion"];

const args = process.argv.slice(2);
const files = (args.length ? args.map((a) => resolve(a)) : readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => join(dir, f))).sort();
const all = readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => join(dir, f));

const problems = [];
const seen = new Map();
const names = new Map();
const ids = new Set();
const loaded = new Map();
for (const f of new Set([...all, ...files])) {
  try {
    const list = JSON.parse(readFileSync(f, "utf8"));
    loaded.set(f, list);
    if (Array.isArray(list)) for (const e of list) if (e && typeof e.id === "string") ids.add(e.id);
  } catch (err) {
    if (files.includes(f)) problems.push(`${f}: kein gültiges JSON (${err.message})`);
  }
}

const str = (v) => typeof v === "string" && v.trim().length > 0;
let count = 0;
for (const f of files) {
  const list = loaded.get(f);
  if (!list) continue;
  const name = f.split("/").pop();
  if (!Array.isArray(list)) {
    problems.push(`${name}: muss ein Array sein`);
    continue;
  }
  for (const e of list) {
    count++;
    const at = `${name} › ${e?.id ?? "?"}`;
    const bad = (m) => problems.push(`${at}: ${m}`);
    if (!e || typeof e !== "object") { bad("kein Objekt"); continue; }
    for (const k of Object.keys(e)) if (!KEYS.includes(k)) bad(`unbekanntes Feld "${k}"`);
    if (!str(e.id) || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(e.id)) bad("id muss kebab-case sein (a-z, 0-9, -)");
    if (seen.has(e.id)) bad(`id doppelt (auch in ${seen.get(e.id)})`);
    seen.set(e.id, name);
    if (!str(e.name)) bad("name fehlt");
    else {
      if (e.name.length > 36) bad(`name zu lang (${e.name.length} > 36)`);
      const key = e.name.toLowerCase();
      if (names.has(key)) bad(`name doppelt (auch ${names.get(key)})`);
      names.set(key, e.id);
    }
    if (e.alias !== undefined && !str(e.alias)) bad("alias leer");
    if (!str(e.family)) bad("family fehlt");
    else if (!ids.has(e.family)) bad(`family "${e.family}" ist keine bekannte id`);
    if (e.variant !== null && !str(e.variant)) bad("variant muss null oder Text sein");
    if (e.family === e.id && e.variant !== null) bad("Basis einer Familie braucht variant: null");
    if (e.family !== e.id && e.variant === null) bad("Variante braucht ein variant-Label");
    if (!KINDS.includes(e.kind)) bad(`kind ungültig: ${e.kind}`);
    if (!POSITIONS.includes(e.position)) bad(`position ungültig: ${e.position}`);
    if (!Array.isArray(e.regions) || e.regions.length < 1 || e.regions.length > 4 || e.regions.some((r) => !REGIONS.includes(r))) bad(`regions ungültig: ${JSON.stringify(e.regions)}`);
    if (!Array.isArray(e.equipment) || e.equipment.some((r) => !EQUIPMENT.includes(r))) bad(`equipment ungültig: ${JSON.stringify(e.equipment)}`);
    if (typeof e.unilateral !== "boolean") bad("unilateral muss true/false sein");
    if (![1, 2, 3].includes(e.level)) bad("level muss 1, 2 oder 3 sein");
    if (!Number.isFinite(e.seconds) || e.seconds < 15 || e.seconds > 180) bad("seconds muss 15 bis 180 sein");
    if (e.tempo !== undefined && (!Number.isFinite(e.tempo) || e.tempo < 1.5 || e.tempo > 30)) bad("tempo muss 1.5 bis 30 sein");
    if (e.kind !== "statisch" && e.tempo === undefined) bad("dynamisch/aktiv braucht tempo");
    if (!Array.isArray(e.tags) || e.tags.some((r) => !TAGS.includes(r))) bad(`tags ungültig: ${JSON.stringify(e.tags)}`);
    for (const k of ["intro", "avoid", "feel", "slalom", "motion"]) if (!str(e[k])) bad(`${k} fehlt`);
    if (e.caution !== undefined && !str(e.caution)) bad("caution leer");
    if (!Array.isArray(e.steps) || e.steps.length < 2 || e.steps.length > 4 || e.steps.some((s) => !str(s))) bad("steps: 2 bis 4 Texte");
    if (!Array.isArray(e.cues) || e.cues.length < 1 || e.cues.length > 3 || e.cues.some((s) => !str(s))) bad("cues: 1 bis 3 Texte");
    else for (const c of e.cues) if (c.length > 60) bad(`cue zu lang (${c.length} > 60): ${c}`);
    const text = JSON.stringify(e);
    if (text.includes("ß")) bad("enthält ß (Schweizer Schreibweise: ss)");
    if (/[–—]/.test(text)) bad("enthält Gedankenstrich (– oder —), bitte Komma, Punkt oder Doppelpunkt");
  }
}

if (problems.length) {
  console.log(problems.join("\n"));
  console.log(`\n${problems.length} Problem(e) in ${count} Übungen.`);
  process.exit(1);
}
console.log(`OK: ${count} Übungen in ${files.length} Datei(en).`);
