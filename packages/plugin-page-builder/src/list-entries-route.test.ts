/**
 * The canvas's read of a list's entries: refused for a collection the caller
 * may not read, before anything is read, and otherwise the public reader's
 * answer; a body no list could build is refused at the boundary.
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
  it("reads as the public, for a collection the caller may read", async () => {
    const publicFind = vi.fn(async () => ANSWER);
    const query = {
      collection: "posts",
      filters: [{ field: "title", op: "contains" as const, value: "build" }],
      sort: "-publishedAt",
      limit: 6,
    };
    const answer = await readListEntries(
      { query },
      { mayRead: async slug => slug === "posts", publicFind }
    );
    expect(answer).toBe(ANSWER);
    expect(publicFind).toHaveBeenCalledWith(query);
  });

  it("refuses a collection the caller may not read, reading nothing", async () => {
    const publicFind = vi.fn(async () => ANSWER);
    const refused = readListEntries(
      { query: { collection: "orders" } },
      { mayRead: async () => false, publicFind }
    );
    await expect(refused).rejects.toSatisfy(error =>
      NextlyError.isCode(error, "FORBIDDEN")
    );
    expect(publicFind).not.toHaveBeenCalled();
  });

  it("tells the editor visitors are refused, never that its author must sign in", async () => {
    const refused = await readListEntries(
      { query: { collection: "posts" } },
      {
        mayRead: async () => true,
        publicFind: async () => {
          throw NextlyError.authRequired();
        },
      }
    ).catch((error: unknown) => error);
    expect(NextlyError.isForbidden(refused)).toBe(true);
    expect((refused as NextlyError).statusCode).toBe(403);
    expect((refused as NextlyError).publicMessage).toBe(
      "Visitors can't read posts, so a published list of it shows nothing."
    );
    // Any other failure travels as it was, so a refused sort still falls back.
    const sort = NextlyError.validation({
      errors: [{ path: "sort.x", code: "FIELD_NOT_SORTABLE", message: "No." }],
    });
    await expect(
      readListEntries(
        { query: { collection: "posts" } },
        {
          mayRead: async () => true,
          publicFind: async () => Promise.reject(sort),
        }
      )
    ).rejects.toBe(sort);
  });

  it("refuses a body no list could build, before the caller is asked", async () => {
    const can = vi.fn(async () => true);
    const ctx = { caller: { can } } as unknown as PluginRouteContext;
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
        listEntriesRoute().handler(request(body), ctx)
      ).rejects.toSatisfy(error =>
        NextlyError.isCode(error, "VALIDATION_ERROR")
      );
    }
    expect(can).not.toHaveBeenCalled();
  });

  it("takes any sort a list may store, and nothing past its bounds", async () => {
    const can = vi.fn(async () => false);
    const ctx = { caller: { can } } as unknown as PluginRouteContext;
    const request = (sort: unknown) =>
      new Request(`http://nextly.test/x${LIST_ENTRIES_ROUTE_PATH}`, {
        method: "POST",
        body: JSON.stringify({ query: { collection: "posts", sort } }),
      });
    // The longest sort a list stores, every key naming a 63-character
    // column, reaches the reader, here refused only by the caller check.
    const keys = Array.from(
      { length: LIST_MAX_SORT_KEYS },
      (_, index) => `-${"f".repeat(61)}${String(index).padStart(2, "0")}`
    );
    expect(keys.join(",").length).toBeGreaterThan(1000);
    for (const sort of [keys.join(","), keys]) {
      await expect(
        listEntriesRoute().handler(request(sort), ctx)
      ).rejects.toSatisfy(error => NextlyError.isCode(error, "FORBIDDEN"));
    }
    expect(can).toHaveBeenCalledTimes(2);
    // A sort no list could store is refused before the caller is asked:
    // one malformed, and ones past the bounds a stored sort is held to,
    // which are checked before the sort is read at all.
    can.mockClear();
    const join = vi.spyOn(Array.prototype, "join");
    const pastBounds = [
      [...keys, "title"],
      " ".repeat(LIST_MAX_SORT_LENGTH + 1),
      Array.from({ length: 100_000 }, () => ""),
      [`a${" ".repeat(LIST_MAX_SORT_LENGTH)}`],
    ];
    for (const sort of pastBounds) {
      await expect(
        listEntriesRoute().handler(request(sort), ctx)
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
        listEntriesRoute().handler(request(sort), ctx)
      ).rejects.toSatisfy(error =>
        NextlyError.isCode(error, "VALIDATION_ERROR")
      );
    }
    expect(can).not.toHaveBeenCalled();
  });

  it("is mounted, authenticated, at the path the client asks", () => {
    const route = (pageBuilder().contributes?.routes ?? []).find(
      each => each.path === LIST_ENTRIES_ROUTE_PATH
    );
    expect(route?.method).toBe("POST");
    expect(route?.public).not.toBe(true);
  });
});
