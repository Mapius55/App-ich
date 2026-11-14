// Supabase Edge Function: the coach's voice (ElevenLabs).
//   POST JSON {action:"speak", text}        → audio/mpeg (the coach says the text)
//   POST multipart (field "audio")          → {text} (what you said, transcribed)
//   GET  ?action=status                      → {ready:boolean} (is a voice configured?)
// Needs the login of the person (checked here) and the secret ELEVENLABS_API_KEY.
// Optional secrets: ELEVENLABS_VOICE_ID, ELEVENLABS_TTS_MODEL, ELEVENLABS_STT_MODEL.

import { createClient } from "npm:@supabase/supabase-js@2.119.0";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
const EL = "https://api.elevenlabs.io/v1";
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const key = () => Deno.env.get("ELEVENLABS_API_KEY") ?? "";
const TTS_MODEL = () => Deno.env.get("ELEVENLABS_TTS_MODEL") || "eleven_multilingual_v2";
const STT_MODEL = () => Deno.env.get("ELEVENLABS_STT_MODEL") || "scribe_v3";

// A warm female voice: the configured one, else the first match from the account's voices.
const PREFERRED = ["Matilda", "Sarah", "Lily", "Alice", "Charlotte", "Jessica", "Laura"];
let cachedVoice: string | null = null;
async function voiceId(): Promise<string> {
  const configured = Deno.env.get("ELEVENLABS_VOICE_ID");
  if (configured) return configured;
  if (cachedVoice) return cachedVoice;
  const res = await fetch(`${EL}/voices`, { headers: { "xi-api-key": key() } });
  if (!res.ok) throw new Error(`voices ${res.status}`);
  const { voices } = (await res.json()) as { voices: { voice_id: string; name: string; labels?: Record<string, string> }[] };
  const byName = PREFERRED.map((n) => voices.find((v) => v.name.toLowerCase().startsWith(n.toLowerCase()))).find(Boolean);
  const female = voices.find((v) => v.labels?.gender === "female");
  cachedVoice = (byName ?? female ?? voices[0]).voice_id;
  return cachedVoice;
}

async function authorised(req: Request): Promise<boolean> {
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return false;
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { auth: { persistSession: false } });
  const { data, error } = await sb.auth.getUser(token);
  return !error && !!data.user;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method === "GET") return json({ ready: !!key() });
  if (req.method !== "POST") return json({ error: "method" }, 405);
  if (!key()) return json({ error: "no_voice", message: "Für die Stimme fehlt noch ELEVENLABS_API_KEY auf dem Server." }, 503);
  if (!(await authorised(req))) return json({ error: "unauthorized" }, 401);

  const type = req.headers.get("Content-Type") ?? "";

  // ---- listen: audio in, text out
  if (type.startsWith("multipart/form-data")) {
    const form = await req.formData();
    const audio = form.get("audio");
    if (!(audio instanceof File) || audio.size === 0) return json({ error: "no audio" }, 400);
    if (audio.size > 15 * 1024 * 1024) return json({ error: "too long" }, 413);
    const out = new FormData();
    out.append("model_id", STT_MODEL());
    out.append("file", audio, audio.name || "speech.webm");
    out.append("language_code", "deu");
    out.append("tag_audio_events", "false");
    const res = await fetch(`${EL}/speech-to-text`, { method: "POST", headers: { "xi-api-key": key() }, body: out });
    if (!res.ok) {
      console.error("stt", res.status, await res.text());
      return json({ error: "stt", status: res.status }, 502);
    }
    const data = (await res.json()) as { text?: string };
    return json({ text: (data.text ?? "").trim() });
  }

  // ---- speak: text in, audio out (streamed through)
  let body: { action?: string; text?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "bad request" }, 400);
  }
  const text = (body.text ?? "").trim().slice(0, 1500);
  if (body.action !== "speak" || !text) return json({ error: "bad request" }, 400);

  const res = await fetch(`${EL}/text-to-speech/${await voiceId()}/stream?output_format=mp3_44100_128`, {
    method: "POST",
    headers: { "xi-api-key": key(), "Content-Type": "application/json", Accept: "audio/mpeg" },
    body: JSON.stringify({
      text,
      model_id: TTS_MODEL(),
      language_code: TTS_MODEL().includes("multilingual_v2") ? undefined : "de",
      voice_settings: { stability: 0.55, similarity_boost: 0.8, style: 0.15, use_speaker_boost: true },
    }),
  });
  if (!res.ok || !res.body) {
    console.error("tts", res.status, await res.text().catch(() => ""));
    return json({ error: "tts", status: res.status }, 502);
  }
  return new Response(res.body, { headers: { ...CORS, "Content-Type": "audio/mpeg", "Cache-Control": "no-store" } });
});
