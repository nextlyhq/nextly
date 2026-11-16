import { createHmac } from "node:crypto";

import { describe, it, expect } from "vitest";

import {
  buildSignatureHeaders,
  signPayload,
  WEBHOOK_ID_HEADER,
  WEBHOOK_SIGNATURE_HEADER,
  WEBHOOK_TIMESTAMP_HEADER,
} from "../signing";

// Secrets are Standard Webhooks base64 key material. KEY is the raw bytes;
// `secret` is the stored (base64) form, and the whsec_ form decodes to the same
// KEY — all three must produce the same HMAC.
const KEY = Buffer.from("shared-secret-key-material-abcdef");
const secret = KEY.toString("base64");
const base = {
  id: "evt_1",
  timestamp: "1752796800",
  body: '{"type":"entry.updated"}',
  secret,
};

function hmac(key: Buffer): string {
  return createHmac("sha256", key)
    .update(`${base.id}.${base.timestamp}.${base.body}`)
    .digest("base64");
}

describe("signPayload", () => {
  it("produces a v1 token equal to base64(HMAC-SHA256 over the base64-decoded key)", () => {
    expect(signPayload(base)).toBe(`v1,${hmac(KEY)}`);
  });

  it("treats a whsec_-prefixed secret as the same base64 key material", () => {
    expect(signPayload({ ...base, secret: `whsec_${secret}` })).toBe(
      signPayload(base)
    );
  });

  it("changes when the body, id, or timestamp changes", () => {
    const sig = signPayload(base);
    expect(signPayload({ ...base, body: base.body + " " })).not.toBe(sig);
    expect(signPayload({ ...base, id: "evt_2" })).not.toBe(sig);
    expect(signPayload({ ...base, timestamp: "1752796801" })).not.toBe(sig);
  });
});

describe("buildSignatureHeaders", () => {
  it("returns the three headers, signed with the single active secret", () => {
    const headers = buildSignatureHeaders({ ...base, secrets: [secret] });
    expect(headers[WEBHOOK_ID_HEADER]).toBe(base.id);
    expect(headers[WEBHOOK_TIMESTAMP_HEADER]).toBe(base.timestamp);
    expect(headers[WEBHOOK_SIGNATURE_HEADER]).toBe(`v1,${hmac(KEY)}`);
  });

  it("throws rather than emitting a blank signature for an empty secret list", () => {
    expect(() => buildSignatureHeaders({ ...base, secrets: [] })).toThrow();
  });

  it("throws on a zero-length signing key (empty or bare whsec_)", () => {
    expect(() => buildSignatureHeaders({ ...base, secrets: [""] })).toThrow();
    expect(() =>
      buildSignatureHeaders({ ...base, secrets: ["whsec_"] })
    ).toThrow();
  });

  it("emits one space-delimited signature per active secret during rotation", () => {
    const oldKey = Buffer.from("old-secret-key-material-zzzzzzzz");
    const headers = buildSignatureHeaders({
      ...base,
      secrets: [secret, oldKey.toString("base64")],
    });
    expect(headers[WEBHOOK_SIGNATURE_HEADER]).toBe(
      `v1,${hmac(KEY)} v1,${hmac(oldKey)}`
    );
  });
});
