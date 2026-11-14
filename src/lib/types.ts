import type { Mood, NaturePalette } from "./palette";

export interface Profile {
  id: string;
  username: string;
  display_name: string | null;
  onboarded: boolean;
  summary: string | null;
  nature_palette: NaturePalette | null;
  location_name: string | null;
  lat: number | null;
  lon: number | null;
}

export type MemoryCategory = "person" | "arbeit" | "werte" | "rhythmus" | "ziel" | "termin" | "natur" | "anderes";

export interface Memory {
  id: string;
  content: string;
  category: MemoryCategory;
  event_date: string | null; // YYYY-MM-DD
  created_at: string;
  updated_at: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  hidden?: boolean;
  created_at: string;
}

export interface DayState {
  day: string;
  mood: Mood | null;
  focus: string | null;
}

export interface CoachContext {
  day: string; // YYYY-MM-DD, local
  localTime: string; // e.g. "Samstag, 14. November 2026, 18:42"
  timezone: string;
  season: string;
  phase: string; // light phase, e.g. "Sonnenuntergang"
  weather?: string; // e.g. "bedeckt, 7 °C"
  hasLocation: boolean;
}

export interface CoachRequest {
  mode: "onboarding" | "checkin";
  thread: string; // "onboarding" or YYYY-MM-DD
  message?: string; // absent = the app was just opened; coach speaks first
  context: CoachContext;
}

export type CoachEvent =
  | { type: "text"; text: string }
  | { type: "memory"; memory: Memory }
  | { type: "memory_updated"; memory: Memory }
  | { type: "memory_deleted"; id: string }
  | { type: "mood"; mood: Mood }
  | { type: "focus"; focus: string }
  | { type: "palette"; nature: NaturePalette }
  | { type: "profile"; profile: Partial<Profile> }
  | { type: "request_location" }
  | { type: "onboarding_done" }
  | { type: "error"; message: string }
  | { type: "done" };

export interface Backend {
  readonly kind: "supabase" | "demo";
  currentUserId(): Promise<string | null>;
  onAuthChange(cb: (userId: string | null) => void): () => void;
  signUp(username: string, password: string): Promise<void>;
  signIn(username: string, password: string): Promise<void>;
  signOut(): Promise<void>;

  getProfile(): Promise<Profile>;
  updateProfile(patch: Partial<Omit<Profile, "id" | "username">>): Promise<void>;

  listMemories(): Promise<Memory[]>;
  addMemory(m: Pick<Memory, "content" | "category" | "event_date">): Promise<Memory>;
  updateMemory(id: string, patch: Partial<Pick<Memory, "content" | "category" | "event_date">>): Promise<void>;
  deleteMemory(id: string): Promise<void>;

  getMessages(thread: string): Promise<ChatMessage[]>;
  getDay(day: string): Promise<DayState | null>;

  coach(req: CoachRequest, onEvent: (e: CoachEvent) => void, signal?: AbortSignal): Promise<void>;
}

export const USERNAME_RE = /^[a-z0-9._-]{3,30}$/;

export function normaliseUsername(u: string): string {
  return u.trim().toLowerCase();
}
