/**
 * Which part's draft each of a document's keys belongs to (`partKeysOf`).
 *
 * An unnamed group only arranges the form: its children are stored at the
 * level it sits in, so each one is a key of the document and belongs to a part
 * as any top-level field does. Classifying only named top-level fields would
 * leave those keys in neither draft, and a held edit to one would be lost.
 */
import { describe, expect, it } from "vitest";

import { partKeysOf } from "../part-drafts";

describe("partKeysOf", () => {
  it("classifies the fields of an unnamed group into their parts", async () => {
    const details = {
      type: "group",
      fields: [
        { type: "number", name: "rank" },
        { type: "text", name: "caption" },
      ],
    };
    const keys = await partKeysOf([{ type: "text", name: "title" }, details]);

    expect([...keys.language].sort()).toEqual(["caption", "title"]);
    expect([...keys.shared]).toEqual(["rank"]);
  });

  it("keeps a named group as one key of its own", async () => {
    const meta = {
      type: "group",
      name: "meta",
      fields: [{ type: "text", name: "caption" }],
    };
    const keys = await partKeysOf([{ type: "number", name: "views" }, meta]);

    // The group's value is one stored key; its children are not top-level.
    expect([...keys.language, ...keys.shared].sort()).toEqual([
      "meta",
      "views",
    ]);
  });
});
