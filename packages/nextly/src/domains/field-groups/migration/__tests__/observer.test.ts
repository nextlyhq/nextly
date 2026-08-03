import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { describe, expect, it, vi } from "vitest";

import { NextlyError } from "../../../../errors/nextly-error";
import { identifierCaseRules } from "../../../schema/utils/resolve-catalog-name";

vi.mock("../../../schema/pipeline/diff/introspect-live", () => ({
  introspectLiveSnapshot: vi.fn(),
}));

import { introspectLiveSnapshot } from "../../../schema/pipeline/diff/introspect-live";
import {
  createStorageObserver,
  findLostIndexes,
  refuseLostIndexes,
} from "../observer";
import type { MigrationSession } from "../session";

const PRESERVING = identifierCaseRules({ dialect: "postgresql" });

// 🔴 This runs once per rename, and `introspectLiveSnapshot` costs per table it
// is handed — on SQLite three PRAGMAs each. Handing it the whole catalog makes
// the migration scale with the size of the USER'S database rather than with the
// number of field groups, which is the wrong variable entirely.
describe("dataTables introspects only what it may address", () => {
  function observerOver(tables: string[]) {
    const adapter = {
      getCapabilities: () => ({ dialect: "postgresql" }),
      getDrizzle: () => ({}),
      listTables: () => Promise.resolve(tables),
    } as unknown as DrizzleAdapter;
    // Cleared per fixture: these assertions are about which names reach the
    // introspection, so calls left over from another test would answer for it.
    vi.mocked(introspectLiveSnapshot).mockReset();
    vi.mocked(introspectLiveSnapshot).mockImplementation((_db, _d, names) =>
      Promise.resolve({
        tables: names.map(name => ({
          name,
          columns: [
            { name: "id", type: "text", nullable: false },
            { name: "_parent_table", type: "text", nullable: false },
          ],
        })),
      })
    );
    return createStorageObserver(adapter, PRESERVING);
  }

  const session = {} as MigrationSession;

  it("passes only the owned names the catalog holds", async () => {
    const observer = observerOver([
      "comp_hero",
      "app_orders",
      "app_invoices",
      "dc_pages",
    ]);
    await observer.dataTables(session, ["comp_hero", "fg_hero"]);

    // `fg_hero` is owned but not yet present; the host's tables are present but
    // not owned. Neither may be introspected.
    expect(vi.mocked(introspectLiveSnapshot).mock.calls[0]?.[2]).toEqual([
      "comp_hero",
    ]);
  });

  it("does not introspect at all when nothing owned is present", async () => {
    const observer = observerOver(["app_orders", "app_invoices"]);
    const result = await observer.dataTables(session, ["comp_hero"]);

    expect(result).toEqual([]);
    expect(vi.mocked(introspectLiveSnapshot)).not.toHaveBeenCalled();
  });
});

describe("findLostIndexes", () => {
  // Renaming a table keeps its indexes on all three dialects, so a name missing
  // afterwards means one was dropped rather than moved.
  it("names an index the rename did not carry", () => {
    expect(findLostIndexes(["idx_a", "idx_b"], ["idx_a"])).toEqual({
      comparable: true,
      lost: ["idx_b"],
    });
  });

  it("reports nothing lost when every name survived", () => {
    expect(findLostIndexes(["idx_a"], ["idx_a", "idx_new"])).toEqual({
      comparable: true,
      lost: [],
    });
  });

  // The reason this compares names rather than counts: a count survives losing
  // one index and gaining another, which is exactly the shape being checked for.
  it("catches a loss that leaves the count unchanged", () => {
    const result = findLostIndexes(["idx_a", "idx_b"], ["idx_a", "idx_other"]);
    expect(result).toEqual({ comparable: true, lost: ["idx_b"] });
  });

  // `undefined` means the snapshot tracked no index data, which is not the same
  // as a table having none. Reading it as an empty list would report every index
  // intact on a snapshot that never held any.
  it.each([
    ["the source was not observed", undefined, ["idx_a"]],
    ["the target was not observed", ["idx_a"], undefined],
    ["neither was observed", undefined, undefined],
  ])("reports %s as not comparable", (_label, before, after) => {
    expect(findLostIndexes(before, after)).toEqual({ comparable: false });
  });

  // A table that genuinely has no indexes is comparable and loses nothing;
  // conflating this with the untracked case is the mistake the type prevents.
  it("treats an empty list as tracked and complete", () => {
    expect(findLostIndexes([], [])).toEqual({ comparable: true, lost: [] });
  });
});

describe("refuseLostIndexes", () => {
  it("names the table and every index that went missing", () => {
    const error = refuseLostIndexes({ table: "fg_hero", lost: ["idx_b"] });
    expect(NextlyError.is(error)).toBe(true);
    expect(error.logContext?.reason).toMatch(
      /did not carry the table's indexes/
    );
    expect(error.logContext?.table).toBe("fg_hero");
    expect(error.logContext?.lost).toEqual(["idx_b"]);
  });
});
