/**
 * The compare-and-swap a rewrite's own write carries: refused when what is
 * stored now is not what the rewrite read, judged only for that write.
 */
import type { PluginFieldWrite, PluginStoredValue } from "@nextlyhq/plugin-sdk";
import { describe, expect, it } from "vitest";

import type { HostAddress } from "./contract";
import { changedSinceRead, HOST_CHANGED, writeExpecting } from "./expectations";
import { storedHash } from "./stored-hash";

const host: HostAddress = {
  kind: "collection",
  slug: "pages",
  id: "p1",
  path: ["content"],
};

function writeOf(stored: unknown, id = "p1"): PluginFieldWrite {
  return {
    kind: "collection",
    slug: "pages",
    id,
    inTransaction: false,
    readStored: async (): Promise<PluginStoredValue> => ({
      kind: "value",
      value: stored,
    }),
  };
}

describe("the compare-and-swap on a rewrite's own write", () => {
  it("refuses the write when the stored value changed since it was read", async () => {
    const expected = {
      host,
      forms: [
        { form: "draft" as const, hash: await storedHash({ nodes: [] }) },
      ],
      judged: { done: false },
    };

    const issue = await writeExpecting(expected, () =>
      changedSinceRead(writeOf({ nodes: [{ id: "edit" }] }), "content")
    );

    expect(issue?.code).toBe(HOST_CHANGED);
  });

  it("lets the write through when the stored value is the one read", async () => {
    const expected = {
      host,
      forms: [
        { form: "draft" as const, hash: await storedHash({ nodes: [] }) },
      ],
      judged: { done: false },
    };

    const issue = await writeExpecting(expected, () =>
      changedSinceRead(writeOf({ nodes: [] }), "content")
    );

    expect(issue).toBeUndefined();
  });

  it("judges no other write: another document, another field, or outside the call", async () => {
    const expected = {
      host,
      forms: [{ form: "draft" as const, hash: await storedHash("x") }],
      judged: { done: false },
    };

    const other = await writeExpecting(expected, () =>
      changedSinceRead(writeOf({ nodes: [] }, "p2"), "content")
    );
    const field = await writeExpecting(expected, () =>
      changedSinceRead(writeOf({ nodes: [] }), "footer")
    );
    const outside = await changedSinceRead(writeOf({ nodes: [] }), "content");

    expect([other, field, outside]).toEqual([undefined, undefined, undefined]);
  });

  it("hashes a value alike however the database hands it back", async () => {
    const parsed = { b: 1, a: { d: [1, 2], c: null } };

    expect(
      await storedHash(JSON.stringify({ a: { c: null, d: [1, 2] }, b: 1 }))
    ).toBe(await storedHash(parsed));
    expect(await storedHash({ a: [2, 1] })).not.toBe(
      await storedHash({ a: [1, 2] })
    );
    expect(await storedHash(undefined)).toBe(await storedHash(null));
  });

  it("refuses a publish when a draft appeared, even one that leaves this field alone", async () => {
    const hash = await storedHash({ nodes: [] });
    let pending = false;
    // One expectation per write, as the writer makes them.
    const expected = () => ({
      host,
      forms: [
        { form: "published" as const, hash },
        { form: "draft" as const, hash },
      ],
      noPendingDraft: async () => !pending,
      judged: { done: false },
    });

    const before = await writeExpecting(expected(), () =>
      changedSinceRead(writeOf({ nodes: [] }), "content")
    );
    // An author saves a draft that changes only the title.
    pending = true;
    const after = await writeExpecting(expected(), () =>
      changedSinceRead(writeOf({ nodes: [] }), "content")
    );

    expect(before).toBeUndefined();
    expect(after?.code).toBe(HOST_CHANGED);
  });

  it("checks every form it names, not only the first", async () => {
    const write: PluginFieldWrite = {
      ...writeOf({ nodes: [] }),
      readStored: async target => ({
        kind: "value",
        value:
          target.form === "draft"
            ? { nodes: [{ id: "draft" }] }
            : { nodes: [] },
      }),
    };
    const hash = await storedHash({ nodes: [] });

    const issue = await writeExpecting(
      {
        host,
        forms: [
          { form: "published", hash },
          { form: "draft", hash },
        ],
        judged: { done: false },
      },
      () => changedSinceRead(write, "content")
    );

    expect(issue?.code).toBe(HOST_CHANGED);
  });

  it("judges only the write's own validation, not a hook's nested write after it", async () => {
    const expected = {
      host,
      forms: [
        { form: "draft" as const, hash: await storedHash({ nodes: [] }) },
      ],
      judged: { done: false },
    };

    const issues = await writeExpecting(expected, async () => [
      // The rewrite's write: the stored value is as read.
      await changedSinceRead(writeOf({ nodes: [] }), "content"),
      // A hook then writes the same field again; the stored value is now the
      // rewrite's, and the expectation is not this write's to meet.
      await changedSinceRead(
        writeOf({ nodes: [{ id: "converted" }] }),
        "content"
      ),
    ]);

    expect(issues).toEqual([undefined, undefined]);
  });

  it("judges no write in another language", async () => {
    const expected = {
      host: { ...host, locale: "de" },
      locale: "de",
      forms: [{ form: "draft" as const, hash: await storedHash("x") }],
      judged: { done: false },
    };
    const english = { ...writeOf({ nodes: [] }) };
    const german = { ...writeOf({ nodes: [] }), locale: "de" };

    const other = await writeExpecting(expected, () =>
      changedSinceRead(english, "content")
    );
    const own = await writeExpecting(expected, () =>
      changedSinceRead(german, "content")
    );

    expect(other).toBeUndefined();
    expect(own?.code).toBe(HOST_CHANGED);
  });
});
