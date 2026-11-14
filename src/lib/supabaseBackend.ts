import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type {
  Backend,
  CalendarEvent,
  ChatMessage,
  CoachContext,
  CoachEvent,
  CoachRequest,
  DayState,
  EventInput,
  Goal,
  GoalInput,
  Habit,
  HabitInput,
  Memory,
  Milestone,
  Profile,
  PushSubscriptionRow,
} from "./types";
import { normaliseUsername, USERNAME_RE } from "./types";
import { addDays, dayOf, weekStart } from "./plan";

// Supabase Auth works with e-mail addresses. People here log in with a plain
// username, so each username maps to an internal address on a reserved,
// non-routable domain (RFC 2606). No mail is ever sent there.
const USERNAME_DOMAIN = import.meta.env.VITE_USERNAME_EMAIL_DOMAIN || "nutzer.app-ich.example";

const toEmail = (username: string) => `${normaliseUsername(username)}@${USERNAME_DOMAIN}`;

// A goal row as PostgREST returns it with its embedded milestones.
type GoalRow = Omit<Goal, "milestones"> & { milestones: Milestone[] | null };
const toGoal = (row: GoalRow): Goal => ({ ...row, milestones: [...(row.milestones ?? [])].sort((a, b) => a.position - b.position) });

// A habit row with its embedded logs (only the days).
type HabitRow = Omit<Habit, "done_days"> & { habit_logs: { day: string }[] | null };
const toHabit = ({ habit_logs, ...row }: HabitRow): Habit => ({ ...row, done_days: (habit_logs ?? []).map((l) => l.day).sort() });

/** First day of the habit history the app shows: the current week and the 15 before it. */
const habitsSince = () => addDays(weekStart(dayOf()), -15 * 7);

function friendlyAuthError(message: string): string {
  const m = message.toLowerCase();
  if (m.includes("invalid login")) return "Benutzername oder Passwort stimmt nicht.";
  if (m.includes("already registered") || m.includes("already exists")) return "Diesen Benutzernamen gibt es schon.";
  if (m.includes("password") && m.includes("characters")) return "Das Passwort braucht mindestens 8 Zeichen.";
  if (m.includes("rate limit")) return "Zu viele Versuche. Bitte warte kurz.";
  if (m.includes("email not confirmed"))
    return "In Supabase ist die E-Mail-Bestätigung noch eingeschaltet (siehe Anleitung im README).";
  return message;
}

export class SupabaseBackend implements Backend {
  readonly kind = "supabase" as const;
  private sb: SupabaseClient;
  private url: string;
  private anonKey: string;

  constructor(url: string, anonKey: string) {
    this.url = url;
    this.anonKey = anonKey;
    // persistSession keeps people logged in, so the app opens straight to the orb.
    this.sb = createClient(url, anonKey, {
      auth: { persistSession: true, autoRefreshToken: true, storageKey: "ich.auth" },
    });
  }

  async currentUserId() {
    const { data } = await this.sb.auth.getSession();
    return data.session?.user.id ?? null;
  }

  onAuthChange(cb: (userId: string | null) => void) {
    const { data } = this.sb.auth.onAuthStateChange((_e, session) => cb(session?.user.id ?? null));
    return () => data.subscription.unsubscribe();
  }

  async signUp(username: string, password: string) {
    const u = normaliseUsername(username);
    if (!USERNAME_RE.test(u)) throw new Error("Benutzername: 3–30 Zeichen, nur a–z, 0–9, Punkt, Strich, Unterstrich.");
    if (password.length < 8) throw new Error("Das Passwort braucht mindestens 8 Zeichen.");
    const { data, error } = await this.sb.auth.signUp({
      email: toEmail(u),
      password,
      options: { data: { username: u } },
    });
    if (error) throw new Error(friendlyAuthError(error.message));
    if (!data.session) {
      // Sign-up worked but no session: e-mail confirmation is still on in Supabase.
      throw new Error(friendlyAuthError("email not confirmed"));
    }
  }

  async signIn(username: string, password: string) {
    const { error } = await this.sb.auth.signInWithPassword({ email: toEmail(username), password });
    if (error) throw new Error(friendlyAuthError(error.message));
  }

  async signOut() {
    await this.sb.auth.signOut();
  }

  private async uid(): Promise<string> {
    const id = await this.currentUserId();
    if (!id) throw new Error("Nicht eingeloggt.");
    return id;
  }

  async getProfile(): Promise<Profile> {
    const id = await this.uid();
    const { data, error } = await this.sb.from("profiles").select("*").eq("id", id).single();
    if (error) throw error;
    return data as Profile;
  }

  async updateProfile(patch: Partial<Omit<Profile, "id" | "username">>) {
    const id = await this.uid();
    const { error } = await this.sb.from("profiles").update(patch).eq("id", id);
    if (error) throw error;
  }

  async listMemories(): Promise<Memory[]> {
    const { data, error } = await this.sb.from("memories").select("*").order("created_at", { ascending: true });
    if (error) throw error;
    return data as Memory[];
  }

  async addMemory(m: Pick<Memory, "content" | "category" | "event_date">): Promise<Memory> {
    const { data, error } = await this.sb.from("memories").insert(m).select().single();
    if (error) throw error;
    return data as Memory;
  }

  async updateMemory(id: string, patch: Partial<Pick<Memory, "content" | "category" | "event_date" | "source">>) {
    const { error } = await this.sb.from("memories").update(patch).eq("id", id);
    if (error) throw error;
  }

  async deleteMemory(id: string) {
    const { error } = await this.sb.from("memories").delete().eq("id", id);
    if (error) throw error;
  }

  async listEvents(from?: string, to?: string): Promise<CalendarEvent[]> {
    const since = from ?? new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    let q = this.sb.from("events").select("*").gte("starts_at", since);
    if (to) q = q.lt("starts_at", to);
    const { data, error } = await q.order("starts_at").limit(1000);
    if (error) throw error;
    return data as CalendarEvent[];
  }

  async addEvent(e: EventInput): Promise<CalendarEvent> {
    const row = { ...e, kind: e.kind ?? "termin", goal_id: e.goal_id ?? null, source: "person" };
    const { data, error } = await this.sb.from("events").insert(row).select().single();
    if (error) throw error;
    return data as CalendarEvent;
  }

  async updateEvent(id: string, patch: Partial<EventInput>): Promise<CalendarEvent> {
    // The events_bump trigger raises sequence and updated_at, so subscribed calendars pick it up.
    const { data, error } = await this.sb.from("events").update(patch).eq("id", id).select().single();
    if (error) throw error;
    return data as CalendarEvent;
  }

  async deleteEvent(id: string) {
    const { error } = await this.sb.from("events").delete().eq("id", id);
    if (error) throw error;
  }

  async listGoals(all = false): Promise<Goal[]> {
    let q = this.sb.from("goals").select("*, milestones(*)");
    if (!all) q = q.in("status", ["active", "paused"]);
    const { data, error } = await q.order("target_date", { ascending: true, nullsFirst: false }).order("created_at", { ascending: true });
    if (error) throw error;
    return (data as GoalRow[]).map(toGoal);
  }

  async addGoal(g: GoalInput, milestones: Pick<Milestone, "title" | "due_date">[] = []): Promise<Goal> {
    const { data, error } = await this.sb.from("goals").insert({ ...g, source: "person" }).select().single();
    if (error) throw error;
    const goal = data as Omit<Goal, "milestones">;
    if (!milestones.length) return { ...goal, milestones: [] };
    const rows = milestones.map((m, i) => ({ goal_id: goal.id, title: m.title, due_date: m.due_date, position: i }));
    const res = await this.sb.from("milestones").insert(rows).select();
    if (res.error) {
      // No transactions over PostgREST: undo the goal so it isn't left half-saved.
      await this.sb.from("goals").delete().eq("id", goal.id);
      throw res.error;
    }
    return toGoal({ ...goal, milestones: res.data as Milestone[] });
  }

  async updateGoal(id: string, patch: Partial<GoalInput>): Promise<Goal> {
    const { data, error } = await this.sb.from("goals").update(patch).eq("id", id).select("*, milestones(*)").single();
    if (error) throw error;
    return toGoal(data as GoalRow);
  }

  async deleteGoal(id: string) {
    // milestones go with it (cascade); habits and calendar entries keep existing without the link
    const { error } = await this.sb.from("goals").delete().eq("id", id);
    if (error) throw error;
  }

  async addMilestone(goalId: string, m: Pick<Milestone, "title" | "due_date">): Promise<Milestone> {
    const last = await this.sb.from("milestones").select("position").eq("goal_id", goalId).order("position", { ascending: false }).limit(1).maybeSingle();
    if (last.error) throw last.error;
    const position = last.data ? (last.data.position as number) + 1 : 0;
    const { data, error } = await this.sb.from("milestones").insert({ goal_id: goalId, title: m.title, due_date: m.due_date, position }).select().single();
    if (error) throw error;
    return data as Milestone;
  }

  async updateMilestone(id: string, patch: Partial<Pick<Milestone, "title" | "due_date" | "position">> & { done?: boolean }): Promise<Milestone> {
    const { done, ...rest } = patch;
    const row = done === undefined ? rest : { ...rest, done_at: done ? new Date().toISOString() : null };
    const { data, error } = await this.sb.from("milestones").update(row).eq("id", id).select().single();
    if (error) throw error;
    return data as Milestone;
  }

  async deleteMilestone(id: string) {
    const { error } = await this.sb.from("milestones").delete().eq("id", id);
    if (error) throw error;
  }

  async listHabits(): Promise<Habit[]> {
    // The filter on habit_logs.day limits the embedded logs, not the habits.
    const { data, error } = await this.sb
      .from("habits")
      .select("*, habit_logs(day)")
      .eq("active", true)
      .gte("habit_logs.day", habitsSince())
      .order("created_at", { ascending: true });
    if (error) throw error;
    return (data as HabitRow[]).map(toHabit);
  }

  async addHabit(h: HabitInput): Promise<Habit> {
    const { data, error } = await this.sb.from("habits").insert({ ...h, source: "person" }).select().single();
    if (error) throw error;
    return { ...(data as Omit<Habit, "done_days">), done_days: [] };
  }

  async updateHabit(id: string, patch: Partial<HabitInput>): Promise<Habit> {
    const { data, error } = await this.sb.from("habits").update(patch).eq("id", id).select().single();
    if (error) throw error;
    // read the logs on their own: filters on embedded rows are only sure to work on plain reads
    const logs = await this.sb.from("habit_logs").select("day").eq("habit_id", id).gte("day", habitsSince());
    if (logs.error) throw logs.error;
    return toHabit({ ...(data as Omit<Habit, "done_days">), habit_logs: logs.data as { day: string }[] });
  }

  async deleteHabit(id: string) {
    const { error } = await this.sb.from("habits").delete().eq("id", id);
    if (error) throw error;
  }

  async setHabitDone(habitId: string, day: string, done: boolean) {
    const { error } = done
      ? // ticking twice (two devices, a double tap) must not fail
        await this.sb.from("habit_logs").upsert({ habit_id: habitId, day }, { onConflict: "habit_id,day", ignoreDuplicates: true })
      : await this.sb.from("habit_logs").delete().eq("habit_id", habitId).eq("day", day);
    if (error) throw error;
  }

  async calendarLink(): Promise<string | null> {
    const id = await this.uid();
    const { data, error } = await this.sb.from("profiles").select("calendar_token").eq("id", id).single();
    if (error) throw error;
    const tz = encodeURIComponent(Intl.DateTimeFormat().resolvedOptions().timeZone);
    return `${this.url.replace(/^https?:/, "webcal:")}/functions/v1/calendar?token=${data.calendar_token}&tz=${tz}`;
  }

  async renewCalendarLink() {
    const id = await this.uid();
    const { error } = await this.sb.from("profiles").update({ calendar_token: crypto.randomUUID() }).eq("id", id);
    if (error) throw error;
  }

  private async fn(name: string, init: RequestInit = {}): Promise<Response> {
    const { data } = await this.sb.auth.getSession();
    const headers = new Headers(init.headers);
    headers.set("apikey", this.anonKey);
    if (data.session) headers.set("Authorization", `Bearer ${data.session.access_token}`);
    if (init.body) headers.set("Content-Type", "application/json");
    return fetch(`${this.url}/functions/v1/${name}`, { ...init, headers });
  }

  async pushPublicKey(): Promise<string | null> {
    const res = await this.fn("push?action=key");
    if (!res.ok) throw new Error("Der Benachrichtigungs-Dienst ist noch nicht eingerichtet.");
    return (await res.json()).publicKey as string;
  }

  async savePushSubscription(s: PushSubscriptionRow) {
    const { error } = await this.sb.from("push_subscriptions").upsert(s, { onConflict: "endpoint" });
    if (error) throw error;
  }

  async deletePushSubscription(endpoint: string) {
    const { error } = await this.sb.from("push_subscriptions").delete().eq("endpoint", endpoint);
    if (error) throw error;
  }

  async sendTestPush(): Promise<number> {
    const res = await this.fn("push", { method: "POST", body: JSON.stringify({ action: "test" }) });
    if (!res.ok) throw new Error("Test-Nachricht konnte nicht gesendet werden.");
    return (await res.json()).sent as number;
  }

  async voiceReady(): Promise<boolean> {
    const res = await this.fn("voice?action=status");
    return res.ok && !!(await res.json()).ready;
  }

  async speak(text: string): Promise<ArrayBuffer> {
    const res = await this.fn("voice", { method: "POST", body: JSON.stringify({ action: "speak", text }) });
    if (!res.ok) throw new Error(`Stimme ${res.status}`);
    return res.arrayBuffer();
  }

  async transcribe(audio: Blob): Promise<string> {
    const form = new FormData();
    const ext = audio.type.includes("mp4") || audio.type.includes("aac") ? "m4a" : "webm";
    form.append("audio", audio, `sprache.${ext}`);
    const { data } = await this.sb.auth.getSession();
    const res = await fetch(`${this.url}/functions/v1/voice`, {
      method: "POST",
      headers: { apikey: this.anonKey, ...(data.session ? { Authorization: `Bearer ${data.session.access_token}` } : {}) },
      body: form,
    });
    if (!res.ok) throw new Error("Ich konnte dich gerade nicht verstehen. Versuch es nochmal.");
    return ((await res.json()).text as string) ?? "";
  }

  async exportData() {
    const tables = ["memories", "events", "goals", "milestones", "habits", "habit_logs", "days", "messages", "push_subscriptions"] as const;
    const out: Record<string, unknown> = { exported_at: new Date().toISOString(), profile: await this.getProfile() };
    for (const t of tables) {
      const { data, error } = await this.sb.from(t).select("*");
      if (error) throw error;
      out[t] = data;
    }
    return out;
  }

  async deleteAccount() {
    const res = await this.fn("account", { method: "POST", body: JSON.stringify({ action: "delete" }) });
    if (!res.ok) throw new Error("Das Konto konnte nicht gelöscht werden. Bitte später nochmal versuchen.");
    await this.sb.auth.signOut();
  }

  async getMessages(thread: string): Promise<ChatMessage[]> {
    const { data, error } = await this.sb
      .from("messages")
      .select("id, role, content, hidden, created_at")
      .eq("thread", thread)
      .order("id", { ascending: true });
    if (error) throw error;
    return (data ?? []).map((m) => ({ ...m, id: String(m.id) })) as ChatMessage[];
  }

  async getDay(day: string): Promise<DayState | null> {
    const { data, error } = await this.sb.from("days").select("day, mood, focus").eq("day", day).maybeSingle();
    if (error) throw error;
    return (data as DayState) ?? null;
  }

  async tidy(context: CoachContext) {
    await this.coach({ mode: "tidy", thread: context.day, context }, () => {});
  }

  async coach(req: CoachRequest, onEvent: (e: CoachEvent) => void, signal?: AbortSignal) {
    const { data } = await this.sb.auth.getSession();
    const token = data.session?.access_token;
    if (!token) throw new Error("Nicht eingeloggt.");

    const res = await fetch(`${this.url}/functions/v1/coach`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        apikey: this.anonKey,
      },
      body: JSON.stringify(req),
      signal,
    });
    if (!res.ok || !res.body) {
      const text = await res.text().catch(() => "");
      throw new Error(`Der Coach ist gerade nicht erreichbar (${res.status}). ${text.slice(0, 200)}`);
    }

    // Server-Sent Events: "data: {json}\n\n"
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buf.indexOf("\n\n")) >= 0) {
        const chunk = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        for (const line of chunk.split("\n")) {
          if (!line.startsWith("data:")) continue;
          try {
            onEvent(JSON.parse(line.slice(5).trim()) as CoachEvent);
          } catch {
            /* ignore malformed line */
          }
        }
      }
    }
  }
}
