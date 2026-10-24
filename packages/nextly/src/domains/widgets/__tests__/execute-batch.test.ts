/**
 * What core's executor shares across one batch, and where a window in the past
 * ends: asked through `executeWidgetQuery` with the reads it makes counted at
 * their own seams.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const reads = vi.hoisted(() => ({
  count: vi.fn(),
  timeseries: vi.fn(),
  callerMayReadReleases: vi.fn(),
  callerMayReadAnyRelease: vi.fn(),
}));
vi.mock("../../../direct-api/nextly", () => ({
  requireNextly: () => ({ count: reads.count, timeseries: reads.timeseries }),
}));
vi.mock("../../releases/releases-widget-source", () => ({
  callerMayReadReleases: reads.callerMayReadReleases,
  callerMayReadAnyRelease: reads.callerMayReadAnyRelease,
}));

import { createBatchScope } from "../batch-scope";
import { executeWidgetQuery } from "../execute";
import { validateWidgetQuery } from "../query";
import { clearSources, registerSource } from "../sources";

const caller = { user: { id: "user-1", roles: ["editor"] } };
const now = new Date("2026-03-31T10:20:30.400Z");

beforeEach(() => {
  vi.clearAllMocks();
  reads.count.mockResolvedValue({ total: 3 });
  reads.timeseries.mockResolvedValue({ points: [], interval: "day" });
  reads.callerMayReadReleases.mockResolvedValue(true);
  reads.callerMayReadAnyRelease.mockResolvedValue(true);
  clearSources();
  for (const slug of ["posts", "pages"]) {
    registerSource({
      id: `collection:${slug}`,
      label: slug,
      kind: "collection",
      supports: ["count", "timeseries"],
      fields: [{ name: "createdAt", type: "date" }],
    });
  }
});

describe("a release condition across one batch", () => {
  it("asks whether the caller has a release to read once, however many collections ask it", async () => {
    // 🔴 Each collection has a view of its own; kept there, the same
    // caller-wide answer is read once per collection.
    const batch = createBatchScope();
    for (const slug of ["posts", "pages"]) {
      const query = validateWidgetQuery({
        source: `collection:${slug}`,
        op: "count",
        where: { _inRelease: true },
      });
      await executeWidgetQuery(query, caller, {
        scope: batch.forSource(`collection:${slug}`),
        callerScope: batch.forCaller(),
        now,
      });
    }
    expect(reads.count).toHaveBeenCalledTimes(2);
    expect(reads.callerMayReadReleases).toHaveBeenCalledTimes(1);
    expect(reads.callerMayReadAnyRelease).toHaveBeenCalledTimes(1);
  });

  it("asks it again in another batch, which may be another caller's", async () => {
    for (const batch of [createBatchScope(), createBatchScope()]) {
      const query = validateWidgetQuery({
        source: "collection:posts",
        op: "count",
        where: { _inRelease: true },
      });
      await executeWidgetQuery(query, caller, {
        scope: batch.forSource("collection:posts"),
        callerScope: batch.forCaller(),
        now,
      });
    }
    expect(reads.callerMayReadAnyRelease).toHaveBeenCalledTimes(2);
  });
});

describe("a timeseries over a window in the past", () => {
  it("draws its intervals up to the until boundary, where its rows end", async () => {
    // 🔴 Anchored at the batch's instant, a 60d-to-30d series draws the last
    // thirty days, where the window keeps no row.
    const query = validateWidgetQuery({
      source: "collection:posts",
      op: "timeseries",
      dateField: "createdAt",
      interval: "day",
      since: "60d",
      until: "30d",
    });
    await executeWidgetQuery(query, caller, { now });
    const [args] = reads.timeseries.mock.calls[0] as [
      {
        now: Date;
        where: { and: Array<Record<string, Record<string, string>>> };
      },
    ];
    const window = args.where.and.at(-1)?.createdAt;
    expect(args.now.toISOString()).toBe(window?.less_than);
    expect(args.now.getTime()).toBeLessThan(now.getTime());
  });

  it("draws up to the batch's instant when it states no until", async () => {
    const query = validateWidgetQuery({
      source: "collection:posts",
      op: "timeseries",
      dateField: "createdAt",
      interval: "day",
      since: "30d",
    });
    await executeWidgetQuery(query, caller, { now });
    const [args] = reads.timeseries.mock.calls[0] as [{ now: Date }];
    expect(args.now.toISOString()).toBe(now.toISOString());
  });
});
