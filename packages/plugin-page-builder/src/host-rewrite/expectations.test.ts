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
      form: "draft" as const,
      hash: await storedHash({ nodes: [] }),
    };

    const issue = await writeExpecting(expected, () =>
      changedSinceRead(writeOf({ nodes: [{ id: "edit" }] }), "content")
    );

    expect(issue?.code).toBe(HOST_CHANGED);
  });

  it("lets the write through when the stored value is the one read", async () => {
    const expected = {
      host,
      form: "draft" as const,
      hash: await storedHash({ nodes: [] }),
    };

    const issue = await writeExpecting(expected, () =>
      changedSinceRead(writeOf({ nodes: [] }), "content")
    );

    expect(issue).toBeUndefined();
  });

  it("judges no other write: another document, another field, or outside the call", async () => {
    const expected = {
      host,
      form: "draft" as const,
      hash: await storedHash("x"),
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
});
