// Pins the listUsers dispatcher response shape so the
// "{ data: { data, meta } }" double-nest bug cannot regress.
//
// Bug: UserQueryService.listUsers returned the raw
// `{ data: MinimalUser[], meta }` shape; the dispatcher's smart
// extraction path only fires when the result has `statusCode` or
// `status`, so the fallback wrapped the whole object as `data`.
// End-user impact: /admin/api/users returned `{ data: { data: [...],
// meta: {...} } }` and the admin Users page rendered nothing.
//
// Fix verified here: the dispatcher delegates to a wrapper that
// returns `{ statusCode, data, meta }`, which the framework's
// smart-extraction path unwraps cleanly into `{ data, meta }`.

import { describe, expect, it, vi } from "vitest";

import type { ServiceContainer } from "../../../services";
import { dispatchUser } from "../user-dispatcher";

describe("dispatchUser('listUsers')", () => {
  it("returns { statusCode, data, meta } so the framework single-wraps the response", async () => {
    const fakeUsers = [
      { id: "u1", email: "a@example.com" },
      { id: "u2", email: "b@example.com" },
    ];
    const fakeMeta = { total: 2, page: 1, pageSize: 10, totalPages: 1 };

    const listUsersMock = vi.fn().mockResolvedValue({
      data: fakeUsers,
      meta: fakeMeta,
    });

    const container = {
      users: { listUsers: listUsersMock },
    } as unknown as ServiceContainer;

    const result = await dispatchUser(
      container,
      "listUsers",
      { page: "1", pageSize: "10" },
      undefined
    );

    expect(result).toEqual({
      success: true,
      statusCode: 200,
      data: fakeUsers,
      meta: fakeMeta,
    });

    expect(listUsersMock).toHaveBeenCalledTimes(1);
    expect(listUsersMock.mock.calls[0]?.[0]).toMatchObject({
      page: 1,
      pageSize: 10,
    });
  });

  it("does NOT double-wrap data (regression guard for the user-reported bug)", async () => {
    const fakeUsers = [{ id: "u1", email: "a@example.com" }];
    const fakeMeta = { total: 1, page: 1, pageSize: 10, totalPages: 1 };

    const container = {
      users: {
        listUsers: vi.fn().mockResolvedValue({
          data: fakeUsers,
          meta: fakeMeta,
        }),
      },
    } as unknown as ServiceContainer;

    const result = (await dispatchUser(
      container,
      "listUsers",
      { page: "1", pageSize: "10" },
      undefined
    )) as { data: unknown };

    // The bug shape was result.data === { data: [...], meta: {...} }.
    // The fix flattens it so result.data is the user array directly.
    expect(Array.isArray(result.data)).toBe(true);
    expect(result.data).not.toMatchObject({ data: expect.anything() });
  });
});
