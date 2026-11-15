// iCalendar (RFC 5545) writer for the "Bucket List" calendar. Shared by the
// calendar feed (Supabase function) and the app (demo download).

export interface IcsEvent {
  id: string;
  title: string;
  starts_at: string; // ISO timestamp (UTC)
  ends_at: string | null;
  all_day: boolean;
  location: string | null;
  notes: string | null;
  reminder_minutes: number | null;
  sequence?: number;
  updated_at?: string;
}

const pad = (n: number) => String(n).padStart(2, "0");

function utcStamp(iso: string): string {
  const d = new Date(iso);
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
}

/** Calendar date of an all-day event, in the given time zone. */
function dateIn(iso: string, tz: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
  return parts.replaceAll("-", "");
}

function nextDay(yyyymmdd: string): string {
  const d = new Date(Date.UTC(+yyyymmdd.slice(0, 4), +yyyymmdd.slice(4, 6) - 1, +yyyymmdd.slice(6, 8) + 1));
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`;
}

const escape = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");

/** Fold lines longer than 75 octets (RFC 5545 §3.1). */
function fold(line: string): string {
  const bytes = new TextEncoder().encode(line);
  if (bytes.length <= 75) return line;
  const out: string[] = [];
  let cur = "";
  let len = 0;
  for (const ch of line) {
    const l = new TextEncoder().encode(ch).length;
    if (len + l > (out.length ? 74 : 75)) {
      out.push(cur);
      cur = "";
      len = 0;
    }
    cur += ch;
    len += l;
  }
  out.push(cur);
  return out.join("\r\n ");
}

export function buildIcs(events: IcsEvent[], opts: { name?: string; timezone?: string } = {}): string {
  const tz = opts.timezone ?? "Europe/Zurich";
  const now = utcStamp(new Date().toISOString());
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Bucket List//Coach//DE",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escape(opts.name ?? "Bucket List")}`,
    `X-WR-TIMEZONE:${tz}`,
    "REFRESH-INTERVAL;VALUE=DURATION:PT15M",
    "X-PUBLISHED-TTL:PT15M",
  ];
  for (const e of events) {
    // UID domain "@i-am" stays as it was: changing it would duplicate every event in subscribed calendars.
    lines.push("BEGIN:VEVENT", `UID:${e.id}@i-am`, `DTSTAMP:${e.updated_at ? utcStamp(e.updated_at) : now}`, `SEQUENCE:${e.sequence ?? 0}`);
    if (e.all_day) {
      const d = dateIn(e.starts_at, tz);
      const end = e.ends_at ? nextDay(dateIn(e.ends_at, tz)) : nextDay(d);
      lines.push(`DTSTART;VALUE=DATE:${d}`, `DTEND;VALUE=DATE:${end}`);
    } else {
      const end = e.ends_at ?? new Date(new Date(e.starts_at).getTime() + 60 * 60 * 1000).toISOString();
      lines.push(`DTSTART:${utcStamp(e.starts_at)}`, `DTEND:${utcStamp(end)}`);
    }
    lines.push(`SUMMARY:${escape(e.title)}`);
    if (e.location) lines.push(`LOCATION:${escape(e.location)}`);
    if (e.notes) lines.push(`DESCRIPTION:${escape(e.notes)}`);
    if (e.reminder_minutes != null) {
      // all-day: minutes count from midnight backwards; negative = after midnight (e.g. -480 → 08:00 that day)
      const m = e.reminder_minutes;
      const trigger = m >= 0 ? `-PT${m}M` : `PT${-m}M`;
      lines.push("BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${escape(e.title)}`, `TRIGGER:${trigger}`, "END:VALARM");
    }
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}

/** Local wall-clock time ("2026-03-29T09:00") in a time zone → UTC ISO string. */
export function zonedToUtc(local: string, tz: string): string {
  const m = local.match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?$/);
  if (!m) throw new Error("Datum im Format YYYY-MM-DD oder YYYY-MM-DDTHH:MM");
  const [, y, mo, d, h = "00", mi = "00"] = m;
  const guess = Date.UTC(+y, +mo - 1, +d, +h, +mi);
  const offsetAt = (t: number) => {
    const p = Object.fromEntries(
      new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
        .formatToParts(new Date(t))
        .map((x) => [x.type, x.value]),
    );
    return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute) - t;
  };
  let t = guess - offsetAt(guess);
  t = guess - offsetAt(t); // second pass handles DST edges
  return new Date(t).toISOString();
}
