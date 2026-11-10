/**
 * The canvas's read of a list's entries: the editor reader's answer, read as
 * the caller, whose refusals (core's, for a collection the caller may not
 * read) travel unchanged; a body no list could build is refused at the
 * boundary.
 */
import {
  LIST_MAX_SORT_KEYS,
  LIST_MAX_SORT_LENGTH,
} from "@nextlyhq/blocks-engine";
import { NextlyError, type PluginRouteContext } from "@nextlyhq/plugin-sdk";
import { describe, expect, it, vi } from "vitest";

import { LIST_ENTRIES_ROUTE_PATH } from "./list-entries-contract";
import { listEntriesRoute, readListEntries } from "./list-entries-route";
import { pageBuilder } from "./plugin";

const ANSWER = {
  items: [{ id: "p1", title: "One" }],
  meta: {
    total: 1,
    page: 1,
    limit: 10,
    totalPages: 1,
    hasNext: false,
    hasPrev: false,
  },
};

describe("a canvas list's read", () => {
  it("reads as the caller, for a collection the caller may read", async () => {
    const find = vi.fn(async () => ANSWER);
    const query = {
      collection: "posts",
      filters: [{ field: "title", op: "contains" as const, value: "build" }],
      sort: "-publishedAt",
      limit: 6,
    };
    const answer = await readListEntries({ query }, { find });
    expect(answer).toBe(ANSWER);
    expect(find).toHaveBeenCalledWith(query);
  });

  it("passes the reader's own refusals to the editor unchanged", async () => {
    // A refused sort travels as it was, so the canvas falls back as the
    // published page does; so does core's refusal of a collection the caller
    // may not read, the one door that decides it.
    for (const failure of [
      NextlyError.validation({
        errors: [
          { path: "sort.x", code: "FIELD_NOT_SORTABLE", message: "No." },
        ],
      }),
      NextlyError.forbidden(),
    ]) {
      await expect(
        readListEntries(
          { query: { collection: "posts" } },
          { find: async () => Promise.reject(failure) }
        )
      ).rejects.toBe(failure);
    }
  });

  it("is declared authenticated and never stored", () => {
    const route = listEntriesRoute();
    expect(route).not.toHaveProperty("public");
    expect(route.noStore).toBe(true);
  });

  it("refuses a body no list could build, before anything is read", async () => {
    const ctx = { caller: null } as unknown as PluginRouteContext;
    const request = (body: unknown) =>
      new Request(`http://nextly.test/x${LIST_ENTRIES_ROUTE_PATH}`, {
        method: "POST",
        body: JSON.stringify(body),
      });
    for (const body of [
      {
        query: {
          collection: "posts",
          filters: [{ field: "a.b", op: "equals", value: 1 }],
        },
      },
      {
        query: {
          collection: "posts",
          filters: [{ field: "a", op: "like", value: 1 }],
        },
      },
      { query: { collection: "posts", limit: 500 } },
      { query: { collection: "posts", where: { a: 1 } } },
    ]) {
      await expect(
        listEntriesRoute(() => undefined).handler(request(body), ctx)
      ).rejects.toSatisfy(error =>
        NextlyError.isCode(error, "VALIDATION_ERROR")
      );
    }
  });

  it("refuses a named run whose node id carries a line break or control character", async () => {
    const ctx = { caller: null } as unknown as PluginRouteContext;
    const request = (node: string) =>
      new Request(`http://nextly.test/x${LIST_ENTRIES_ROUTE_PATH}`, {
        method: "POST",
        body: JSON.stringify({
          named: { name: "events.upcoming", limit: 6, offset: 0, node },
        }),
      });
    // The id is written into the server log when the run fails, so a forged
    // second log line or a terminal escape never reaches it.
    for (const node of ["list\nforged line", "list\u001b[31m", "list\u2028"]) {
      await expect(
        listEntriesRoute(() => undefined).handler(request(node), ctx)
      ).rejects.toSatisfy(error =>
        NextlyError.isCode(error, "VALIDATION_ERROR")
      );
    }
    // An ordinary id passes the boundary: whatever happens past it (there is
    // no runtime here), the body is not what is refused.
    const ordinary = await listEntriesRoute(() => undefined)
      .handler(request("list-1"), ctx)
      .then(
        () => undefined,
        (error: unknown) => error
      );
    expect(NextlyError.isCode(ordinary, "VALIDATION_ERROR")).toBe(false);
  });

  it("takes any sort a list may store, and nothing past its bounds", async () => {
    const ctx = { caller: null } as unknown as PluginRouteContext;
    const request = (sort: unknown) =>
      new Request(`http://nextly.test/x${LIST_ENTRIES_ROUTE_PATH}`, {
        method: "POST",
        body: JSON.stringify({ query: { collection: "posts", sort } }),
      });
    // The longest sort a list stores, every key naming a 63-character
    // column, passes the body's check and reaches the reader, which has no
    // instance to read in a unit test: any refusal but the body's.
    const keys = Array.from(
      { length: LIST_MAX_SORT_KEYS },
      (_, index) => `-${"f".repeat(61)}${String(index).padStart(2, "0")}`
    );
    expect(keys.join(",").length).toBeGreaterThan(1000);
    for (const sort of [keys.join(","), keys]) {
      await expect(
        listEntriesRoute(() => undefined).handler(request(sort), ctx)
      ).rejects.toSatisfy(
        error => !NextlyError.isCode(error, "VALIDATION_ERROR")
      );
    }
    // A sort no list could store is refused by the body's check: one
    // malformed, and ones past the bounds a stored sort is held to, which
    // are checked before the sort is read at all.
    const join = vi.spyOn(Array.prototype, "join");
    const pastBounds = [
      [...keys, "title"],
      " ".repeat(LIST_MAX_SORT_LENGTH + 1),
      Array.from({ length: 100_000 }, () => ""),
      [`a${" ".repeat(LIST_MAX_SORT_LENGTH)}`],
    ];
    for (const sort of pastBounds) {
      await expect(
        listEntriesRoute(() => undefined).handler(request(sort), ctx)
      ).rejects.toSatisfy(error =>
        NextlyError.isCode(error, "VALIDATION_ERROR")
      );
    }
    // Nothing past the bounds was joined to be read.
    expect(join.mock.calls.filter(([separator]) => separator === ",")).toEqual(
      []
    );
    join.mockRestore();
    for (const sort of ["-a.b", ["title", "x y"]]) {
      await expect(
        listEntriesRoute(() => undefined).handler(request(sort), ctx)
      ).rejects.toSatisfy(error =>
        NextlyError.isCode(error, "VALIDATION_ERROR")
      );
    }
  });

  it("is mounted, authenticated, at the path the client asks", () => {
    const route = (pageBuilder().contributes?.routes ?? []).find(
      each => each.path === LIST_ENTRIES_ROUTE_PATH
    );
    expect(route?.method).toBe("POST");
    expect(route?.public).not.toBe(true);
  });
});
