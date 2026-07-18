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

const base = {
  id: "evt_1",
  timestamp: "1752796800",
  body: '{"type":"entry.updated"}',
  secret: "shared-secret",
};

describe("signPayload", () => {
  it("produces a v1 token equal to base64(HMAC-SHA256 of id.timestamp.body)", () => {
    const expected = createHmac("sha256", Buffer.from(base.secret, "utf8"))
      .update(`${base.id}.${base.timestamp}.${base.body}`)
      .digest("base64");
    expect(signPayload(base)).toBe(`v1,${expected}`);
  });

  it("is deterministic for the same input", () => {
    expect(signPayload(base)).toBe(signPayload(base));
  });

  it("changes when the body, id, or timestamp changes", () => {
    const sig = signPayload(base);
    expect(signPayload({ ...base, body: base.body + " " })).not.toBe(sig);
    expect(signPayload({ ...base, id: "evt_2" })).not.toBe(sig);
    expect(signPayload({ ...base, timestamp: "1752796801" })).not.toBe(sig);
  });

  it("base64-decodes a whsec_-prefixed secret to key bytes", () => {
    const raw = Buffer.from("rotation-key-material");
    const secret = `whsec_${raw.toString("base64")}`;
    const expected = createHmac("sha256", raw)
      .update(`${base.id}.${base.timestamp}.${base.body}`)
      .digest("base64");
    expect(signPayload({ ...base, secret })).toBe(`v1,${expected}`);
  });
});

describe("buildSignatureHeaders", () => {
  it("returns the three Standard Webhooks headers", () => {
    const headers = buildSignatureHeaders(base);
    expect(headers[WEBHOOK_ID_HEADER]).toBe(base.id);
    expect(headers[WEBHOOK_TIMESTAMP_HEADER]).toBe(base.timestamp);
    expect(headers[WEBHOOK_SIGNATURE_HEADER]).toBe(signPayload(base));
  });
});

describe("verifySignature", () => {
  const header = signPayload(base);

  it("accepts a signature made with the matching secret", () => {
    expect(
      verifySignature({
        ...base,
        signatureHeader: header,
        secrets: [base.secret],
      })
    ).toBe(true);
  });

  it("rejects a signature when no secret matches", () => {
    expect(
      verifySignature({
        ...base,
        signatureHeader: header,
        secrets: ["other-secret"],
      })
    ).toBe(false);
  });

  it("rejects a tampered body", () => {
    expect(
      verifySignature({
        ...base,
        body: '{"type":"entry.deleted"}',
        signatureHeader: header,
        secrets: [base.secret],
      })
    ).toBe(false);
  });

  it("accepts when the header carries multiple space-separated tokens", () => {
    const multi = `v1,invalidsig ${header}`;
    expect(
      verifySignature({
        ...base,
        signatureHeader: multi,
        secrets: [base.secret],
      })
    ).toBe(true);
  });

  it("verifies against any secret during rotation", () => {
    // Signed with the old secret; the new (primary) secret is also present.
    const oldHeader = signPayload({ ...base, secret: "old-secret" });
    expect(
      verifySignature({
        ...base,
        signatureHeader: oldHeader,
        secrets: ["new-secret", "old-secret"],
      })
    ).toBe(true);
  });

  it("rejects a header with no v1 token", () => {
    expect(
      verifySignature({
        ...base,
        signatureHeader: "v2,whatever",
        secrets: [base.secret],
      })
    ).toBe(false);
  });
});
