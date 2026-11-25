/**
 * The Schema Builder save's POST actions on one entity's schema (`/schema/{slug}/{action}`), for a
 * collection and for a Single: each action reaches its own method with the entity's address, judged
 * as the operation its permission asks, and no other verb or action is taken for one.
 */
import { describe, expect, it } from "vitest";

import { parseRestRoute } from "../route-parser";

describe.each([
  {
    kind: "collection",
    base: ["collections", "schema", "posts"],
    param: "collectionName",
    actions: [
      ["preview", "single", "previewSchemaChanges"],
      ["type-change-targets", "single", "typeChangeTargets"],
      ["apply", "update", "applySchemaChanges"],
    ],
  },
  {
    kind: "Single",
    base: ["singles", "schema", "posts"],
    param: "slug",
    actions: [
      ["preview", "single", "previewSingleSchemaChanges"],
      ["type-change-targets", "single", "singleTypeChangeTargets"],
      ["apply", "update", "applySingleSchemaChanges"],
    ],
  },
] as const)("a $kind's schema actions", ({ base, param, actions }) => {
  it("each reaches its method with the entity's address, as its operation", () => {
    for (const [action, operation, method] of actions) {
      expect(parseRestRoute([...base, action], "POST"), action).toMatchObject({
        operation,
        method,
        routeParams: { [param]: "posts" },
      });
    }
  });

  it("is taken by POST alone, and only for an action it names", () => {
    const methods: readonly string[] = actions.map(([, , method]) => method);
    for (const [action] of actions) {
      expect(
        methods.includes(parseRestRoute([...base, action], "GET")?.method ?? "")
      ).toBe(false);
    }
    // An action spelled like an inherited member names none.
    expect(
      methods.includes(
        parseRestRoute([...base, "toString"], "POST")?.method ?? ""
      )
    ).toBe(false);
  });
});
