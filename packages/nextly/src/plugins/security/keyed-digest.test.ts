/**
 * A plugin's keyed digests: stable for a purpose and value, its own, made
 * from one key whoever makes it first, and still matching after the install's
 * secret rotates and the previous secret is removed.
 */
import { describe, expect, it } from "vitest";

import {
  createKeyedDigests,
  digestKeyMetaKey,
  resealPluginDigestKeys,
  type DigestKeyStore,
} from "./keyed-digest";

/**
 * `nextly_meta` as the helper uses it: a row inserted only when absent, and
 * replaced only while it still holds what was read.
 */
function memoryStore(): DigestKeyStore & { rows: Map<string, string> } {
  const rows = new Map<string, string>();
  return {
    rows,
    getEntry: async <T>(key: string) =>
      rows.has(key)
        ? { present: true as const, value: JSON.parse(rows.get(key)!) as T }
        : { present: false as const },
    insertIfAbsent: async (key: string, value: unknown) => {
      if (!rows.has(key)) rows.set(key, JSON.stringify(value));
    },
    compareAndSet: async (key: string, expected: unknown, next: unknown) => {
      if (rows.get(key) !== JSON.stringify(expected)) return false;
      rows.set(key, JSON.stringify(next));
      return true;
    },
  } as DigestKeyStore & { rows: Map<string, string> };
}

const A = "a".repeat(40);
const B = "b".repeat(40);

function digests(
  store: DigestKeyStore,
  secrets: readonly string[],
  owner = "@acme/forms"
) {
  return createKeyedDigests({
    owner,
    store: () => store,
    secrets: () => secrets,
  });
}

describe("a plugin's keyed digests", () => {
  it("are the same for a purpose and value, and differ by purpose", async () => {
    const store = memoryStore();
    const helper = digests(store, [A]);
    const one = await helper.digest("email", "ada@example.com");
    expect(await helper.digest("email", "ada@example.com")).toBe(one);
    expect(one).toMatch(/^[0-9a-f]{64}$/);
    expect(await helper.digest("ip", "ada@example.com")).not.toBe(one);
    expect(await helper.digest("email", "grace@example.com")).not.toBe(one);
  });

  it("are each plugin's own", async () => {
    const store = memoryStore();
    const mine = await digests(store, [A], "@acme/forms").digest("email", "x");
    const theirs = await digests(store, [A], "@other/plugin").digest(
      "email",
      "x"
    );
    expect(theirs).not.toBe(mine);
  });

  it("keep the key out of what is stored, sealed under the secret", async () => {
    const store = memoryStore();
    await digests(store, [A]).digest("email", "x");
    const stored = JSON.parse(store.rows.get(digestKeyMetaKey("@acme/forms"))!);
    expect(stored).toMatch(/^sealed:v2:/);
  });

  it("use the key made first when two make it at once", async () => {
    const store = memoryStore();
    const [one, two] = await Promise.all([
      digests(store, [A]).digest("email", "x"),
      digests(store, [A]).digest("email", "x"),
    ]);
    expect(two).toBe(one);
  });

  it("still match after the secret rotates and the previous one is removed", async () => {
    const store = memoryStore();
    const before = await digests(store, [A]).digest("email", "x");

    // Rotated: B is current, A is kept for reading. The first read seals the
    // same key again under B.
    expect(await digests(store, [B, A]).digest("email", "x")).toBe(before);
    // A removed: the key, now sealed under B, still opens.
    expect(await digests(store, [B]).digest("email", "x")).toBe(before);
  });

  it("are sealed at start under the current secret, before the previous one goes", async () => {
    const store = memoryStore();
    const before = await digests(store, [A]).digest("email", "x");
    await resealPluginDigestKeys(
      [{ name: "@acme/forms" }, { name: "@never/used" }],
      store,
      [B, A]
    );

    expect(await digests(store, [B]).digest("email", "x")).toBe(before);
    // A plugin that never asked for a digest is given no key here.
    expect(store.rows.has(digestKeyMetaKey("@never/used"))).toBe(false);
  });

  it("keep the key made with no secret, and seal it once one is set", async () => {
    const store = memoryStore();
    const before = await digests(store, []).digest("email", "x");
    expect(
      JSON.parse(store.rows.get(digestKeyMetaKey("@acme/forms"))!)
    ).toMatch(/^unsealed:/);

    expect(await digests(store, [A]).digest("email", "x")).toBe(before);
    expect(
      JSON.parse(store.rows.get(digestKeyMetaKey("@acme/forms"))!)
    ).toMatch(/^sealed:/);
  });

  it("refuse to read a key no configured secret opens", async () => {
    const store = memoryStore();
    await digests(store, [A]).digest("email", "x");
    await expect(
      digests(store, [B]).digest("email", "x")
    ).rejects.toMatchObject({
      code: "INTERNAL_ERROR",
    });
  });

  it("refuse a purpose that is not a short lowercase name", async () => {
    await expect(
      digests(memoryStore(), [A]).digest("Email Address", "x")
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });
});
