/**
 * Version pin holders are registered, and a pin's slot is keyed by document,
 * holder and slot.
 */
import type { TransactionContext } from "@nextlyhq/adapter-drizzle/types";
import { beforeEach, describe, expect, it } from "vitest";

import type {
  VersionsDbApi,
  VersionsSelectOptions,
  VersionsWhere,
} from "../db-api";
import {
  registerNamespacedVersionPinHolder,
  registerVersionPinHolder,
  resetVersionPinHolders,
  versionPinHolderNames,
  versionPinKey,
  versionPins,
} from "../version-pins";

beforeEach(() => {
  resetVersionPinHolders();
  registerVersionPinHolder({ name: "workflows", label: "Workflows" });
});

const ref = {
  scopeKind: "collection" as const,
  scopeSlug: "posts",
  entryId: "e1",
};

describe("version pin holders", () => {
  it("hands a feature the handle it pins through when it registers", () => {
    const handle = registerVersionPinHolder({
      name: "release-review",
      label: "Releases",
    });
    expect(versionPinHolderNames()).toContain("release-review");
    expect(typeof handle.pin).toBe("function");
    expect(typeof handle.release).toBe("function");
    expect(typeof handle.releaseAll).toBe("function");
  });

  it("offers no way to reach a holder's handle by its name", () => {
    expect(Object.keys(versionPins)).toEqual(["list"]);
  });

  it("refuses a name taken already, naming the feature that holds it", () => {
    expect(() =>
      registerVersionPinHolder({ name: "workflows", label: "Mine" })
    ).toThrow(/Workflows/);
  });

  it("returns the same handle for the same registration, as a reloaded module makes it", () => {
    const first = registerVersionPinHolder({
      name: "release-review",
      label: "Releases",
    });
    expect(
      registerVersionPinHolder({ name: "release-review", label: "Releases" })
    ).toBe(first);
    expect(
      versionPinHolderNames().filter(name => name === "release-review")
    ).toHaveLength(1);
  });

  it("refuses a name that is not kebab-case or too long", () => {
    for (const name of ["Workflows", "work_flows", "", "-x", "a".repeat(65)]) {
      expect(() => registerVersionPinHolder({ name, label: "x" })).toThrow();
    }
  });

  // Refused before any database work: the stub transaction throws on any use,
  // so a refusal that reached the database would fail with its message.
  const noDatabase = new Proxy(
    {},
    {
      get() {
        throw new Error("no database work expected");
      },
    }
  ) as TransactionContext;

  it("refuses a slot that is empty or too long for its column", async () => {
    const handle = registerVersionPinHolder({ name: "slots", label: "Slots" });
    for (const slot of ["", "x".repeat(192)]) {
      await expect(
        handle.pin(noDatabase, { ref, slot, versionNo: 1 })
      ).rejects.toMatchObject({ code: "INVALID_INPUT" });
      await expect(
        handle.release(noDatabase, { ref, slot })
      ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    }
  });

  it("refuses a version number that is not a positive integer", async () => {
    const handle = registerVersionPinHolder({
      name: "numbers",
      label: "Numbers",
    });
    for (const versionNo of [0, -1, 1.5, Number.NaN]) {
      await expect(
        handle.pin(noDatabase, { ref, slot: "approved", versionNo })
      ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    }
  });
});

type PinRow = {
  scopeKind: string;
  scopeSlug: string;
  entryId: string;
  holder: string;
  slot: string;
  versionNo: number;
};

const columnOf = (row: PinRow, column: string): unknown =>
  (row as unknown as Record<string, unknown>)[column];

/** Answer a read as a database does: by its where clause and its columns. */
function databaseOf(rows: PinRow[]): {
  db: VersionsDbApi;
  rowsRead: () => PinRow[];
} {
  const answered: PinRow[] = [];
  const matches = (row: PinRow, where: VersionsWhere | undefined): boolean =>
    (where?.and ?? []).every(part =>
      "column" in part
        ? columnOf(row, part.column) === part.value
        : matches(row, part)
    );
  // Only `select`: a read is all a holder's listing does, and a write through
  // this handle would be a test passing for the wrong reason.
  const db = {
    select<T>(_table: string, options?: VersionsSelectOptions): Promise<T[]> {
      const found = rows.filter(row => matches(row, options?.where));
      answered.push(...found);
      return Promise.resolve(
        found.map(row =>
          Object.fromEntries(
            (options?.columns ?? Object.keys(row)).map(column => [
              column,
              columnOf(row, column),
            ])
          )
        ) as T[]
      );
    },
  } as unknown as VersionsDbApi;
  return { db, rowsRead: () => answered };
}

describe("a holder's slots on a document", () => {
  const rows: PinRow[] = [
    { ...ref, holder: "workflows", slot: "approved", versionNo: 9 },
    { ...ref, holder: "release-review", slot: "approved", versionNo: 3 },
    { ...ref, holder: "release-review", slot: "in-review", versionNo: 4 },
    {
      ...ref,
      holder: "acme-billing.approvals",
      slot: "approved",
      versionNo: 7,
    },
    {
      ...ref,
      entryId: "other",
      holder: "release-review",
      slot: "approved",
      versionNo: 5,
    },
  ];

  it("reads the holder's own rows, and no other holder's", async () => {
    const handle = registerVersionPinHolder({
      name: "release-review",
      label: "Releases",
    });
    const { db, rowsRead } = databaseOf(rows);

    expect(await handle.list(db, ref)).toEqual([
      { slot: "approved", versionNo: 3 },
      { slot: "in-review", versionNo: 4 },
    ]);
    // The holder is a predicate of the query, not a filter on its answer, so
    // what another holder pins never leaves the database however much it is.
    expect(rowsRead().map(row => row.holder)).toEqual([
      "release-review",
      "release-review",
    ]);
  });

  it("reads only this document's rows", async () => {
    const handle = registerVersionPinHolder({
      name: "release-review",
      label: "Releases",
    });
    const { db, rowsRead } = databaseOf(rows);

    await handle.list(db, { ...ref, entryId: "other" });

    expect(rowsRead()).toEqual([
      {
        ...ref,
        entryId: "other",
        holder: "release-review",
        slot: "approved",
        versionNo: 5,
      },
    ]);
  });

  it("is the one way to read a holder's slots: there is no lookup by name", () => {
    const handle = registerVersionPinHolder({
      name: "release-review",
      label: "Releases",
    });
    expect(typeof handle.list).toBe("function");
    expect(Object.keys(versionPins)).toEqual(["list"]);
  });
});

describe("versionPinKey", () => {
  it("is one key per document, holder and slot", () => {
    const key = versionPinKey(ref, "workflows", "approved:en");
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(versionPinKey(ref, "workflows", "approved:en")).toBe(key);
    expect(versionPinKey(ref, "workflows", "approved:de")).not.toBe(key);
    expect(versionPinKey(ref, "release-review", "approved:en")).not.toBe(key);
    expect(
      versionPinKey({ ...ref, entryId: "e2" }, "workflows", "approved:en")
    ).not.toBe(key);
  });

  it("does not let a separator in one part pass for another", () => {
    // "a:b" + "c" and "a" + "b:c" join to the same text without escaping.
    expect(versionPinKey(ref, "a", "b:c")).not.toBe(
      versionPinKey({ ...ref, entryId: "e1:a" }, "b", "c")
    );
  });
});

describe("a holder in a plugin's namespace", () => {
  it("is recorded as the plugin's slug, a dot, and its name", () => {
    const { recorded } = registerNamespacedVersionPinHolder("acme-billing", {
      name: "approvals",
      label: "Approvals",
    });
    expect(recorded).toBe("acme-billing.approvals");
    expect(versionPinHolderNames()).toContain("acme-billing.approvals");
  });

  it("holds apart from another plugin's holder, and from core's, of one name", () => {
    const a = registerNamespacedVersionPinHolder("acme-a", {
      name: "workflows",
      label: "A",
    });
    const b = registerNamespacedVersionPinHolder("acme-b", {
      name: "workflows",
      label: "B",
    });
    expect([a.recorded, b.recorded]).toEqual([
      "acme-a.workflows",
      "acme-b.workflows",
    ]);
    expect(a.handle).not.toBe(b.handle);
    expect(versionPinHolderNames()).toContain("workflows");
  });

  it("is a name core's own registration refuses, so core cannot take it", () => {
    expect(() =>
      registerVersionPinHolder({ name: "acme-billing.approvals", label: "X" })
    ).toThrow(/kebab-case/);
  });

  it("refuses a name that is not kebab-case, and one too long with the slug", () => {
    expect(() =>
      registerNamespacedVersionPinHolder("acme", {
        name: "Approvals",
        label: "A",
      })
    ).toThrow(/kebab-case/);
    expect(() =>
      registerNamespacedVersionPinHolder("acme", { name: "a.b", label: "A" })
    ).toThrow(/kebab-case/);
    expect(() =>
      registerNamespacedVersionPinHolder("a".repeat(40), {
        name: "b".repeat(30),
        label: "A",
      })
    ).toThrow(/at most 64 characters/);
  });
});
