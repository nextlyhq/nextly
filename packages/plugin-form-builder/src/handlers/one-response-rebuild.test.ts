/**
 * The one-response version a form save leaves, decided from what is stored:
 * moved on by a change of mode or Email field and by nothing else, never
 * taken from the payload, with the keys behind it until the sweep says
 * otherwise; and the version a key was made under, read off the key.
 */
import { describe, expect, it, vi } from "vitest";

import { keysBehind, keyVersionOf, responseKeyOf } from "./one-response";
import {
  type RebuildDeps,
  rebuildResponseKeys,
  stampOneResponseVersion,
} from "./one-response-rebuild";

const FORM_KEYED = Symbol.for("nextly.plugin-form-builder.form-keyed");

/**
 * Stamp a save of `settings` over `stored`, and answer the settings saved.
 * `fits`: whether the form is small enough for the save to key it.
 */
async function save(
  settings: Record<string, unknown> | undefined,
  stored?: Record<string, unknown>,
  finished?: number,
  fits = false
): Promise<Record<string, unknown> | undefined> {
  const data: Record<string | symbol, unknown> =
    settings === undefined ? { name: "Meetup" } : { settings };
  if (finished !== undefined) data[FORM_KEYED] = { version: finished };
  await stampOneResponseVersion(
    {
      operation: stored === undefined ? "create" : "update",
      data,
      originalData:
        stored === undefined ? undefined : { id: "f1", settings: stored },
    },
    async () => fits
  );
  return data.settings as Record<string, unknown> | undefined;
}

describe("the version a form save leaves", () => {
  it("starts a new form at version 0, whatever the payload says", async () => {
    expect(
      await save({
        oneResponse: "email",
        oneResponseVersion: 9,
        oneResponseKeyedVersion: 3,
      })
    ).toEqual({ oneResponse: "email", oneResponseVersion: 0 });
  });

  it("keeps the stored version through a save that changes nothing it compares", async () => {
    const stored = {
      oneResponse: "ip",
      oneResponseVersion: 2,
      oneResponseKeyedVersion: 2,
    };
    expect(
      await save(
        {
          oneResponse: "ip",
          submitButtonText: "Go",
          oneResponseVersion: 99,
          oneResponseKeyedVersion: 99,
        },
        stored
      )
    ).toMatchObject({ oneResponseVersion: 2, oneResponseKeyedVersion: 2 });
  });

  it("moves on and leaves keys behind when the mode changes to one that compares earlier answers", async () => {
    expect(
      await save(
        { oneResponse: "email", oneResponseField: "email" },
        { oneResponse: "off" }
      )
    ).toMatchObject({ oneResponseVersion: 1, oneResponseKeyedVersion: 0 });
    expect(
      await save(
        { oneResponse: "ip" },
        {
          oneResponse: "email",
          oneResponseField: "email",
          oneResponseVersion: 4,
          oneResponseKeyedVersion: 3,
        }
      )
    ).toMatchObject({ oneResponseVersion: 5, oneResponseKeyedVersion: 3 });
  });

  it("moves on when one per email reads another field", async () => {
    expect(
      await save(
        { oneResponse: "email", oneResponseField: "work" },
        {
          oneResponse: "email",
          oneResponseField: "email",
          oneResponseVersion: 1,
          oneResponseKeyedVersion: 1,
        }
      )
    ).toMatchObject({ oneResponseVersion: 2, oneResponseKeyedVersion: 1 });
  });

  it("is up to date at once when the save itself keys the earlier submissions", async () => {
    expect(
      await save(
        { oneResponse: "email", oneResponseField: "email" },
        { oneResponse: "off" },
        undefined,
        true
      )
    ).toMatchObject({ oneResponseVersion: 1, oneResponseKeyedVersion: 1 });
  });

  it("is up to date at once for a mode that compares nothing stored", async () => {
    for (const oneResponse of ["off", "browser"]) {
      expect(
        await save(
          { oneResponse },
          {
            oneResponse: "ip",
            oneResponseVersion: 1,
            oneResponseKeyedVersion: 1,
          }
        )
      ).toMatchObject({ oneResponseVersion: 2, oneResponseKeyedVersion: 2 });
    }
  });

  it("takes the keys as made only from the sweep's own write, for the current version", async () => {
    const stored = {
      oneResponse: "email",
      oneResponseField: "email",
      oneResponseVersion: 3,
      oneResponseKeyedVersion: 2,
    };
    const same = { oneResponse: "email", oneResponseField: "email" };
    expect(await save(same, stored, 3)).toMatchObject({
      oneResponseKeyedVersion: 3,
    });
    // A sweep finishing a version the form has left changes nothing.
    expect(await save(same, stored, 2)).toMatchObject({
      oneResponseKeyedVersion: 2,
    });
    expect(await save(same, stored)).toMatchObject({
      oneResponseKeyedVersion: 2,
    });
  });

  it("leaves a save that does not write settings alone", async () => {
    expect(await save(undefined, { oneResponse: "ip" })).toBeUndefined();
  });
});

describe("a key's version", () => {
  const digests = () => ({
    digest: async (purpose: string, value: string) => `${purpose}-${value}`,
    prepare: async () => undefined,
  });

  it("is written on the key from version 1, and absent at version 0", async () => {
    const ip = { ipAddress: "203.0.113.9" };
    const v0 = await responseKeyOf(digests, { oneResponse: "ip" }, ip);
    const v3 = await responseKeyOf(
      digests,
      { oneResponse: "ip", oneResponseVersion: 3 },
      ip
    );
    expect(v0).toBe("ip-203.0.113.9");
    expect(v3).toBe("v3:ip-203.0.113.9");
    expect(keyVersionOf(v0!)).toBe(0);
    expect(keyVersionOf(v3!)).toBe(3);
    expect(
      await responseKeyOf(
        digests,
        { oneResponse: "browser", oneResponseVersion: 2 },
        { browserToken: "t".repeat(20) }
      )
    ).toBe(`v2:browser:browser-${"t".repeat(20)}`);
  });

  it("is behind only when the keys were made for an earlier version", async () => {
    expect(
      keysBehind({ oneResponseVersion: 2, oneResponseKeyedVersion: 1 })
    ).toBe(true);
    expect(
      keysBehind({ oneResponseVersion: 2, oneResponseKeyedVersion: 2 })
    ).toBe(false);
    // Saved before the keyed version was recorded: up to date.
    expect(keysBehind({ oneResponseVersion: 0 })).toBe(false);
  });
});

/** Fake services over `rows`: a list that pages by id as the store does. */
function fakeDeps(
  rows: Record<string, unknown>[],
  settings: Record<string, unknown>,
  /** Run once, after the first page of submissions is read. */
  afterFirstPage?: () => void
) {
  let pagesRead = 0;
  const listEntries = vi.fn(
    async (
      slug: string,
      options: {
        where?: { id?: { greater_than?: string } };
        pagination?: { page?: number };
      }
    ) => {
      if (slug === "forms") {
        return { data: [{ id: "f1", _rev: "3", settings }] };
      }
      // By id after a cursor, or by position: both, as the store answers.
      const after = options.where?.id?.greater_than;
      const skip = ((options.pagination?.page ?? 1) - 1) * 100;
      const page = rows
        .filter(row => after === undefined || String(row.id) > after)
        .sort((a, b) => (String(a.id) < String(b.id) ? -1 : 1))
        .slice(skip, skip + 100);
      pagesRead += 1;
      if (pagesRead === 1) afterFirstPage?.();
      return { data: page };
    }
  );
  const count = vi.fn(async () => 0);
  const updateEntry = vi.fn(async () => ({}));
  const deps = {
    collections: { listEntries, count, updateEntry },
    digests: () => ({
      digest: async (purpose: string, value: string) => `${purpose}-${value}`,
      prepare: async () => undefined,
    }),
    formsSlug: "forms",
    submissionsSlug: "form-submissions",
  } as unknown as RebuildDeps;
  return { deps, listEntries, count, updateEntry };
}

const behind = {
  oneResponse: "ip",
  oneResponseVersion: 2,
  oneResponseKeyedVersion: 1,
};
const later = () => new Date(Date.now() + 60_000);
/** A stored submission from its own address, `n` seconds into the day. */
const row = (n: number, responseKey?: string) => ({
  id: `s${String(n).padStart(4, "0")}`,
  _rev: "1",
  createdAt: new Date(Date.UTC(2026, 10, 1, 0, 0, n)).toISOString(),
  ipAddress: `198.51.100.${n % 250}-${n}`,
  ...(responseKey === undefined ? {} : { responseKey }),
});

describe("a sweep over a form's earlier submissions", () => {
  it("asks nothing about rows holding their own key, and finishes in one pass", async () => {
    const rows = [1, 2].map(n => {
      const each = row(n);
      return { ...each, responseKey: `v2:ip-${each.ipAddress}` };
    });
    const { deps, count, updateEntry, listEntries } = fakeDeps(rows, behind);

    await rebuildResponseKeys(deps, later());

    // No question per row, and no counts.
    expect(count).not.toHaveBeenCalled();
    expect(
      listEntries.mock.calls.filter(([slug]) => slug === "form-submissions")
    ).toHaveLength(1);
    // Nothing to write to the rows; the form is recorded as up to date.
    expect(updateEntry).toHaveBeenCalledTimes(1);
    expect(updateEntry.mock.calls[0]?.[0]).toBe("forms");
  });

  it("keys every row although others are deleted and restored while it reads", async () => {
    // Two pages of keyless rows. After the first page is read, a row on it
    // is deleted and a spam row restored: a page by position would skip one.
    const rows = Array.from({ length: 201 }, (_, n) => row(n + 1));
    const { deps, updateEntry } = fakeDeps(rows, behind, () => {
      rows.splice(4, 1);
      rows.push(row(500));
    });

    await rebuildResponseKeys(deps, later());

    const keyed = new Set(
      updateEntry.mock.calls
        .filter(([slug]) => slug === "form-submissions")
        .map(([, id]) => id)
    );
    // Every row there before the reads began and still there is keyed.
    for (const each of rows.filter(r => r.id !== "s0500")) {
      expect(keyed.has(each.id)).toBe(true);
    }
  });
});
