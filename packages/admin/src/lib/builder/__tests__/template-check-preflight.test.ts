/**
 * The Builder's own preflight, which every template field meets, sees each
 * field as the save would: a group or repeater with the fields inside it, so
 * a rule about what a container holds judges what the template declares.
 */
import { describe, expect, it, vi } from "vitest";

import type { BuilderField } from "@admin/components/features/schema-builder/types";

/** Every field the preflight was handed, in order. */
const judged: BuilderField[] = [];
vi.mock("../field-validators", async importOriginal => {
  const actual = await importOriginal<typeof import("../field-validators")>();
  return {
    ...actual,
    builderFieldErrors: (fields: BuilderField[]) => {
      judged.push(...fields);
      return actual.builderFieldErrors(fields);
    },
  };
});

import { checkTemplate } from "../template-check";

describe("the template check's preflight", () => {
  it("hands a repeater over with the fields inside it", () => {
    checkTemplate(
      {
        id: "t",
        kind: "collection",
        category: "Test",
        name: "Test",
        description: "",
        fields: [
          {
            name: "images",
            label: "Images",
            type: "repeater",
            fields: [
              { name: "image", label: "Image", type: "upload" },
              { name: "alt", label: "Alternative text", type: "text" },
            ],
          },
        ],
      },
      { offeredTypes: new Set(["repeater", "upload", "text"]) }
    );
    const repeater = judged.find(field => field.name === "images");
    expect(repeater?.fields?.map(field => field.name)).toEqual([
      "image",
      "alt",
    ]);
  });
});
