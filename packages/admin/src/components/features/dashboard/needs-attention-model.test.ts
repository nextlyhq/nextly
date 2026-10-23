/**
 * How the Needs attention card reads its slot: which state it draws, which
 * bucket is a kind and which a part, where each link goes, and which numbers
 * are floors.
 */
import type { WidgetSlot } from "nextly/widget-result";
import { describe, expect, it } from "vitest";

import { attentionTotal, attentionView } from "./needs-attention-model";

const NOW = Date.parse("2026-10-22T12:00:00Z");

function grouped(
  buckets: { value: string; count: number; atLeast?: boolean }[],
  choices: { value: string; label: string }[] = []
): WidgetSlot {
  return {
    ok: true,
    result: {
      op: "groupBy",
      buckets,
      field: { name: "item", label: "Item", type: "string", choices },
    },
  };
}

/** The `where` a link carries, read back. */
function whereOf(href: string | undefined): unknown {
  const query = href?.split("?")[1] ?? "";
  return JSON.parse(new URLSearchParams(query).get("where") ?? "null");
}

describe("the Needs attention card's view of its slot", () => {
  it("is loading before the batch answers, and not available for a refused source", () => {
    expect(attentionView(undefined, NOW)).toEqual({ state: "loading" });
    expect(
      attentionView({ ok: false, error: "x", code: "unavailable" }, NOW)
    ).toEqual({ state: "unavailable" });
    expect(attentionView({ ok: false, error: "Down" }, NOW)).toEqual({
      state: "error",
      message: "Down",
    });
  });

  it("is all clear only for an answer with nothing waiting", () => {
    expect(attentionView(grouped([]), NOW)).toEqual({ state: "clear" });
  });

  it("orders the kinds as the card names them, whatever order the buckets came in", () => {
    const view = attentionView(
      grouped([
        { value: "overdue", count: 5 },
        { value: "unpublished", count: 2 },
        { value: "unpublished:collection:posts", count: 2 },
      ]),
      NOW
    );
    expect(view.state === "ready" && view.kinds.map(k => k.kind)).toEqual([
      "unpublished",
      "overdue",
    ]);
  });

  it("links each part to exactly what it counts", () => {
    const view = attentionView(
      grouped(
        [
          { value: "unpublished", count: 3 },
          { value: "unpublished:collection:posts", count: 2 },
          { value: "unpublished:single:homepage", count: 1 },
          { value: "scheduled", count: 4 },
          { value: "scheduled:collection:posts", count: 4 },
          { value: "overdue", count: 1 },
        ],
        [
          { value: "unpublished:collection:posts", label: "Posts" },
          { value: "unpublished:single:homepage", label: "Homepage" },
          { value: "scheduled:collection:posts", label: "Posts" },
        ]
      ),
      NOW
    );
    if (view.state !== "ready") throw new Error(view.state);
    const [unpublished, scheduled, overdue] = view.kinds;

    expect(unpublished.parts.map(p => p.label)).toEqual(["Posts", "Homepage"]);
    expect(unpublished.parts[0].href.split("?")[0]).toBe(
      "/admin/collections/posts"
    );
    expect(whereOf(unpublished.parts[0].href)).toEqual({
      _pendingChange: true,
    });
    // A Single has no list, so it opens itself.
    expect(unpublished.parts[1].href).toBe("/admin/singles/homepage");
    // Spread over two places, the kind has no one list of its own.
    expect(unpublished.href).toBeUndefined();

    // One collection holds the whole kind, so the kind links to its list, with
    // the week the server counted.
    expect(whereOf(scheduled.href)).toEqual({
      _inRelease: { scheduledBefore: "2026-10-29T12:00:00.000Z" },
    });
    expect(overdue.href).toBe("/admin/releases?tab=attention&reason=overdue");
  });

  it("keeps each floor where the source put it", () => {
    const view = attentionView(
      grouped([
        { value: "unpublished", count: 99, atLeast: true },
        { value: "unpublished:collection:posts", count: 99, atLeast: true },
        { value: "overdue", count: 1 },
      ]),
      NOW
    );
    if (view.state !== "ready") throw new Error(view.state);
    expect(view.kinds.map(k => [k.kind, k.atLeast])).toEqual([
      ["unpublished", true],
      ["overdue", false],
    ]);
    expect(attentionTotal(view.kinds)).toEqual({ count: 100, atLeast: true });
  });

  it("leaves out a bucket that is not a key it knows", () => {
    expect(
      attentionView(grouped([{ value: "plugin:seo", count: 3 }]), NOW)
    ).toEqual({ state: "clear" });
  });
});
