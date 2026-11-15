import { DemoBackend } from "./demoBackend";
import { SupabaseBackend } from "./supabaseBackend";
import type { Backend } from "./types";

import { SUPABASE_ANON_KEY, SUPABASE_URL } from "./config";

const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined) || SUPABASE_URL;
const key = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) || SUPABASE_ANON_KEY;

// VITE_FORCE_DEMO=1 builds the app in demo mode (used for automated tests,
// so they never touch the real project).
const forceDemo = import.meta.env.VITE_FORCE_DEMO === "1";

/** Real backend when Supabase is configured, otherwise the in-browser demo (with simulated WHOOP and Nolio). */
export const backend: Backend = url && key && !forceDemo ? new SupabaseBackend(url, key) : new DemoBackend({ connections: true });
