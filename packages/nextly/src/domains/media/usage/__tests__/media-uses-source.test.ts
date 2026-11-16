/**
 * The booted answer to where an item is used: the email templates using it
 * are named in statements no larger than the database takes.
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { describe, expect, it, vi } from "vitest";

import { mediaUseReadKey } from "../media-uses";
import { bootedMediaUsesSource } from "../media-uses-source";

vi.mock("../../../../auth/entity-read-access", () => ({
  callerHoldsPermission: vi.fn(async () => true),
  readAccessCaller: vi.fn((caller: unknown) => caller),
}));

/** The most values one statement binds, in this fake database. */
const LIMIT = 3;

/** A database that refuses a statement binding more than {@link LIMIT}. */
function limitedAdapter(): {
  adapter: DrizzleAdapter;
  statements: number[];
} {
  const statements: number[] = [];
  const adapter = {
    getCapabilities: () => ({ maxParamsPerQuery: LIMIT }),
    select: async (
      _table: string,
      options: { where: { and: Array<{ value: string[] }> } }
    ) => {
      const ids = options.where.and[0]!.value;
      statements.push(ids.length);
      if (ids.length > LIMIT) throw new Error("too many SQL variables");
      return ids.map(id => ({ id, name: `Template ${id}` }));
    },
  };
  return { adapter: adapter as unknown as DrizzleAdapter, statements };
}

describe("bootedMediaUsesSource", () => {
  it("names more email templates than one statement may bind, in runs", async () => {
    const { adapter, statements } = limitedAdapter();
    const ids = ["t1", "t2", "t3", "t4", "t5", "t6", "t7"];
    const reads = ids.map(documentId => ({
      kind: "email-template" as const,
      slug: "",
      documentId,
      locale: null,
      paths: ["html"],
    }));

    const headings = await bootedMediaUsesSource(adapter, {
      user: { id: "u1" },
    } as never).headings(reads);

    expect(statements.every(bound => bound <= LIMIT)).toBe(true);
    expect(statements.length).toBeGreaterThan(1);
    expect(reads.map(read => headings.get(mediaUseReadKey(read)))).toEqual(
      ids.map(id => ({
        title: `Template ${id}`,
        owner: "Email templates",
        paths: new Set(["html"]),
      }))
    );
  });
});
