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
  calendar_token?: string;
  timezone?: string | null;
  notify_morning?: string | null; // "07:30:00"
  notify_evening?: string | null;
}

export interface PushSubscriptionRow {
  endpoint: string;
  p256dh: string;
  auth: string;
  app_url: string;
}

/** An entry in the calendar "I am". */
export interface CalendarEvent {
  id: string;
  title: string;
  starts_at: string; // ISO (UTC)
  ends_at: string | null;
  all_day: boolean;
  location: string | null;
  notes: string | null;
  reminder_minutes: number | null;
  source: "coach" | "person";
  /** "termin": an appointment; "block": time planned with the coach (focus, a training for a goal) */
  kind: "termin" | "block";
  /** the goal this entry serves, if any */
  goal_id: string | null;
  sequence?: number;
  updated_at?: string;
}

/** Fields that can be set when creating or changing a calendar entry. */
export type EventInput = Pick<CalendarEvent, "title" | "starts_at" | "ends_at" | "all_day" | "location" | "notes" | "reminder_minutes"> &
  Partial<Pick<CalendarEvent, "kind" | "goal_id">>;

/** A step (Etappe) of a goal. */
export interface Milestone {
  id: string;
  goal_id: string;
  title: string;
  due_date: string | null; // YYYY-MM-DD
  done_at: string | null; // ISO, null = open
  position: number;
}

export type GoalStatus = "active" | "done" | "paused" | "dropped";

/** Something to work toward, often with a date (a race, an exam, a project). */
export interface Goal {
  id: string;
  title: string;
  why: string | null;
  target_date: string | null; // YYYY-MM-DD
  status: GoalStatus;
  source: "coach" | "person";
  created_at: string;
  updated_at: string;
  /** estimated total effort in hours (e.g. a half marathon ≈ 60, the Olympics ≈ 10'000), null = not estimated */
  effort_hours: number | null;
  /** hours per week she can invest in it, null = unknown */
  weekly_hours: number | null;
  /** hours already invested before the app */
  prior_hours: number;
  /** sorted by position */
  milestones: Milestone[];
  /** time that went into the goal: logged minutes, and past planned blocks not yet confirmed (they count too) */
  time: { logged_minutes: number; block_minutes: number };
}

export type GoalInput = Pick<Goal, "title"> & Partial<Pick<Goal, "why" | "target_date" | "status" | "effort_hours" | "weekly_hours" | "prior_hours">>;

/** A piece of time that went into a goal. */
export interface GoalTime {
  id: string;
  goal_id: string;
  day: string; // YYYY-MM-DD
  minutes: number; // 0 = a planned block that didn't happen
  source: "person" | "coach" | "block" | "nolio" | "whoop";
  event_id: string | null;
  external_id: string | null;
  note: string | null;
}

/** A small recurring goal, e.g. "3x per week running". */
export interface Habit {
  id: string;
  title: string;
  per_week: number; // 1..7, 7 = every day
  goal_id: string | null;
  active: boolean;
  source: "coach" | "person";
  created_at: string;
  /** days it was done (YYYY-MM-DD, local), the last ~16 weeks, ascending */
  done_days: string[];
}

export type HabitInput = Pick<Habit, "title" | "per_week"> & Partial<Pick<Habit, "goal_id" | "active">>;

export type MemoryCategory = "person" | "arbeit" | "werte" | "rhythmus" | "ziel" | "termin" | "ort" | "natur" | "anderes";

export interface Memory {
  id: string;
  content: string;
  category: MemoryCategory;
  event_date: string | null; // YYYY-MM-DD
  source: "coach" | "person"; // the coach's clean-up never touches "person" entries
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
  mode: "onboarding" | "checkin" | "tidy";
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
  | { type: "event_created"; event: CalendarEvent }
  | { type: "event_updated"; event: CalendarEvent }
  | { type: "event_deleted"; id: string; title: string }
  | { type: "goal_saved"; goal: Goal; created?: boolean } // created (created: true) or changed; milestones and time included
  | { type: "time_logged"; goal_id: string; title: string; minutes: number }
  | { type: "goal_deleted"; id: string; title: string }
  | { type: "habit_saved"; habit: Habit }
  | { type: "habit_logged"; habit_id: string; title: string; day: string; done: boolean }
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
  updateMemory(id: string, patch: Partial<Pick<Memory, "content" | "category" | "event_date" | "source">>): Promise<void>;
  deleteMemory(id: string): Promise<void>;

  /** Calendar entries starting in [from, to) (ISO). Without arguments: from yesterday on. */
  listEvents(from?: string, to?: string): Promise<CalendarEvent[]>;
  addEvent(e: EventInput): Promise<CalendarEvent>;
  updateEvent(id: string, patch: Partial<EventInput>): Promise<CalendarEvent>;
  deleteEvent(id: string): Promise<void>;

  /** Goals with their milestones; without done/dropped ones unless `all`. */
  listGoals(all?: boolean): Promise<Goal[]>;
  addGoal(g: GoalInput, milestones?: Pick<Milestone, "title" | "due_date">[]): Promise<Goal>;
  updateGoal(id: string, patch: Partial<GoalInput>): Promise<Goal>;
  deleteGoal(id: string): Promise<void>;
  addMilestone(goalId: string, m: Pick<Milestone, "title" | "due_date">): Promise<Milestone>;
  updateMilestone(id: string, patch: Partial<Pick<Milestone, "title" | "due_date" | "position">> & { done?: boolean }): Promise<Milestone>;
  deleteMilestone(id: string): Promise<void>;
  /**
   * A past planned block (kind 'block' with a goal): did it happen? done=false records 0 minutes,
   * done=true records its planned length (or `minutes`), null removes the answer so it counts by itself again.
   */
  setBlockDone(eventId: string, done: boolean | null, minutes?: number): Promise<void>;
  /** Answers given for blocks: event_id → minutes (0 = didn't happen). */
  blockAnswers(eventIds: string[]): Promise<Record<string, number>>;

  /** Active habits with the days they were done (last ~16 weeks). */
  listHabits(): Promise<Habit[]>;
  addHabit(h: HabitInput): Promise<Habit>;
  updateHabit(id: string, patch: Partial<HabitInput>): Promise<Habit>;
  deleteHabit(id: string): Promise<void>;
  /** Mark a habit as done (or not) on a day (YYYY-MM-DD, local). */
  setHabitDone(habitId: string, day: string, done: boolean): Promise<void>;
  /** Subscription link for the iPhone calendar (null in demo mode). */
  calendarLink(): Promise<string | null>;
  renewCalendarLink(): Promise<void>;

  /** Web push: null when there's no server (demo). */
  pushPublicKey(): Promise<string | null>;
  savePushSubscription(s: PushSubscriptionRow): Promise<void>;
  deletePushSubscription(endpoint: string): Promise<void>;
  sendTestPush(): Promise<number>;

  /** Voice (ElevenLabs on the server): is it set up, speak a text, transcribe a recording. */
  voiceReady(): Promise<boolean>;
  speak(text: string): Promise<ArrayBuffer>;
  transcribe(audio: Blob): Promise<string>;

  /** Everything stored about you, as one JSON object. */
  exportData(): Promise<Record<string, unknown>>;
  /** Deletes the account and all data. */
  deleteAccount(): Promise<void>;

  getMessages(thread: string): Promise<ChatMessage[]>;
  getDay(day: string): Promise<DayState | null>;

  coach(req: CoachRequest, onEvent: (e: CoachEvent) => void, signal?: AbortSignal): Promise<void>;
  /** Quiet daily clean-up: the coach drops unimportant or too personal notes it made itself. */
  tidy(context: CoachContext): Promise<void>;
}

export const USERNAME_RE = /^[a-z0-9._-]{3,30}$/;

export function normaliseUsername(u: string): string {
  return u.trim().toLowerCase();
}
