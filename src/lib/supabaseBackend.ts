import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Backend, CalendarEvent, ChatMessage, CoachContext, CoachEvent, CoachRequest, DayState, Memory, Profile, PushSubscriptionRow } from "./types";
import { normaliseUsername, USERNAME_RE } from "./types";

// Supabase Auth works with e-mail addresses. People here log in with a plain
// username, so each username maps to an internal address on a reserved,
// non-routable domain (RFC 2606). No mail is ever sent there.
const USERNAME_DOMAIN = import.meta.env.VITE_USERNAME_EMAIL_DOMAIN || "nutzer.app-ich.example";

const toEmail = (username: string) => `${normaliseUsername(username)}@${USERNAME_DOMAIN}`;

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

  async listEvents(): Promise<CalendarEvent[]> {
    const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const { data, error } = await this.sb.from("events").select("*").gte("starts_at", since).order("starts_at").limit(500);
    if (error) throw error;
    return data as CalendarEvent[];
  }

  async addEvent(e: Omit<CalendarEvent, "id" | "source">): Promise<CalendarEvent> {
    const { data, error } = await this.sb.from("events").insert({ ...e, source: "person" }).select().single();
    if (error) throw error;
    return data as CalendarEvent;
  }

  async deleteEvent(id: string) {
    const { error } = await this.sb.from("events").delete().eq("id", id);
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

  async exportData() {
    const tables = ["memories", "events", "days", "messages", "push_subscriptions"] as const;
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
