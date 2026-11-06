/**
 * One place's contributions of one kind, in order, with the place's built-in
 * parts among them: by number, then by `before` and `after`, built-in parts
 * keeping their own order, ties broken by id; a contribution that replaces a
 * built-in part stands where it was. A reference to nothing, a part replaced
 * twice or not there, and a cycle each stop the app from starting, naming
 * what is wrong.
 */
import { describe, expect, it } from "vitest";

import {
  orderContributions,
  type OrderableContribution,
  type OrderedEntry,
} from "../contribution-order";

const SCOPE = { place: "collection.edit", kind: "sidebarSection" };
const BUILT_INS = ["status", "publishing", "language", "details"];

const c = (
  id: string,
  over: Partial<OrderableContribution> = {}
): OrderableContribution => ({ id, plugin: "@acme/support", ...over });

/** The ordered list as names: a built-in's, or `+id`, or `id>replaced`. */
function names(entries: OrderedEntry[]): string[] {
  return entries.map(entry =>
    "builtIn" in entry
      ? entry.builtIn
      : entry.replaces
        ? `${entry.contribution}>${entry.replaces}`
        : `+${entry.contribution}`
  );
}

/** What `fn` refused with. */
function refusalOf(fn: () => unknown): {
  reason?: string;
  logMessage?: string;
  logContext?: Record<string, unknown>;
} {
  try {
    fn();
  } catch (error) {
    const { logMessage, logContext } = error as {
      logMessage?: string;
      logContext?: Record<string, unknown>;
    };
    return { reason: logContext?.reason as string, logMessage, logContext };
  }
  return {};
}

describe("orderContributions", () => {
  it("keeps the built-in parts in their order when nothing is contributed", () => {
    expect(names(orderContributions([], BUILT_INS, SCOPE))).toEqual(BUILT_INS);
  });

  it("orders by number, built-in parts first among equals, then by id", () => {
    expect(
      names(
        orderContributions(
          [
            c("acme-support.zeta"),
            c("acme-support.alpha"),
            c("acme-support.first", { order: 10 }),
            c("acme-support.last", { order: 200 }),
          ],
          BUILT_INS,
          SCOPE
        )
      )
    ).toEqual([
      "+acme-support.first",
      ...BUILT_INS,
      "+acme-support.alpha",
      "+acme-support.zeta",
      "+acme-support.last",
    ]);
  });

  it("places a contribution before or after a built-in part or another contribution", () => {
    expect(
      names(
        orderContributions(
          [
            c("acme-support.sla", { after: "status" }),
            c("acme-support.owner", { before: "details" }),
            c("acme-support.note", { after: "acme-support.sla" }),
          ],
          BUILT_INS,
          SCOPE
        )
      )
    ).toEqual([
      "status",
      "+acme-support.sla",
      "+acme-support.note",
      "publishing",
      "language",
      "+acme-support.owner",
      "details",
    ]);
  });

  it("puts a replacement where the built-in part was, and orders others by either name", () => {
    expect(
      names(
        orderContributions(
          [
            c("acme-support.publishing", { replaces: "publishing" }),
            c("acme-support.after-it", { after: "publishing" }),
            c("acme-support.before-it", { before: "acme-support.publishing" }),
          ],
          BUILT_INS,
          SCOPE
        )
      )
    ).toEqual([
      "status",
      "+acme-support.before-it",
      "acme-support.publishing>publishing",
      "+acme-support.after-it",
      "language",
      "details",
    ]);
  });

  it("keeps a contribution straight after the one it follows, ahead of what that one precedes", () => {
    expect(
      names(
        orderContributions(
          [
            c("acme-support.a", { before: "status" }),
            c("acme-support.b", { after: "acme-support.a" }),
          ],
          BUILT_INS,
          SCOPE
        )
      )
    ).toEqual(["+acme-support.a", "+acme-support.b", ...BUILT_INS]);
  });

  it("places a contribution after the one it follows, past one that must come between them", () => {
    // `after` is an order and nearness, not adjacency: D must come before B,
    // so it stays between A and B rather than the order being refused.
    expect(
      names(
        orderContributions(
          [
            c("acme-support.a", { order: 10 }),
            c("acme-support.b", { after: "acme-support.a" }),
            c("acme-support.d", { before: "acme-support.b" }),
          ],
          [],
          SCOPE
        )
      )
    ).toEqual(["+acme-support.a", "+acme-support.d", "+acme-support.b"]);
  });

  it("refuses a reference to nothing there", () => {
    expect(
      refusalOf(() =>
        orderContributions(
          [c("acme-support.sla", { after: "sidebar" })],
          BUILT_INS,
          SCOPE
        )
      )
    ).toMatchObject({
      reason: "contribution-order-unknown",
      logContext: {
        plugin: "@acme/support",
        contribution: "acme-support.sla",
        after: "sidebar",
        place: "collection.edit",
      },
    });
  });

  it("refuses to replace a built-in part the place does not have", () => {
    expect(
      refusalOf(() =>
        orderContributions(
          [c("acme-support.x", { replaces: "toolbar" })],
          BUILT_INS,
          SCOPE
        )
      )
    ).toMatchObject({
      reason: "contribution-replace-unknown",
      logContext: { contribution: "acme-support.x", replaces: "toolbar" },
    });
  });

  it("refuses two replacements of one built-in part, naming both", () => {
    expect(
      refusalOf(() =>
        orderContributions(
          [
            c("acme-support.one", { replaces: "status" }),
            c("acme-other.two", { plugin: "@acme/other", replaces: "status" }),
          ],
          BUILT_INS,
          SCOPE
        )
      )
    ).toMatchObject({
      reason: "contribution-replace-twice",
      logContext: {
        replaces: "status",
        contributions: ["acme-support.one", "acme-other.two"],
      },
    });
  });

  it("refuses two contributions each ordered before the other, naming both", () => {
    expect(
      refusalOf(() =>
        orderContributions(
          [
            c("acme-support.a", { before: "acme-support.b" }),
            c("acme-support.b", { before: "acme-support.a" }),
          ],
          BUILT_INS,
          SCOPE
        )
      )
    ).toMatchObject({
      reason: "contribution-order-cycle",
      logContext: { contributions: ["acme-support.a", "acme-support.b"] },
    });
  });

  it("names a three-cycle's members and not what merely follows it", () => {
    const refusal = refusalOf(() =>
      orderContributions(
        [
          c("acme-support.a", { before: "acme-support.b" }),
          c("acme-support.b", { before: "acme-support.c" }),
          c("acme-support.c", { before: "acme-support.a" }),
          c("acme-support.follower", { after: "acme-support.c" }),
        ],
        BUILT_INS,
        SCOPE
      )
    );
    expect(refusal).toMatchObject({
      reason: "contribution-order-cycle",
      logContext: {
        contributions: ["acme-support.a", "acme-support.b", "acme-support.c"],
      },
    });
  });

  it("refuses a contribution ordered against the built-in parts' own order", () => {
    // "details" follows "status"; a contribution before "status" and after
    // "details" cannot be placed.
    expect(
      refusalOf(() =>
        orderContributions(
          [c("acme-support.x", { before: "status", after: "details" })],
          BUILT_INS,
          SCOPE
        )
      )
    ).toMatchObject({ reason: "contribution-order-cycle" });
  });

  it("refuses a contribution ordered against itself", () => {
    expect(
      refusalOf(() =>
        orderContributions(
          [c("acme-support.x", { before: "acme-support.x" })],
          BUILT_INS,
          SCOPE
        )
      )
    ).toMatchObject({
      reason: "contribution-order-cycle",
      logContext: { contributions: ["acme-support.x"] },
    });
  });
});
