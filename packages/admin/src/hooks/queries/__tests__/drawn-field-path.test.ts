/**
 * Which server paths a refused save's reason can be shown at: only a field
 * the form actually draws. A reason put on a field the form leaves out is
 * stored and shown nowhere, so it must be handed to the toast instead.
 *
 * The form's own decision about whether a field is drawn decides it — a
 * field's `admin.hidden`, one inherited from an unnamed group around it, and
 * its condition, read against the form's values when the refusal arrives.
 */
import { describe, expect, it } from "vitest";

import { drawnFieldPath } from "../drawn-field-path";

const fields = [
  { name: "title", type: "text" },
  { name: "secret", type: "text", admin: { hidden: true } },
  {
    type: "group",
    admin: { hidden: true },
    fields: [{ name: "internal", type: "text" }],
  },
  {
    type: "group",
    fields: [{ name: "summary", type: "text" }],
  },
  { name: "mode", type: "select" },
  {
    name: "url",
    type: "text",
    admin: { condition: { field: "mode", equals: "link" } },
  },
  { name: "hero", type: "group", fields: [{ name: "body", type: "text" }] },
];

describe("drawnFieldPath", () => {
  const values: Record<string, unknown> = { mode: "page" };
  const drawn = drawnFieldPath(fields, path => values[path]);

  it("answers a drawn field, at the top level or through an unnamed group", () => {
    expect(drawn?.("title")).toBe(true);
    expect(drawn?.("summary")).toBe(true);
    // A named group's field, by the group it starts at.
    expect(drawn?.("hero.body")).toBe(true);
  });

  it("refuses a field the form never draws", () => {
    expect(drawn?.("secret")).toBe(false);
  });

  it("refuses a field an unnamed hidden group keeps out of the form", () => {
    expect(drawn?.("internal")).toBe(false);
  });

  it("refuses a field its condition hides right now, and answers it once shown", () => {
    expect(drawn?.("url")).toBe(false);
    values.mode = "link";
    expect(drawn?.("url")).toBe(true);
  });

  it("refuses a path that names no field", () => {
    expect(drawn?.("status")).toBe(false);
  });

  it("leaves every path to the form without fields", () => {
    expect(drawnFieldPath(undefined)).toBeUndefined();
  });
});
