/**
 * Which fields a localization restore copies back when a plugin's scope holds
 * fields back from the entity: its own as before, and a held-back one only
 * when it is translated, one to a column.
 */
import { describe, expect, it } from "vitest";

import { fieldsToRestore } from "../restore-companion";

const names = (fields: { name: string }[]) => fields.map(field => field.name);

describe("fieldsToRestore", () => {
  it("restores a held-back field only when it is translated, whatever the entity's own fall back to", () => {
    // The entity's own flags cleared with its translation: its own fields are
    // all offered. A held-back number declared nothing, so it is shared.
    expect(
      names(
        fieldsToRestore({
          fields: [{ name: "score", type: "number" }],
          heldBack: [{ name: "rank", type: "number" }],
        })
      )
    ).toEqual(["score"]);
  });

  it("restores one held-back field to a column, whatever the case of its name", () => {
    expect(
      names(
        fieldsToRestore({
          fields: [{ name: "title", type: "text", localized: true }],
          heldBack: [
            { name: "seo", type: "text", localized: true },
            { name: "Seo", type: "text", localized: true },
            { name: "Title", type: "text", localized: true },
          ],
        })
      )
    ).toEqual(["title", "seo"]);
  });
});
