// Round 2, from the live check: deleting an account with a weekly rhythm, and the coach's fine-tuning (the question
// about past blocks in the one-minute morning, offers that stay offered, the Wochenblick declined, only a clear yes,
// one answer per block, one reply said once).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MODE_CHECKIN, PERSONA } from "../supabase/functions/coach/prompt.ts";
import { BLOCK_ALREADY_LOGGED, draftStream, repeatGuard, sameBlockAnswer } from "../supabase/functions/coach/rules.ts";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

describe("deleting an account while her rhythm still has coming days", () => {
  const fix = read("../supabase/migrations/20261125000000_series_delete_fix.sql");

  it("the new migration: only her own delete (role authenticated) of a coming day is a skip marker", () => {
    expect(fix).toContain("create or replace function public.events_series_skip() returns trigger language plpgsql set search_path = '' as $$");
    expect(fix).toContain("if pg_trigger_depth() = 1 and current_user = 'authenticated' and old.series_day is not null and old.starts_at > now() then");
    expect(fix).toContain("update public.series set skip_days = array_append(skip_days, old.series_day)");
    // runs as the caller, nothing else replaced, written to run again
    expect(fix).not.toMatch(/security definer/i);
    expect(fix).not.toMatch(/drop trigger|create trigger|alter table/i);
    expect(fix).not.toContain("ß");
  });

  it("the migrations already applied live stay as they are", () => {
    const series = read("../supabase/migrations/20261124000000_series.sql");
    expect(series).toContain("if pg_trigger_depth() = 1 and old.series_day is not null and old.starts_at > now() then");
    expect(series).not.toContain("current_user");
  });

  it("the account function deletes her rhythms (service role) after WHOOP and before deleteUser", () => {
    const server = read("../supabase/functions/account/index.ts");
    expect(server).toContain('const { error } = await admin.from("series").delete().eq("user_id", userId);');
    // a missing table (migration not applied) is no error; another failure is logged and deleteUser still runs
    expect(server).toContain('if (error && error.code !== "42P01" && error.code !== "PGRST205") console.error(');
    const whoop = server.indexOf("await disconnectWhoopForAccount(userId);");
    const series = server.indexOf("await deleteSeries(admin, userId);");
    const user = server.indexOf("await admin.auth.admin.deleteUser(userId);");
    expect(whoop).toBeGreaterThan(0);
    expect(series).toBeGreaterThan(whoop);
    expect(user).toBeGreaterThan(series);
  });
});

describe("the coach's rules from the live check", () => {
  it("past blocks without an answer: once, in the first reply after the greeting, before a proposal for today", () => {
    expect(MODE_CHECKIN).toContain(
      "- Stehen unter „Vergangene Blöcke ohne Rückmeldung“ Einträge, fragst du einmal kurz danach, in deiner ersten Antwort nach der Begrüssung und vor einem Vorschlag für heute, bei mehreren in einer einzigen Frage, z.B. „Hat das Schreiben gestern geklappt?“, danach nie wieder.",
    );
    // the one-minute morning has the slot: that question, the proposal in the next reply
    expect(MODE_CHECKIN).toContain(
      "du fragst nicht eigens nach dem Wichtigsten. Stehen vergangene Blöcke ohne Rückmeldung da, fragst du in dieser Antwort nach ihnen und schlägst erst in der nächsten etwas vor. Dann schlägst du für heute höchstens einen Block vor",
    );
    expect(MODE_CHECKIN).not.toContain("höchstens einmal im Gespräch kurz und beiläufig");
  });

  it("the Plan B reminder only after a «Nein» to one of that goal's past blocks, not to a proposal she declined", () => {
    expect(MODE_CHECKIN).toContain("erinnerst du leise daran, wenn sie zu einem seiner vergangenen Blöcke Nein sagt (nicht, wenn sie einen Vorschlag ablehnt)");
  });

  it("the block pattern offered once: no other offer this week, also when you talk about the week", () => {
    expect(MODE_CHECKIN).toContain(
      "geändert wird erst nach ihrem Ja. Steht dort „schon angeboten“, schlägst du diese Woche keine Anpassung nach dem Muster mehr vor, auch nicht, wenn ihr über die Woche sprecht.",
    );
  });

  it("the Wochenblick ignored or declined: recorded as abgelehnt", () => {
    expect(MODE_CHECKIN).toContain("Sagt sie Nein oder geht sie nicht darauf ein, ist das in Ordnung: Du rufst gleich wochenblick mit abgelehnt auf");
    expect(read("../supabase/functions/coach/index.ts")).toContain("abgelehnt (sie wollte diese Woche nicht oder ging nicht darauf ein)");
  });

  it("only a clear yes creates or logs; weekly_hours and a rhythm's name change only when she asks", () => {
    expect(PERSONA).toContain("„okay, danke“, „Gut, danke“ oder „Gut. Sonst noch etwas?“ ist kein Ja, weder für einen Block noch für Zeit mit log_time");
    expect(PERSONA).toContain("Nennt sie eine andere Zahl, übernimmst du ihre; sonst änderst du weekly_hours nur, wenn sie darum bittet.");
    expect(PERSONA).toContain("pausieren und beenden geht mit update_series, umbenennen nur, wenn sie darum bittet.");
  });

  it("the rules stay in Swiss High German", () => {
    for (const t of [MODE_CHECKIN, BLOCK_ALREADY_LOGGED]) expect(t).not.toContain("ß");
  });
});

describe("log_time for a block that already has this answer", () => {
  const stored = { goal_id: "G1", minutes: 0, day: "2026-11-16", note: null };

  it("the same goal, minutes and day (and no other note) is the same answer", () => {
    expect(sameBlockAnswer(stored, { goalId: "g1", minutes: 0, day: "2026-11-16" })).toBe(true);
    expect(sameBlockAnswer({ ...stored, minutes: "45" }, { goalId: "g1", minutes: 45, day: "2026-11-16" })).toBe(true);
    expect(sameBlockAnswer({ ...stored, note: "Regen" }, { goalId: "g1", minutes: 0, day: "2026-11-16", note: "Regen" })).toBe(true);
  });

  it("another answer, day, goal or note is saved as before; without a stored answer too", () => {
    expect(sameBlockAnswer(stored, { goalId: "g1", minutes: 30, day: "2026-11-16" })).toBe(false);
    expect(sameBlockAnswer(stored, { goalId: "g1", minutes: 0, day: "2026-11-15" })).toBe(false);
    expect(sameBlockAnswer(stored, { goalId: "g2", minutes: 0, day: "2026-11-16" })).toBe(false);
    expect(sameBlockAnswer(stored, { goalId: "g1", minutes: 0, day: "2026-11-16", note: "Regen" })).toBe(false);
    expect(sameBlockAnswer(null, { goalId: "g1", minutes: 0, day: "2026-11-16" })).toBe(false);
    expect(sameBlockAnswer({ ...stored, minutes: null }, { goalId: "g1", minutes: 0, day: "2026-11-16" })).toBe(false);
  });

  it("the tool returns ok with «Schon eingetragen» before saving, so no second time_logged and no second «Nein» protocol", () => {
    const source = read("../supabase/functions/coach/index.ts");
    const tool = source.slice(source.indexOf('case "log_time": {'), source.indexOf('case "wochenblick"'));
    const check = tool.indexOf("if (sameBlockAnswer(stored.data, { goalId, minutes, day: logDay, note })) return JSON.stringify({ ok: true, hint: BLOCK_ALREADY_LOGGED });");
    expect(tool).toContain('const stored = await sb.from("goal_time").select("goal_id, day, minutes, note").eq("event_id", eventId).maybeSingle();');
    expect(check).toBeGreaterThan(0);
    expect(check).toBeLessThan(tool.indexOf("let res = await update();"));
    expect(check).toBeLessThan(tool.indexOf('send({ type: "time_logged"'));
    expect(BLOCK_ALREADY_LOGGED).toMatch(/^Schon eingetragen/);
  });
});

/** The converse loop of index.ts with its stream guards: each round's text in small deltas, then flushed. */
function converse(rounds: string[], whole = false): { sent: string; saved: string } {
  let fullText = "";
  let sent = "";
  let lastRoundText = "";
  for (const text of rounds) {
    const draft = draftStream({ whole });
    const repeat = repeatGuard(lastRoundText);
    let roundText = "";
    const out = (t: string) => {
      if (!t) return;
      if (!roundText && fullText) {
        fullText += "\n\n";
        sent += "\n\n";
      }
      roundText += t;
      fullText += t;
      sent += t;
    };
    const emit = (t: string) => out(repeat.push(t));
    for (let i = 0; i < text.length; i += 7) emit(draft.push(text.slice(i, i + 7)));
    emit(draft.flush());
    out(repeat.flush());
    if (roundText) lastRoundText = roundText;
  }
  return { sent, saved: fullText.trim() };
}

describe("one reply, said once around a tool round", () => {
  const mira = "Klar, Mira, du musst dich jetzt nicht festlegen. Wenn du magst, sag es mir einfach, dann trage ich den Morgen ein. Hab einen guten Tag im Büro.";

  it("the same text again after a tool round is neither streamed nor saved twice", () => {
    expect(converse([mira, mira])).toEqual({ sent: mira, saved: mira });
    expect(converse([mira, mira], true)).toEqual({ sent: mira, saved: mira });
  });

  it("the live case: the same reply with another first word («Gern» for «Klar»)", () => {
    expect(converse([mira, mira.replace("Klar", "Gern")]).saved).toBe(mira);
  });

  it("a repeat that goes on: only what is new follows", () => {
    expect(converse(["Gut, ich trage es ein.", "Gut, ich trage es ein. Viel Spass beim Laufen!"]).saved).toBe("Gut, ich trage es ein.\n\nViel Spass beim Laufen!");
  });

  it("another reply goes out as it is, from its first sentence on", () => {
    const g = repeatGuard("Gut, ich trage es ein.");
    expect(g.push("Gut. ")).toBe("");
    expect(g.push("Morgen um 7 also? ")).toBe("Gut. Morgen um 7 also? ");
    expect(g.push("Schön.")).toBe("Schön.");
    expect(g.flush()).toBe("");
    expect(converse(["Ich schaue kurz nach.", "Am Dienstag ist der Abend frei."]).saved).toBe("Ich schaue kurz nach.\n\nAm Dienstag ist der Abend frei.");
  });

  it("a short reply is never taken for another one with a different first word; the first round always passes", () => {
    expect(converse(["Klar.", "Gern."]).saved).toBe("Klar.\n\nGern.");
    expect(converse(["Okay, gemacht.", "Super, gemacht."]).saved).toBe("Okay, gemacht.\n\nSuper, gemacht.");
    expect(converse(["Klar.", "Gern, ich trage es ein."]).saved).toBe("Klar.\n\nGern, ich trage es ein.");
    const first = repeatGuard("");
    expect(first.push("Guten Morgen, Mira. ")).toBe("Guten Morgen, Mira. ");
  });

  it("index.ts streams and saves through the guard, against the last round that said something", () => {
    const source = read("../supabase/functions/coach/index.ts");
    expect(source).toContain("const repeat = repeatGuard(lastRoundText);");
    expect(source).toContain("const emit = (text: string) => out(repeat.push(text));");
    expect(source).toContain("    emit(draft.flush());\n    out(repeat.flush());\n    if (roundText) lastRoundText = roundText;");
  });
});
