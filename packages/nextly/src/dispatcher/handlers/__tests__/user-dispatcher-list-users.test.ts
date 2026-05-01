// Phase 4: pin the listUsers wire shape so the canonical
// `{ items, meta }` body cannot regress. PR #125 fixed the original
// "{ data: { data, meta } }" double-nest bug; Phase 4 finishes the
// migration by switching the wire shape to `{ items, meta }` directly
// (no `data` wrapper).
//
// Pre-Phase-4: dispatchUser('listUsers') returned a plain object that
// the dispatcher infrastructure wrapped in DispatchResult.
// Post-Phase-4: dispatchUser('listUsers') returns a Response built by
// respondList(items, meta). The dispatcher passes the Response through
// (see dispatcher.ts `instanceof Response` branch).

import { describe, expect, it, vi } from "vitest";

import type { ServiceContainer } from "../../../services";
import { dispatchUser } from "../user-dispatcher";

describe("dispatchUser('listUsers')", () => {
  it("returns a Response with { items, meta } body and 200 status", async () => {
    const fakeUsers = [
      { id: "u1", email: "a@example.com" },
      { id: "u2", email: "b@example.com" },
    ];
    // The underlying service returns the legacy { data, meta } shape;
    // the handler translates it to the canonical { items, meta } body.
    const fakeServiceResult = {
      data: fakeUsers,
      meta: { total: 2, page: 1, pageSize: 10, totalPages: 1 },
    };

    const listUsersMock = vi.fn().mockResolvedValue(fakeServiceResult);

    const container = {
      users: { listUsers: listUsersMock },
    } as unknown as ServiceContainer;

    const result = await dispatchUser(
      container,
      "listUsers",
      { page: "1", pageSize: "10" },
      undefined
    );

    expect(result).toBeInstanceOf(Response);
    const response = result as Response;
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/json");

    const body = await response.json();
    expect(body).toEqual({
      items: fakeUsers,
      meta: {
        total: 2,
        page: 1,
        limit: 10,
        totalPages: 1,
        hasNext: false,
        hasPrev: false,
      },
    });

    expect(listUsersMock).toHaveBeenCalledTimes(1);
    expect(listUsersMock.mock.calls[0]?.[0]).toMatchObject({
      page: 1,
      pageSize: 10,
    });
  });

  it("does NOT double-wrap items (regression guard for the user-reported bug)", async () => {
    const fakeUsers = [{ id: "u1", email: "a@example.com" }];
    const fakeServiceResult = {
      data: fakeUsers,
      meta: { total: 1, page: 1, pageSize: 10, totalPages: 1 },
    };

    const container = {
      users: {
        listUsers: vi.fn().mockResolvedValue(fakeServiceResult),
      },
    } as unknown as ServiceContainer;

    const result = await dispatchUser(
      container,
      "listUsers",
      { page: "1", pageSize: "10" },
      undefined
    );

    const body = (await (result as Response).json()) as {
      items: unknown;
      meta?: unknown;
    };

    // The pre-Phase-4 bug shape was result.data === { data: [...], meta: {...} }.
    // Phase 4 flattens to result.items being the user array directly, with
    // no `data` wrapper anywhere.
    expect(Array.isArray(body.items)).toBe(true);
    expect(body).not.toHaveProperty("data");
    expect(body.items).not.toMatchObject({ data: expect.anything() });
  });
});
