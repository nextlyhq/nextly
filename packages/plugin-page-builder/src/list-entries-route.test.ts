/**
 * The canvas's read of a list's entries: refused for a collection the caller
 * may not read, before anything is read, and otherwise the public reader's
 * answer; a body no list could build is refused at the boundary.
 */
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

  it("is mounted, authenticated, at the path the client asks", () => {
    const route = (pageBuilder().contributes?.routes ?? []).find(
      each => each.path === LIST_ENTRIES_ROUTE_PATH
    );
    expect(route?.method).toBe("POST");
    expect(route?.public).not.toBe(true);
  });
});
