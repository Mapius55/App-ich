import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import nodeCrypto from "node:crypto";
import { b64urlDecode, b64urlEncode, encryptPayload, generateVapidKeys } from "../supabase/functions/_shared/webpush";

const require = createRequire(import.meta.url);
// Reference implementation by the author of the encryption standard, acting as the phone.
const ece = require("http_ece");

describe("web push", () => {
  it("encrypts so the reference implementation can decrypt (RFC 8291)", async () => {
    const ua = nodeCrypto.createECDH("prime256v1");
    ua.generateKeys();
    const auth = nodeCrypto.randomBytes(16);
    const msg = JSON.stringify({ title: "Guten Morgen", body: "Heute: 09:00 Rennen ✓ äöü" });
    const body = await encryptPayload(new TextEncoder().encode(msg), {
      endpoint: "https://push.example/x",
      p256dh: b64urlEncode(ua.getPublicKey()),
      auth: b64urlEncode(auth),
    });
    const plain = ece.decrypt(Buffer.from(body), { version: "aes128gcm", privateKey: ua, authSecret: auth });
    expect(plain.toString("utf8")).toBe(msg);
  });
  it("creates VAPID keys whose signatures verify", async () => {
    const v = await generateVapidKeys();
    expect(b64urlDecode(v.publicKey)).toHaveLength(65);
    const pub = await crypto.subtle.importKey("raw", b64urlDecode(v.publicKey), { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
    const priv = await crypto.subtle.importKey("jwk", v.privateJwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
    const data = new TextEncoder().encode("header.claims");
    const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, priv, data);
    expect(await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, pub, sig, data)).toBe(true);
  });
});
