// Demo mode: runs fully in the browser with a scripted coach, so the app can
// be tried before Supabase and the AI are set up. Everything stays on this
// device. It's a preview, not a real coach.

import type { Backend, ChatMessage, CoachEvent, CoachRequest, DayState, Memory, MemoryCategory, Profile } from "./types";
import { normaliseUsername, USERNAME_RE } from "./types";
import type { NaturePalette } from "./palette";

interface DemoUser {
  passwordHash: string;
  profile: Profile;
  memories: Memory[];
  messages: Record<string, ChatMessage[]>;
  days: Record<string, DayState>;
}

const KEY = "ich.demo.users";
const SESSION = "ich.demo.session";

async function sha256(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}

const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2));
const now = () => new Date().toISOString();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const ONBOARDING: { q: (name: string) => string; category: MemoryCategory }[] = [
  { q: () => "Hoi, schön, dass du da bist. Ich möchte dich gern ein bisschen kennenlernen, damit ich dich gut begleiten kann. Wie darf ich dich nennen?", category: "person" },
  { q: (n) => `Freut mich, ${n}. Was machst du so im Alltag – Arbeit, Studium, oder etwas ganz anderes?`, category: "arbeit" },
  { q: () => "Danke dir. Was ist dir im Leben gerade besonders wichtig?", category: "werte" },
  { q: () => "Wie sieht dein Rhythmus aus? Bist du eher ein Morgen- oder ein Abendmensch, und wann hast du am meisten Energie?", category: "rhythmus" },
  { q: () => "Gibt es etwas, auf das du gerade hinarbeitest – ein Ziel, ein Rennen, ein Projekt?", category: "ziel" },
  { q: () => "Und jetzt etwas Schönes: Welcher Ort in der Natur tut dir gut? Ein Bergsee, das Meer, ein Wald im Herbst …?", category: "natur" },
  { q: () => "Wo wohnst du ungefähr? Wenn du magst, kannst du unten auch deinen Standort freigeben, dann passe ich die Farben an dein Wetter und deinen Sonnenuntergang an.", category: "person" },
];

const NATURE: { words: string[]; palette: NaturePalette }[] = [
  { words: ["see", "berg", "alp", "gletscher"], palette: { name: "Bergsee", colors: ["#4fa3b8", "#9fd3c7", "#e7f0e9", "#6f8fb5", "#2f6f73"] } },
  { words: ["meer", "strand", "küste", "ozean"], palette: { name: "Meer", colors: ["#3fa7c9", "#a8e0e8", "#f3dfc1", "#6ec6b8", "#1f6f99"] } },
  { words: ["wald", "baum", "moos"], palette: { name: "Wald", colors: ["#4f8a5b", "#a7c97d", "#d9c48a", "#2f5d46", "#c98f5a"] } },
  { words: ["herbst", "laub"], palette: { name: "Herbstwald", colors: ["#d9823b", "#e8b04f", "#a8452f", "#7d5a3c", "#f0d08a"] } },
  { words: ["blume", "wiese", "garten", "frühling"], palette: { name: "Blumenwiese", colors: ["#f2a2c0", "#f7d35c", "#a4d17a", "#b79be0", "#ffffff"] } },
  { words: ["wüste", "sand", "düne"], palette: { name: "Wüste", colors: ["#e3a96b", "#f2cf9b", "#c4704a", "#f6e3c4", "#9a5a3c"] } },
  { words: ["schnee", "winter"], palette: { name: "Winterlandschaft", colors: ["#dbe8f5", "#a9c4e3", "#ffffff", "#8aa6c8", "#c7d6ea"] } },
];

function moodFrom(text: string) {
  const t = text.toLowerCase();
  if (/(super|mega|toll|sehr gut|happy|glücklich|wunderbar)/.test(t)) return { valence: 0.8, energy: 0.8, word: "froh" };
  if (/(gut|ok|okay|ganz gut|passt)/.test(t)) return { valence: 0.4, energy: 0.6, word: "gut" };
  if (/(müde|erschöpft|kaputt|schlapp)/.test(t)) return { valence: -0.1, energy: 0.15, word: "müde" };
  if (/(schlecht|traurig|gestresst|stress|mies|schwer)/.test(t)) return { valence: -0.6, energy: 0.35, word: "schwer" };
  return { valence: 0.1, energy: 0.5, word: "gemischt" };
}

export class DemoBackend implements Backend {
  readonly kind = "demo" as const;
  private listeners = new Set<(id: string | null) => void>();

  private load(): Record<string, DemoUser> {
    try {
      return JSON.parse(localStorage.getItem(KEY) || "{}");
    } catch {
      return {};
    }
  }
  private save(users: Record<string, DemoUser>) {
    localStorage.setItem(KEY, JSON.stringify(users));
  }
  private session(): string | null {
    try {
      return localStorage.getItem(SESSION);
    } catch {
      return null;
    }
  }
  private user(): DemoUser {
    const u = this.session();
    const users = this.load();
    if (!u || !users[u]) throw new Error("Nicht eingeloggt.");
    return users[u];
  }
  private mutate(fn: (u: DemoUser) => void) {
    const name = this.session();
    const users = this.load();
    if (!name || !users[name]) throw new Error("Nicht eingeloggt.");
    fn(users[name]);
    this.save(users);
  }
  private emit() {
    const id = this.session();
    const uid = id ? this.load()[id]?.profile.id ?? null : null;
    this.listeners.forEach((l) => l(uid));
  }

  async currentUserId() {
    const name = this.session();
    return name ? this.load()[name]?.profile.id ?? null : null;
  }
  onAuthChange(cb: (id: string | null) => void) {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  async signUp(username: string, password: string) {
    const u = normaliseUsername(username);
    if (!USERNAME_RE.test(u)) throw new Error("Benutzername: 3–30 Zeichen, nur a–z, 0–9, Punkt, Strich, Unterstrich.");
    if (password.length < 8) throw new Error("Das Passwort braucht mindestens 8 Zeichen.");
    const users = this.load();
    if (users[u]) throw new Error("Diesen Benutzernamen gibt es schon.");
    users[u] = {
      passwordHash: await sha256(u + ":" + password),
      profile: { id: uuid(), username: u, display_name: null, onboarded: false, summary: null, nature_palette: null, location_name: null, lat: null, lon: null },
      memories: [],
      messages: {},
      days: {},
    };
    this.save(users);
    localStorage.setItem(SESSION, u);
    this.emit();
  }

  async signIn(username: string, password: string) {
    const u = normaliseUsername(username);
    const user = this.load()[u];
    if (!user || user.passwordHash !== (await sha256(u + ":" + password))) throw new Error("Benutzername oder Passwort stimmt nicht.");
    localStorage.setItem(SESSION, u);
    this.emit();
  }

  async signOut() {
    localStorage.removeItem(SESSION);
    this.emit();
  }

  async getProfile() {
    return this.user().profile;
  }
  async updateProfile(patch: Partial<Profile>) {
    this.mutate((u) => Object.assign(u.profile, patch));
  }
  async listMemories() {
    return this.user().memories;
  }
  async addMemory(m: Pick<Memory, "content" | "category" | "event_date"> & { source?: Memory["source"] }) {
    const mem: Memory = { source: "person", ...m, id: uuid(), created_at: now(), updated_at: now() };
    this.mutate((u) => u.memories.push(mem));
    return mem;
  }
  async updateMemory(id: string, patch: Partial<Memory>) {
    this.mutate((u) => {
      const m = u.memories.find((x) => x.id === id);
      if (m) Object.assign(m, patch, { updated_at: now() });
    });
  }
  async deleteMemory(id: string) {
    this.mutate((u) => (u.memories = u.memories.filter((m) => m.id !== id)));
  }
  async getMessages(thread: string) {
    return this.user().messages[thread] ?? [];
  }
  async getDay(day: string) {
    return this.user().days[day] ?? null;
  }

  async tidy() {
    // The scripted demo coach doesn't judge relevance; the real one does.
  }

  private push(thread: string, role: "user" | "assistant", content: string, hidden = false) {
    this.mutate((u) => {
      (u.messages[thread] ??= []).push({ id: uuid(), role, content, hidden, created_at: now() });
    });
  }

  private async say(text: string, onEvent: (e: CoachEvent) => void) {
    const words = text.split(/(\s+)/);
    for (const w of words) {
      onEvent({ type: "text", text: w });
      await sleep(28);
    }
  }

  async coach(req: CoachRequest, onEvent: (e: CoachEvent) => void) {
    await sleep(500);
    const thread = req.thread;
    const history = (this.user().messages[thread] ?? []).filter((m) => !m.hidden);
    if (req.message) this.push(thread, "user", req.message);
    else this.push(thread, "user", "(App geöffnet)", true);

    let reply = "";
    if (req.mode === "onboarding") {
      const step = history.filter((m) => m.role === "user").length + (req.message ? 1 : 0);
      if (req.message && step >= 1) {
        const cat = ONBOARDING[step - 1]?.category ?? "anderes";
        const mem = await this.addMemory({ content: req.message, category: cat, event_date: null, source: "coach" });
        onEvent({ type: "memory", memory: mem });
        if (step === 1) {
          const name = req.message.replace(/^(ich bin|ich heisse|ich heiße|nenn mich)\s+/i, "").split(/[ ,.!]/)[0];
          await this.updateProfile({ display_name: name });
          onEvent({ type: "profile", profile: { display_name: name } });
        }
        if (cat === "natur") {
          const t = req.message.toLowerCase();
          const hit = NATURE.find((n) => n.words.some((w) => t.includes(w)))?.palette ?? NATURE[0].palette;
          await this.updateProfile({ nature_palette: hit });
          onEvent({ type: "palette", nature: hit });
        }
      }
      const name = this.user().profile.display_name ?? "";
      if (step < ONBOARDING.length) {
        reply = ONBOARDING[step].q(name);
        if (step === ONBOARDING.length - 1) onEvent({ type: "request_location" });
      } else {
        reply = `Danke, ${name}. Ich habe mir das Wichtigste gemerkt – du kannst es jederzeit unter „Was ich über dich weiss“ ansehen und ändern. Ab jetzt begrüsse ich dich jeden Tag hier im Kreis.`;
        await this.updateProfile({ onboarded: true });
        onEvent({ type: "onboarding_done" });
      }
    } else {
      const name = this.user().profile.display_name ?? "";
      const userTurns = history.filter((m) => m.role === "user").length + (req.message ? 1 : 0);
      if (!req.message) {
        const h = new Date().getHours();
        const greet = h < 11 ? "Guten Morgen" : h < 17 ? "Hoi" : "Guten Abend";
        reply = `${greet}, ${name}. Wie geht es dir heute?`;
      } else if (userTurns === 1) {
        const mood = moodFrom(req.message);
        this.mutate((u) => (u.days[req.context.day] = { day: req.context.day, mood, focus: u.days[req.context.day]?.focus ?? null }));
        onEvent({ type: "mood", mood });
        reply =
          mood.valence < 0
            ? "Danke, dass du das teilst. Dann machen wir es heute ruhig. Was wäre eine kleine Sache, die dir heute guttun würde?"
            : "Schön zu hören. Was ist heute das Wichtigste für dich?";
      } else {
        const focus = req.message.slice(0, 80);
        this.mutate((u) => (u.days[req.context.day] = { ...(u.days[req.context.day] ?? { day: req.context.day, mood: null }), focus }));
        onEvent({ type: "focus", focus });
        reply = "Gut, das ist dein Fokus für heute. (Im Demo-Modus antworte ich nur einfach – mit der echten KI wird das ein richtiges Gespräch.)";
      }
    }
    await this.say(reply, onEvent);
    this.push(thread, "assistant", reply);
    onEvent({ type: "done" });
  }
}
