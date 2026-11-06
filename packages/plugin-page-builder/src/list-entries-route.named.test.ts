/**
 * The canvas's run of a list's named query, through the list entries route:
 * made over the ONE base reader the route is given, as the published page
 * makes it, with who may read what left to that reader, and answered as the
 * list envelope with the query's own count, the reads it made, and a failure
 * as the run judged and logged it.
 */
import {
  defineNamedQuery,
  param,
  type NamedQueryDefinition,
} from "@nextlyhq/blocks-engine";
import type { ListBaseReader, NamedQueryFailure } from "@nextlyhq/blocks-react";
import { describe, expect, it, vi } from "vitest";

import {
  readNamedListEntries,
  type NamedListEntriesReads,
} from "./list-entries-route";

const SENTINEL = "internal-note-sentinel";

const upcoming: NamedQueryDefinition = defineNamedQuery({
  name: "events.upcoming",
  label: "Upcoming events",
  params: { city: param.text({ label: "City", required: true }) },
  reads: { collections: ["events", "venues"] },
  rows: {
    key: "id",
    fields: [
      { name: "id", type: "text" },
      { name: "title", type: "text" },
    ],
  },
  total: true,
  async run({ params, window, reader }) {
    const found = await reader.find({
      collection: "events",
      filters: [{ field: "city", op: "equals", value: params.city }],
      limit: window.limit,
      offset: window.offset,
    });
    await reader.count({ collection: "venues" });
    return { total: 12, rows: found.items };
  },
});

/** A base reader over fixture rows, recording what it was asked. */
function base(): ListBaseReader & { asked: unknown[] } {
  const asked: unknown[] = [];
  return {
    asked,
    find: query => {
      asked.push(query);
      return Promise.resolve({
        items: [
          { id: "e1", title: "One", internalNote: SENTINEL },
          { id: "e2", title: "Two", internalNote: SENTINEL },
        ],
        meta: { total: 2 },
      });
    },
    count: query => {
      asked.push(query);
      return Promise.resolve(3);
    },
  };
}

function reads(
  overrides: Partial<NamedListEntriesReads> = {}
): NamedListEntriesReads & {
  readonly reader: ReturnType<typeof base>;
  readonly failures: NamedQueryFailure[];
} {
  const reader = base();
  const failures: NamedQueryFailure[] = [];
  return {
    reader,
    failures,
    definitionOf: name => (name === upcoming.name ? upcoming : undefined),
    baseReader: () => Promise.resolve(reader),
    fieldsOf: () => Promise.resolve(undefined),
    today: () => Promise.resolve("2026-11-06"),
    report: failure => failures.push(failure),
    ...overrides,
  };
}

const asked = (params: Record<string, string> = { city: "lahore" }) => ({
  named: { name: "events.upcoming", params, limit: 6, offset: 0 },
});

describe("a named run on the canvas", () => {
  it("fails the run, in the refusal's own words, where the caller may not read what it reads", async () => {
    // Core's gate refuses inside the base reader, as for a list's own read:
    // the route makes no second check of its own.
    const refusing = base();
    const made = reads({
      baseReader: () =>
        Promise.resolve({
          ...refusing,
          count: () =>
            Promise.reject(
              Object.assign(new Error("Forbidden"), {
                code: "FORBIDDEN",
                statusCode: 403,
                publicMessage: "You don't have permission to read venues.",
              })
            ),
        }),
    });
    const answer = await readNamedListEntries(asked(), made);
    expect(answer.items).toEqual([]);
    expect(answer.meta.named.failure).toMatchObject({
      code: "threw",
      detail: "You don't have permission to read venues.",
    });
  });

  it("answers its rows projected to what it declares, its count, and the reads it made", async () => {
    const made = reads();
    const answer = await readNamedListEntries(asked(), made);
    expect(answer.items).toEqual([
      { id: "e1", title: "One" },
      { id: "e2", title: "Two" },
    ]);
    expect(JSON.stringify(answer)).not.toContain(SENTINEL);
    expect(answer.meta).toMatchObject({
      total: 12,
      // Its find and count, and the settings read today is resolved from.
      named: { counted: true, reads: 3 },
    });
    // Through the one base reader it was given, with the list's window.
    expect(made.reader.asked).toContainEqual(
      expect.objectContaining({ collection: "events", limit: 6, offset: 0 })
    );
  });

  it("answers a failed run with the failure as the run judged it, logged under the same reference", async () => {
    const made = reads({
      definitionOf: name =>
        name === upcoming.name
          ? {
              ...upcoming,
              run: () => Promise.reject(new Error("ECONNREFUSED token=abc")),
            }
          : undefined,
    });
    const answer = await readNamedListEntries(asked(), made);
    expect(answer.items).toEqual([]);
    const failure = answer.meta.named.failure;
    expect(failure?.code).toBe("threw");
    expect(failure?.ref).toMatch(/^NQ-[0-9A-F]{6}$/);
    expect(failure?.detail).toBe(
      `Upcoming events stopped with an error. Ask your developer, quoting ref ${failure?.ref ?? "?"}.`
    );
    expect(JSON.stringify(answer)).not.toContain("token=abc");
    // The log's reference is the one the canvas is handed.
    expect(made.failures.map(each => each.ref)).toEqual([failure?.ref]);
  });

  it("charges resolving today against the draw's allowance, before the query reads", async () => {
    // Two left: today takes one, the query's find the other, its count none.
    const answer = await readNamedListEntries(
      { named: { ...asked().named, allowance: 2 } },
      reads()
    );
    expect(answer.meta.named).toMatchObject({
      reads: 2,
      failure: { code: "budget" },
    });
  });

  it("spends no more reads than the canvas's draw has left", async () => {
    // The query reads twice and today once; the draw has one read left.
    const answer = await readNamedListEntries(
      { named: { ...asked().named, allowance: 1 } },
      reads()
    );
    expect(answer.items).toEqual([]);
    expect(answer.meta.named).toMatchObject({
      reads: 1,
      failure: { code: "budget" },
    });
  });

  it("judges its inputs as the save does, never running a query that lacks one", async () => {
    const run = vi.fn(() => Promise.resolve({ rows: [] }));
    const made = reads({ definitionOf: () => ({ ...upcoming, run }) });
    const answer = await readNamedListEntries(asked({}), made);
    expect(run).not.toHaveBeenCalled();
    expect(answer.meta.named.failure).toMatchObject({ code: "params" });
  });

  it("says a query this site does not register is not set up", async () => {
    const answer = await readNamedListEntries(
      { named: { name: "events.gone", limit: 6, offset: 0 } },
      reads()
    );
    expect(answer.meta.named.failure).toMatchObject({ code: "unknown" });
  });
});
