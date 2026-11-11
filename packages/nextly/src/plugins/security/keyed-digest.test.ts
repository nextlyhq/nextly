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
    getAll: async () =>
      Object.fromEntries(
        [...rows].map(([key, value]) => [key, JSON.parse(value) as unknown])
      ),
  } as DigestKeyStore & { rows: Map<string, string> };
}

const A = "a".repeat(40);
const B = "b".repeat(40);

/** Whether the calling flow is in a transaction, as a test sets it. */
const flow = { inTransaction: false };

function digests(
  store: DigestKeyStore,
  secrets: readonly string[],
  owner = "@acme/forms"
) {
  return createKeyedDigests({
    owner,
    store: () => store,
    secrets: () => secrets,
    probe: () => ({ transactionOpenInFlow: () => flow.inTransaction }),
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

  it("are sealed at start under the current secret, a removed plugin's too", async () => {
    const store = memoryStore();
    const before = await digests(store, [A]).digest("email", "x");
    // A plugin removed from the config that left its data and its key behind.
    const retained = await digests(store, [A], "@removed/plugin").digest(
      "ip",
      "y"
    );

    await resealPluginDigestKeys(store, [B, A]);

    expect(await digests(store, [B]).digest("email", "x")).toBe(before);
    expect(await digests(store, [B], "@removed/plugin").digest("ip", "y")).toBe(
      retained
    );
    // No key is made here for a plugin that never asked for one.
    expect(store.rows.has(digestKeyMetaKey("@never/used"))).toBe(false);
  });

  it("leave a key no secret opens as stored at start, rather than failing it", async () => {
    const store = memoryStore();
    await digests(store, [A]).digest("email", "x");
    const stored = store.rows.get(digestKeyMetaKey("@acme/forms"));

    await expect(resealPluginDigestKeys(store, [B])).resolves.toBeUndefined();
    expect(store.rows.get(digestKeyMetaKey("@acme/forms"))).toBe(stored);
  });

  it("refuse a first use inside a transaction, and work there once prepared", async () => {
    const store = memoryStore();
    const helper = digests(store, [A]);

    flow.inTransaction = true;
    try {
      // Made inside a transaction, the key could be rolled back while this
      // process kept using it.
      await expect(helper.digest("email", "x")).rejects.toMatchObject({
        code: "INTERNAL_ERROR",
      });
      expect(store.rows.size).toBe(0);

      flow.inTransaction = false;
      await helper.prepare();
      flow.inTransaction = true;
      expect(await helper.digest("email", "x")).toMatch(/^[0-9a-f]{64}$/);
    } finally {
      flow.inTransaction = false;
    }
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
