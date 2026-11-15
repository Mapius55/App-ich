import { DemoBackend } from "./demoBackend";
import { SupabaseBackend } from "./supabaseBackend";
import type { Backend } from "./types";

import { SUPABASE_ANON_KEY, SUPABASE_URL } from "./config";

const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined) || SUPABASE_URL;
const key = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) || SUPABASE_ANON_KEY;

// VITE_FORCE_DEMO=1 builds the app in demo mode (used for automated tests,
// so they never touch the real project).
const forceDemo = import.meta.env.VITE_FORCE_DEMO === "1";

/**
 * The demo simulates WHOOP and Nolio; localStorage "ich.demo.connections" = "0" shows them as not
 * deployed ("Bald verfügbar"), "ich.demo.nolio" = "0" makes the account a member who is not the Nolio
 * owner (as everyone but the owner in production).
 */
function demoFlag(key: string): boolean {
  try {
    return localStorage.getItem(key) !== "0";
  } catch {
    return true;
  }
}

/** Real backend when Supabase is configured, otherwise the in-browser demo. */
export const backend: Backend = url && key && !forceDemo ? new SupabaseBackend(url, key) : new DemoBackend({ connections: demoFlag("ich.demo.connections"), nolioOwner: demoFlag("ich.demo.nolio") });
