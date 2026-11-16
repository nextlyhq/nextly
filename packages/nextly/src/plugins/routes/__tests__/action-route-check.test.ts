/**
 * The check a route bound to a declared action asks of each request, case by
 * case as its state table lists them: a malformed request is 400; the
 * action's permission refuses with the gate's own answer, before any row is
 * read; a collection the action is not offered on, or a readable row its rule
 * hides, is 403 ACTION_NOT_AVAILABLE; a row the caller cannot read answers as
 * a missing one does, 404; a bulk request is refused whole; and a request that
 * passes runs. A route bound to no action is asked nothing.
 */
import { describe, expect, it, vi } from "vitest";

import { NextlyError } from "../../../errors/nextly-error";
import {
  actionRouteRefusal,
  MAX_ACTION_ROWS,
  type ActionCheckDeps,
  type BoundAction,
} from "../action-route-check";

const ESCALATE: BoundAction = {
  id: "acme-support.escalate",
  kind: "rowAction",
  collections: ["helpdesk-tickets"],
  requiredPermission: ({ collection }) => collection("tickets", "update"),
  visibleWhen: { field: "status", notEquals: "closed" },
};
const ASSIGN: BoundAction = {
  id: "acme-support.assign",
  kind: "bulkAction",
  visibleWhen: { field: "status", equals: "open" },
};

/** Rows the caller may read, by collection and id, as they read them. */
const READABLE: Record<string, Record<string, Record<string, unknown>>> = {
  "helpdesk-tickets": {
    t1: { id: "t1", status: "open" },
    t2: { id: "t2", status: "closed" },
    // The rule's field is one this caller may not read: the read left it out.
    t3: { id: "t3" },
  },
  posts: { p1: { id: "p1", status: "open" } },
};

function deps(held: string[] = ["update-helpdesk-tickets"]) {
  const readRows = vi.fn(async (collection: string, ids: readonly string[]) => {
    const rows = READABLE[collection] ?? {};
    return new Map(
      ids.flatMap(id => (rows[id] ? [[id, rows[id]] as const] : []))
    );
  });
  const refusalFor = vi.fn(async (permission: string) =>
    held.includes(permission) ? undefined : NextlyError.forbidden()
  );
  const d: ActionCheckDeps = {
    self: {
      name: "@acme/support",
      collections: { tickets: "helpdesk-tickets" },
      singles: {},
    },
    refusalFor,
    readRows,
  };
  return { d, readRows, refusalFor };
}

const row = (collection: string, id: string) => ({ collection, id });

describe("actionRouteRefusal", () => {
  it("asks nothing of a route bound to no action", async () => {
    const { d, readRows } = deps();
    expect(await actionRouteRefusal("anything", [], d)).toBeUndefined();
    expect(readRows).not.toHaveBeenCalled();
  });

  it("lets through a request the action's permission and rule allow", async () => {
    const { d, refusalFor } = deps();
    expect(
      await actionRouteRefusal(
        {
          action: ESCALATE.id,
          rows: [row("helpdesk-tickets", "t1")],
          note: "x",
        },
        [ESCALATE, ASSIGN],
        d
      )
    ).toBeUndefined();
    // The permission was asked as the host's renames name it.
    expect(refusalFor).toHaveBeenCalledWith("update-helpdesk-tickets");
  });

  it.each<[string, unknown]>([
    ["no body", undefined],
    ["a body that is not an object", "escalate"],
    ["no action named", { rows: [row("helpdesk-tickets", "t1")] }],
    ["an action no row of which is named", { action: ESCALATE.id }],
    ["an empty list of rows", { action: ESCALATE.id, rows: [] }],
    [
      "rows that are not a list",
      { action: ESCALATE.id, rows: row("helpdesk-tickets", "t1") },
    ],
    [
      "a row with no id",
      { action: ESCALATE.id, rows: [{ collection: "helpdesk-tickets" }] },
    ],
    [
      "an action this route is not bound to",
      { action: "acme-support.other", rows: [row("helpdesk-tickets", "t1")] },
    ],
    [
      "two rows for a row action",
      {
        action: ESCALATE.id,
        rows: [row("helpdesk-tickets", "t1"), row("helpdesk-tickets", "t2")],
      },
    ],
    [
      "more rows than one request may name",
      {
        action: ASSIGN.id,
        rows: Array.from({ length: MAX_ACTION_ROWS + 1 }, (_, i) =>
          row("posts", `p${i}`)
        ),
      },
    ],
  ])("answers 400 to %s, reading no row", async (_case, body) => {
    const { d, readRows } = deps();
    const refused = await actionRouteRefusal(body, [ESCALATE, ASSIGN], d);
    expect(refused?.statusCode).toBe(400);
    expect(refused?.code).toBe("INVALID_INPUT");
    expect(readRows).not.toHaveBeenCalled();
  });

  it("refuses with the gate's own answer when the action's permission does not hold, before any row is read", async () => {
    const { d, readRows } = deps([]);
    const refused = await actionRouteRefusal(
      { action: ESCALATE.id, rows: [row("helpdesk-tickets", "t1")] },
      [ESCALATE],
      d
    );
    expect(refused?.code).toBe("FORBIDDEN");
    expect(readRows).not.toHaveBeenCalled();
  });

  it("refuses when the action's permission cannot be computed", async () => {
    const { d } = deps();
    const refused = await actionRouteRefusal(
      { action: "acme-support.broken", rows: [row("helpdesk-tickets", "t1")] },
      [
        {
          ...ESCALATE,
          id: "acme-support.broken",
          requiredPermission: () => {
            throw new Error("no names");
          },
        },
      ],
      d
    );
    expect(refused?.code).toBe("FORBIDDEN");
  });

  it("answers a row the caller cannot read as a missing one, 404", async () => {
    const { d } = deps();
    for (const id of ["gone", "t-unreadable"]) {
      const refused = await actionRouteRefusal(
        { action: ESCALATE.id, rows: [row("helpdesk-tickets", id)] },
        [ESCALATE],
        d
      );
      expect(refused?.statusCode).toBe(404);
      expect(refused?.code).toBe("NOT_FOUND");
    }
  });

  it.each<[string, Record<string, unknown>]>([
    [
      "a readable row the rule hides",
      { action: ESCALATE.id, rows: [row("helpdesk-tickets", "t2")] },
    ],
    [
      "a row whose rule needs a field the caller may not read",
      { action: ESCALATE.id, rows: [row("helpdesk-tickets", "t3")] },
    ],
    [
      "a collection the action is not offered on",
      { action: ESCALATE.id, rows: [row("posts", "p1")] },
    ],
  ])(
    "answers 403 ACTION_NOT_AVAILABLE to %s, saying nothing more",
    async (_case, body) => {
      const { d } = deps();
      const refused = await actionRouteRefusal(body, [ESCALATE], d);
      expect(refused?.statusCode).toBe(403);
      expect(refused?.code).toBe("ACTION_NOT_AVAILABLE");
      expect(refused?.publicMessage).toBe(
        "This action isn't available for this entry."
      );
    }
  );

  it("refuses a bulk request whole when one row fails, and lets one through when all pass", async () => {
    const { d } = deps();
    const mixed = await actionRouteRefusal(
      {
        action: ASSIGN.id,
        rows: [row("helpdesk-tickets", "t1"), row("helpdesk-tickets", "t2")],
      },
      [ASSIGN],
      d
    );
    expect(mixed?.code).toBe("ACTION_NOT_AVAILABLE");
    expect(
      await actionRouteRefusal(
        {
          action: ASSIGN.id,
          rows: [row("helpdesk-tickets", "t1"), row("posts", "p1")],
        },
        [ASSIGN],
        d
      )
    ).toBeUndefined();
  });

  it("reads each collection's rows once, whatever the rows named", async () => {
    const { d, readRows } = deps();
    await actionRouteRefusal(
      {
        action: ASSIGN.id,
        rows: [
          row("helpdesk-tickets", "t1"),
          row("posts", "p1"),
          row("helpdesk-tickets", "t1"),
        ],
      },
      [ASSIGN],
      d
    );
    expect(readRows).toHaveBeenCalledTimes(2);
    expect(readRows).toHaveBeenCalledWith("helpdesk-tickets", ["t1"]);
    expect(readRows).toHaveBeenCalledWith("posts", ["p1"]);
  });
});

describe("a route the person's menu item also runs", () => {
  /** Bound to the list's actions and to the plugin's menu item, as boot binds it. */
  const MENU: BoundAction = {
    id: "acme-support.user-menu",
    kind: "userMenuItem",
  };
  const shared = [ESCALATE, ASSIGN, MENU];

  it("lets the menu item through with no rows, reading none", async () => {
    const { d, readRows, refusalFor } = deps([]);
    expect(
      await actionRouteRefusal({ action: MENU.id, rows: [] }, shared, d)
    ).toBeUndefined();
    expect(readRows).not.toHaveBeenCalled();
    expect(refusalFor).not.toHaveBeenCalled();
  });

  it.each([
    ["a list action with no rows", { action: ESCALATE.id, rows: [] }],
    ["a bulk action with no rows", { action: ASSIGN.id, rows: [] }],
    ["an unknown id with no rows", { action: "acme-support.other", rows: [] }],
    [
      "the menu item naming rows",
      { action: MENU.id, rows: [row("helpdesk-tickets", "t1")] },
    ],
    ["the menu item with no rows key", { action: MENU.id }],
  ])("still answers 400 to %s, reading no row", async (_case, body) => {
    const { d, readRows } = deps();
    const refused = await actionRouteRefusal(body, shared, d);
    expect(refused?.statusCode).toBe(400);
    expect(refused?.code).toBe("INVALID_INPUT");
    expect(readRows).not.toHaveBeenCalled();
  });

  it("refuses the menu item's id on a route the menu item does not run", async () => {
    const { d } = deps();
    const refused = await actionRouteRefusal(
      { action: MENU.id, rows: [] },
      [ESCALATE, ASSIGN],
      d
    );
    expect(refused?.statusCode).toBe(400);
    expect(refused?.code).toBe("INVALID_INPUT");
  });
});
