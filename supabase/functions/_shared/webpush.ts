// Minimal Web Push sender using only WebCrypto (works in Deno and Node ≥ 20).
//   - Payload encryption: RFC 8291 (aes128gcm content coding, RFC 8188)
//   - Server identification: RFC 8292 (VAPID, ES256 JWT)

export interface PushSubscriptionKeys {
  endpoint: string;
  p256dh: string; // base64url, uncompressed P-256 point (65 bytes)
  auth: string; // base64url, 16 bytes
}

export interface VapidKeys {
  publicKey: string; // base64url raw public key (65 bytes)
  privateJwk: JsonWebKey;
}

const enc = new TextEncoder();
type Bytes = Uint8Array<ArrayBuffer>;

export function b64urlEncode(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function b64urlDecode(s: string): Bytes {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
  const bin = atob(b64);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

function concat(...parts: Uint8Array[]): Bytes {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

async function hmac(key: Bytes, data: Bytes): Promise<Bytes> {
  const k = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, data));
}

/** HKDF (RFC 5869) with a single expand block (length ≤ 32). */
async function hkdf(salt: Bytes, ikm: Bytes, info: Bytes, length: number): Promise<Bytes> {
  const prk = await hmac(salt, ikm);
  const okm = await hmac(prk, concat(info, new Uint8Array([1])));
  return okm.slice(0, length);
}

/** Generates a new VAPID key pair (store it; it must stay the same). */
export async function generateVapidKeys(): Promise<VapidKeys> {
  const kp = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
  const raw = new Uint8Array(await crypto.subtle.exportKey("raw", kp.publicKey));
  const privateJwk = await crypto.subtle.exportKey("jwk", kp.privateKey);
  return { publicKey: b64urlEncode(raw), privateJwk };
}

/** Encrypts a payload for one subscription (aes128gcm). */
export async function encryptPayload(payload: Bytes, sub: PushSubscriptionKeys, salt?: Bytes): Promise<Bytes> {
  const uaPublic = b64urlDecode(sub.p256dh);
  const authSecret = b64urlDecode(sub.auth);

  const as = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"])) as CryptoKeyPair;
  const asPublic = new Uint8Array(await crypto.subtle.exportKey("raw", as.publicKey));
  const uaKey = await crypto.subtle.importKey("raw", uaPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, as.privateKey, 256));

  // RFC 8291 §3.3: IKM from the ECDH secret, bound to the auth secret and both public keys
  const keyInfo = concat(enc.encode("WebPush: info\0"), uaPublic, asPublic);
  const ikm = await hkdf(authSecret, shared, keyInfo, 32);

  // RFC 8188: content encryption key and nonce
  const s = salt ?? crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(s, ikm, enc.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(s, ikm, enc.encode("Content-Encoding: nonce\0"), 12);

  const plaintext = concat(payload, new Uint8Array([2])); // 0x02 = last record, no padding
  const key = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, key, plaintext));

  const header = new Uint8Array(16 + 4 + 1);
  header.set(s, 0);
  new DataView(header.buffer).setUint32(16, 4096);
  header[20] = asPublic.length;
  return concat(header, asPublic, ciphertext);
}

async function vapidJwt(audience: string, subject: string, vapid: VapidKeys): Promise<string> {
  const header = b64urlEncode(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = b64urlEncode(
    enc.encode(JSON.stringify({ aud: audience, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: subject })),
  );
  const key = await crypto.subtle.importKey("jwk", vapid.privateJwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, enc.encode(`${header}.${claims}`)));
  return `${header}.${claims}.${b64urlEncode(sig)}`;
}

/**
 * Sends one notification. Returns the push service's HTTP status
 * (201 = accepted; 404/410 = subscription gone and should be deleted).
 */
export async function sendPush(
  sub: PushSubscriptionKeys,
  payload: unknown,
  vapid: VapidKeys,
  subject: string,
  ttlSeconds = 6 * 3600,
): Promise<number> {
  const body = await encryptPayload(enc.encode(JSON.stringify(payload)), sub);
  const audience = new URL(sub.endpoint).origin;
  const jwt = await vapidJwt(audience, subject, vapid);
  const res = await fetch(sub.endpoint, {
    method: "POST",
    headers: {
      "Content-Encoding": "aes128gcm",
      "Content-Type": "application/octet-stream",
      TTL: String(ttlSeconds),
      Urgency: "normal",
      Authorization: `vapid t=${jwt}, k=${vapid.publicKey}`,
    },
    body,
  });
  await res.body?.cancel();
  return res.status;
}
