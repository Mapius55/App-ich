import { DemoBackend } from "./demoBackend";
import { SupabaseBackend } from "./supabaseBackend";
import type { Backend } from "./types";

import { SUPABASE_ANON_KEY, SUPABASE_URL } from "./config";

const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined) || SUPABASE_URL;
const key = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) || SUPABASE_ANON_KEY;

/** Real backend when Supabase is configured, otherwise the in-browser demo. */
export const backend: Backend = url && key ? new SupabaseBackend(url, key) : new DemoBackend();
