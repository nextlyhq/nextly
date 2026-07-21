/**
 * The signing-secret lifecycle.
 *
 * A generated secret has to satisfy two independent readers: `signing.ts`,
 * which strips `whsec_` and base64-decodes the rest to HMAC key bytes, and the
 * receiver's own Standard Webhooks library, which does exactly the same. A
 * secret that decodes to nothing still produces a valid-looking signature, so
 * the format is asserted rather than assumed.
 *
 * The encryption half is asserted through a round trip rather than against a
 * fixed ciphertext: AES-GCM uses a random salt and IV, so the same plaintext
 * encrypts differently every time, and a golden value would only prove the
 * test was written from the output.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { buildSignatureHeaders } from "../signing";

import {
  WEBHOOK_SECRET_PREFIX,
  decryptWebhookSecret,
  encryptWebhookSecret,
  generateWebhookSecret,
  webhookEncryptionKey,
  webhookSecretPrefix,
} from "../secret";

// The crypto takes its key as a parameter, so these need no environment at
// all. Only the env-sourcing helper below does.
const KEY = "test-application-secret";

describe("generateWebhookSecret", () => {
  it("produces a secret signing.ts can turn into key bytes", () => {
    const secret = generateWebhookSecret();

    expect(secret.startsWith(WEBHOOK_SECRET_PREFIX)).toBe(true);
    const decoded = Buffer.from(
      secret.slice(WEBHOOK_SECRET_PREFIX.length),
      "base64"
    );
    expect(decoded.length).toBe(32);

    // The real contract: it signs. A secret that decoded to zero bytes would
    // make signing throw rather than emit a weak signature.
    const headers = buildSignatureHeaders({
      id: "msg_1",
      timestamp: 1_700_000_000,
      body: '{"a":1}',
      secrets: [secret],
    });
    expect(headers["webhook-signature"]).toMatch(/^v1,/);
  });

  it("does not repeat", () => {
    const seen = new Set(
      Array.from({ length: 50 }, () => generateWebhookSecret())
    );
    expect(seen.size).toBe(50);
  });
});

describe("webhookSecretPrefix", () => {
  it("keeps enough to identify a secret and little enough to be public", () => {
    const secret = `${WEBHOOK_SECRET_PREFIX}abcdefghijklmnop`;

    // Includes the scheme prefix, so what is stored reads as an identifier
    // rather than as key material.
    expect(webhookSecretPrefix(secret)).toBe("whsec_ab");
    expect(webhookSecretPrefix(secret).length).toBeLessThan(secret.length / 2);
  });
});

describe("encrypt/decrypt round trip", () => {
  it("recovers the exact secret", () => {
    const secret = generateWebhookSecret();
    expect(decryptWebhookSecret(encryptWebhookSecret(secret, KEY), KEY)).toBe(
      secret
    );
  });

  it("produces different ciphertext for the same secret", () => {
    // Random salt and IV per call: identical stored values would leak that two
    // endpoints share a secret.
    const secret = generateWebhookSecret();
    expect(encryptWebhookSecret(secret, KEY)).not.toBe(
      encryptWebhookSecret(secret, KEY)
    );
  });

  it("does not store the plaintext anywhere in the ciphertext", () => {
    const secret = generateWebhookSecret();
    const stored = encryptWebhookSecret(secret, KEY);

    expect(stored).not.toContain(secret);
    expect(stored).not.toContain(secret.slice(WEBHOOK_SECRET_PREFIX.length));
  });

  it("refuses a value encrypted under a different key", () => {
    const stored = encryptWebhookSecret(generateWebhookSecret(), KEY);

    expect(() =>
      decryptWebhookSecret(stored, "a-different-application-secret")
    ).toThrow();
  });
});

describe("webhookEncryptionKey", () => {
  // Reading env validates the whole environment, so these set the database
  // fields the schema requires alongside the key under test. The env module
  // caches after its first read, so each case loads a fresh copy rather than
  // seeing whatever the previous one cached.
  const saved: Record<string, string | undefined> = {};
  const set = (k: string, v: string | undefined): void => {
    if (!(k in saved)) saved[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  };

  const loadKey = async (): Promise<() => string> => {
    vi.resetModules();
    const mod = await import("../secret");
    return mod.webhookEncryptionKey;
  };

  beforeEach(() => {
    set("DB_DIALECT", "sqlite");
    set("DATABASE_URL", "file:./secret-test.db");
  });

  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) {
      // Assigning undefined stores the literal string "undefined", which a
      // later read in this shared process would treat as a real value.
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it("returns the configured key", async () => {
    set("NEXTLY_SECRET", KEY);
    expect((await loadKey())()).toBe(KEY);
  });

  // The email provider service stores its configuration in the clear when no
  // key is set. That is survivable for one provider's credentials; a webhook
  // secret IS the signing key, so storing it readable would let anyone with
  // database access forge a signature every receiver accepts. Fail instead.
  it("throws when no key is configured", async () => {
    set("NEXTLY_SECRET", undefined);
    const key = await loadKey();
    expect(() => key()).toThrow();
  });
});
