import { DemoBackend } from "./demoBackend";
import { SupabaseBackend } from "./supabaseBackend";
import type { Backend } from "./types";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/** Real backend when Supabase is configured, otherwise the in-browser demo. */
export const backend: Backend = url && key ? new SupabaseBackend(url, key) : new DemoBackend();
