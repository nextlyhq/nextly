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
            fields: [{ name: "b", type: "fieldGroup", fieldGroup: "b" }, text],
          },
          {
            slug: "b",
            label: { singular: "b" },
            fields: [{ name: "a", type: "fieldGroup", fieldGroup: "a" }, text],
          },
        ],
      } as never);

    expect(build).toThrow(
      expect.objectContaining({
        code: "VALIDATION_ERROR",
        publicData: {
          errors: [
            expect.objectContaining({
              path: "fieldGroups",
              code: "FIELD_GROUP_CYCLE",
              message: expect.stringContaining("a → b → a"),
            }),
          ],
        },
      })
    );
  });
});

describe("field groups nested deeper than the limit code once had", () => {
  it("are accepted five levels deep", () => {
    const levels = ["l1", "l2", "l3", "l4", "l5"];
    const build = () =>
      defineConfig({
        collections: [],
        fieldGroups: levels.map((slug, i) => ({
          slug,
          label: { singular: slug },
          fields:
            i + 1 < levels.length
              ? [
                  text,
                  {
                    name: "next",
                    type: "fieldGroup",
                    fieldGroup: levels[i + 1],
                  },
                ]
              : [text],
        })),
      } as never);

    expect(build).not.toThrow();
  });
});
