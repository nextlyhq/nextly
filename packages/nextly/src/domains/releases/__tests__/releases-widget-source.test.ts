/**
 * `system:releases` — what the dashboard asks the releases service, and what it
 * refuses to answer.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const find = vi.fn();
const has = vi.fn();

vi.mock("../../../di/container", () => ({
  container: {
    has: (name: string) => has(name) as boolean,
    get: () => ({ find }),
  },
}));

import { executeWidgetQuery } from "../../widgets/execute";
import { clearSources } from "../../widgets/sources";
import { clearSystemResolvers } from "../../widgets/system-sources";
import {
  RELEASES_SOURCE_ID,
  registerReleasesWidgetSource,
} from "../releases-widget-source";

const caller = { user: { id: "user-1", roles: ["editor"] } };

const row = {
  id: "r1",
  title: "Spring launch",
  description: "notes",
  scheduledAt: new Date("2099-01-01T00:00:00Z"),
  timezone: "UTC",
  state: "scheduled",
  publishedAt: null,
  createdBy: "someone-else",
  createdAt: new Date("2020-01-01T00:00:00Z"),
  updatedAt: new Date("2020-01-01T00:00:00Z"),
  revision: 3,
};

beforeEach(() => {
  vi.clearAllMocks();
  has.mockReturnValue(true);
  find.mockResolvedValue([row]);
  clearSources();
  clearSystemResolvers();
  registerReleasesWidgetSource();
});

describe("what it asks the service", () => {
  it("asks for the SOONEST scheduled releases still ahead", async () => {
    // 🔴 All three together are the question. `order: "soonest"` alone under a
    // missing `scheduledAfter` includes releases that already shipped; the
    // window alone under the default order returns the furthest-out ones.
    await executeWidgetQuery(
      { source: RELEASES_SOURCE_ID, op: "list", limit: 3 },
      caller
    );

    const [query] = find.mock.calls[0] as [Record<string, unknown>];
    expect(query.state).toBe("scheduled");
    expect(query.order).toBe("soonest");
    expect(query.limit).toBe(3);
    expect(query.scheduledAfter).toBeInstanceOf(Date);
  });

  it("hands the service the CALLER, and never overrides access", async () => {
    // 🔴 The resolver adds no rule of its own, so the service's `authorize` is
    // the only thing standing between a reader and every release in the
    // install. It can only run on a caller it was given.
    await executeWidgetQuery(
      { source: RELEASES_SOURCE_ID, op: "list" },
      {
        ...caller,
        authenticatedScope: {
          actorType: "apiKey" as const,
          permissions: ["releases:read"],
        },
      }
    );

    const [, actor] = find.mock.calls[0] as [unknown, Record<string, unknown>];
    expect(actor.userId).toBe("user-1");
    expect(actor.overrideAccess).toBeUndefined();
    expect(actor.authenticatedScope).toEqual({
      actorType: "apiKey",
      permissions: ["releases:read"],
    });
  });

  it("forwards the caller's ROLES", async () => {
    // 🔴 `ReleaseActor.userRoles` is what a code-defined access rule reads. An
    // actor built without it evaluates that rule against an empty list, so a
    // reader authorized by their roles is refused here while the REST route and
    // the Direct API — which both forward it — admit them.
    await executeWidgetQuery(
      { source: RELEASES_SOURCE_ID, op: "list" },
      caller
    );

    const [, actor] = find.mock.calls[0] as [unknown, Record<string, unknown>];
    expect(actor.userRoles).toEqual(["editor"]);
  });

  it("does not invent an authenticatedScope for a session caller", async () => {
    // A present-but-undefined key wins a spread, so an unconditional one would
    // stamp a session caller with an empty scope and have it judged as a
    // narrowly scoped key rather than by its roles.
    await executeWidgetQuery(
      { source: RELEASES_SOURCE_ID, op: "list" },
      caller
    );

    const [, actor] = find.mock.calls[0] as [unknown, Record<string, unknown>];
    expect("authenticatedScope" in actor).toBe(false);
  });
});

describe("what it answers with", () => {
  it("publishes only its DECLARED fields", async () => {
    // 🔴 A release row carries `createdBy`, `revision` and `publishedAt`. The
    // source's field list is the allowlist a query is checked against, so a row
    // returned whole would hand every reader columns the source never declared
    // and nothing downstream would refuse them.
    const result = await executeWidgetQuery(
      { source: RELEASES_SOURCE_ID, op: "list" },
      caller
    );

    const [item] = (result as { items: Record<string, unknown>[] }).items;
    expect(Object.keys(item).sort()).toEqual(["scheduledAt", "state", "title"]);
  });

  /*
   * 🔴 The DATE's type reaches the result, which is the half that used to stop
   * at the server. Every source declares `scheduledAt` a date, the renderer
   * needs that to present it, and without it the row drew the ISO string the
   * value crossed as -- on a card whose entire subject is when. Asserted on the
   * producer because the renderer and the wire parser each have their own test,
   * and all three have to hold for a reader to see a date.
   */
  it("publishes the declared kind of each column", async () => {
    const result = await executeWidgetQuery(
      {
        source: RELEASES_SOURCE_ID,
        op: "list",
        select: ["title", "scheduledAt"],
      },
      caller
    );

    expect((result as { fields?: unknown }).fields).toEqual([
      { name: "title", label: "Release", type: "string" },
      { name: "scheduledAt", label: "Scheduled", type: "date" },
    ]);
  });

  it("heads only the columns the query selected", async () => {
    const result = await executeWidgetQuery(
      { source: RELEASES_SOURCE_ID, op: "list", select: ["title"] },
      caller
    );

    expect((result as { fields?: unknown }).fields).toEqual([
      { name: "title", label: "Release", type: "string" },
    ]);
    const [item] = (result as { items: Record<string, unknown>[] }).items;
    expect(Object.keys(item)).toEqual(["title"]);
  });
});

describe("what it refuses", () => {
  it("refuses a `where`, rather than ignoring it", async () => {
    // 🔴 The declared fields make a `where` expressible, and this resolver asks
    // one fixed question. Accepting the filter and discarding it answers a
    // DIFFERENT question than the one asked, with rows that look right.
    await expect(
      executeWidgetQuery(
        {
          source: RELEASES_SOURCE_ID,
          op: "list",
          where: { state: { equals: "draft" } },
        },
        caller
      )
    ).rejects.toThrow(/unavailable source or unsupported op/);
    expect(find).not.toHaveBeenCalled();
  });

  it("refuses a `status` selector, rather than ignoring it", async () => {
    // The validator accepts `status` for every source, and this resolver
    // hard-codes `state: "scheduled"`. Accepting the selector and dropping it
    // answers a question the caller did not ask, with plausible rows.
    await expect(
      executeWidgetQuery(
        { source: RELEASES_SOURCE_ID, op: "list", status: "draft" },
        caller
      )
    ).rejects.toThrow(/unavailable source or unsupported op/);
    expect(find).not.toHaveBeenCalled();
  });

  it("refuses EVERY unconsumed field, named together", async () => {
    // 🔴 The property is the boundary, not the three fields. A resolver that
    // checked them one at a time is what let `status` through, so this asserts
    // that a query carrying several is refused as a whole.
    await expect(
      executeWidgetQuery(
        {
          source: RELEASES_SOURCE_ID,
          op: "list",
          status: "draft",
          sort: "-scheduledAt",
          where: { state: { equals: "draft" } },
        },
        caller
      )
    ).rejects.toThrow(/unavailable source or unsupported op/);
    expect(find).not.toHaveBeenCalled();
  });

  it("still answers a query that carries only consumed fields", async () => {
    // The control. A refusal keyed on "any field present" would satisfy every
    // case above and refuse the card's own query.
    await expect(
      executeWidgetQuery(
        { source: RELEASES_SOURCE_ID, op: "list", select: ["title"], limit: 2 },
        caller
      )
    ).resolves.toBeDefined();
    expect(find).toHaveBeenCalledTimes(1);
  });

  it("refuses a `sort`, rather than ignoring it", async () => {
    await expect(
      executeWidgetQuery(
        { source: RELEASES_SOURCE_ID, op: "list", sort: "-scheduledAt" },
        caller
      )
    ).rejects.toThrow(/unavailable source or unsupported op/);
    expect(find).not.toHaveBeenCalled();
  });

  it("says nothing specific when the service is not registered", async () => {
    has.mockReturnValue(false);

    await expect(
      executeWidgetQuery({ source: RELEASES_SOURCE_ID, op: "list" }, caller)
    ).rejects.toThrow(/unexpected error|internal/i);
  });
});
