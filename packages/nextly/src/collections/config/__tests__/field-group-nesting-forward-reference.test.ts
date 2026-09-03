/**
 * A field group declared BEFORE the group it references must still reach the
 * nesting graph.
 *
 * The adjacency edges used to be filtered against the slug set built so far,
 * so a forward reference was dropped before its target was known — and the
 * later re-filter only re-filtered the survivors. A cycle written in forward
 * order therefore passed validation and shipped until the runtime blew the
 * nesting depth on its own.
 */
import { describe, expect, it } from "vitest";

import { defineConfig } from "../define-config";

const text = { type: "text" as const, name: "title" };

describe("a field group declared before the group it references", () => {
  it("reports the cycle the forward edge participates in", () => {
    const build = () =>
      defineConfig({
        collections: [],
        fieldGroups: [
          {
            slug: "a",
            label: { singular: "a" },
            fields: [
              { name: "b", type: "fieldGroup", fieldGroup: "b" },
              text,
            ],
          },
          {
            slug: "b",
            label: { singular: "b" },
            fields: [
              { name: "a", type: "fieldGroup", fieldGroup: "a" },
              text,
            ],
          },
        ],
      } as never);

    expect(build).toThrow(/Circular component reference detected/);
  });
});
