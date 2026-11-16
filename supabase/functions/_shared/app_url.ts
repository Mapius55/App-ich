// Where an OAuth callback may send the browser back to: the app's own address. Provider-neutral
// (WHOOP now, Polar later). The app sends its address with "start"
//   return_to = new URL(import.meta.env.BASE_URL, location.origin).href
// and the server keeps it only when it is EXACTLY one of the allowed addresses (no prefix match, no
// other host, no http, no extra path, query or hash). It is stored with the OAuth state and read back by
// the callback, which redirects there; anything else falls back to the configured or default address.
// Why: the app moves from /App-ich/ to /bucket-list/ when the repository is renamed, and must work at both.

/** The app's address after the repository rename: the fallback when nothing else is known. */
export const DEFAULT_APP_URL = "https://mapius55.github.io/bucket-list/";

/** Every address the app is served from, before and after the repository rename. */
export const KNOWN_APP_URLS: readonly string[] = ["https://mapius55.github.io/App-ich/", DEFAULT_APP_URL];

const MAX_LENGTH = 200;

/** An address from the environment (e.g. WHOOP_APP_URL): kept only if it is an absolute https URL. */
export function configuredAppUrl(raw: string | null | undefined): string | null {
  const v = (raw ?? "").trim();
  if (!v || v.length > MAX_LENGTH || !/^https:\/\/[^\s]+$/.test(v)) return null;
  try {
    return new URL(v).protocol === "https:" ? v : null;
  } catch {
    return null;
  }
}

/** The allowed return addresses: the configured one (if any) plus the known ones, without duplicates. */
export function appUrlAllowlist(configured?: string | null): string[] {
  const own = configuredAppUrl(configured);
  return [...new Set([...(own ? [own] : []), ...KNOWN_APP_URLS])];
}

/** Where to go when the app sent nothing usable: the configured address, else DEFAULT_APP_URL. */
export function fallbackAppUrl(configured?: string | null): string {
  return configuredAppUrl(configured) ?? DEFAULT_APP_URL;
}

/** return_to exactly as the app sent it, if it is on the allowlist; otherwise null. */
export function allowedReturnTo(candidate: unknown, allowlist: readonly string[]): string | null {
  if (typeof candidate !== "string" || candidate.length === 0 || candidate.length > MAX_LENGTH) return null;
  return allowlist.includes(candidate) ? candidate : null;
}
