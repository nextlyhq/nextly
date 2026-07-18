import { createHmac } from "node:crypto";

import { describe, it, expect } from "vitest";

import {
  buildSignatureHeaders,
  signPayload,
  verifySignature,
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
// A clock inside the freshness window for the fixed fixture timestamp.
const now = new Date(Number(base.timestamp) * 1000);

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

describe("verifySignature", () => {
  const header = signPayload(base);

  it("accepts a fresh signature made with the matching secret", () => {
    expect(
      verifySignature({
        ...base,
        signatureHeader: header,
        secrets: [secret],
        now,
      })
    ).toBe(true);
  });

  it("accepts a whsec_-prefixed secret round-trip", () => {
    expect(
      verifySignature({
        ...base,
        signatureHeader: header,
        secrets: [`whsec_${secret}`],
        now,
      })
    ).toBe(true);
  });

  it("rejects a signature when no secret matches", () => {
    expect(
      verifySignature({
        ...base,
        signatureHeader: header,
        secrets: [
          Buffer.from("other-key-material-1234567890").toString("base64"),
        ],
        now,
      })
    ).toBe(false);
  });

  it("rejects a tampered body", () => {
    expect(
      verifySignature({
        ...base,
        body: '{"type":"entry.deleted"}',
        signatureHeader: header,
        secrets: [secret],
        now,
      })
    ).toBe(false);
  });

  it("accepts when the header carries multiple space-separated tokens", () => {
    expect(
      verifySignature({
        ...base,
        signatureHeader: `v1,AAAA ${header}`,
        secrets: [secret],
        now,
      })
    ).toBe(true);
  });

  it("verifies against any secret during rotation", () => {
    const oldSecret = Buffer.from("old-key-material-abcdefghij").toString(
      "base64"
    );
    const oldHeader = signPayload({ ...base, secret: oldSecret });
    expect(
      verifySignature({
        ...base,
        signatureHeader: oldHeader,
        secrets: [secret, oldSecret],
        now,
      })
    ).toBe(true);
  });

  it("rejects a stale timestamp outside the tolerance", () => {
    // now is ~10 minutes after the signed timestamp; default tolerance is 5.
    const stale = new Date((Number(base.timestamp) + 600) * 1000);
    expect(
      verifySignature({
        ...base,
        signatureHeader: header,
        secrets: [secret],
        now: stale,
      })
    ).toBe(false);
  });

  it("can skip the freshness check with an infinite tolerance", () => {
    const stale = new Date((Number(base.timestamp) + 600) * 1000);
    expect(
      verifySignature({
        ...base,
        signatureHeader: header,
        secrets: [secret],
        now: stale,
        toleranceSeconds: Infinity,
      })
    ).toBe(true);
  });

  it("rejects a header with no v1 token", () => {
    expect(
      verifySignature({
        ...base,
        signatureHeader: "v2,whatever",
        secrets: [secret],
        now,
      })
    ).toBe(false);
  });
});
