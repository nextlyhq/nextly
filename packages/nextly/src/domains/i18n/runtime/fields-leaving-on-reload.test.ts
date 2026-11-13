import { describe, expect, it } from "vitest";

import {
  configWithLeavingSettingsHeld,
  type FieldsLeavingOnReload,
  translationStaysOn,
} from "./fields-leaving-on-reload";

// A reload that stops after its apply publishes nothing, so the runtime keeps the fields it had
// until it is reloaded: the message says how.
describe("translationStaysOn", () => {
  it("names the entities and says to restart the dev server or save again", () => {
    const message = translationStaysOn(["posts", "pages"]);
    expect(message).toContain("Translation stays on for posts, pages");
    expect(message).toContain(
      "Restart the dev server (or save the collection again) to reload its fields"
    );
    expect(message).toContain("the content is intact where it is");
  });
});

// `nextly db:sync` pushes from the config itself, so it holds the settings there: the leaving
// field's column is added nullable and not unique, and the push after the copy applies them.
describe("configWithLeavingSettingsHeld", () => {
  const body = { name: "body", type: "text", required: true, unique: true };
  const title = { name: "title", type: "text", required: true };
  const entry = (
    kind: FieldsLeavingOnReload["kind"],
    slug: string
  ): FieldsLeavingOnReload => ({
    kind,
    slug,
    tableName: `t_${slug}`,
    status: false,
    perLanguageStatus: false,
    newFields: [body, title],
    oldFields: [body, title],
    leaving: new Set(["body"]),
    uniqueIndexes: [["body", "title"]],
    uniqueIndexed: new Set(),
  });
  const config = {
    collections: [
      {
        slug: "posts",
        fields: [body, title],
        indexes: [
          { fields: ["body", "title"], unique: true },
          { fields: ["title"], unique: true },
          { fields: ["body"] },
        ],
      },
      { slug: "pages", fields: [body, title] },
    ],
    singles: [{ slug: "posts", fields: [body, title] }],
  };

  it("holds only the leaving field of the entity it leaves, and its unique indexes", () => {
    const held = configWithLeavingSettingsHeld(config, [
      entry("collection", "posts"),
    ]);
    const [posts, pages] = held.collections as typeof config.collections;
    expect(posts.fields).toEqual([
      { ...body, required: false, unique: false },
      title,
    ]);
    expect(posts.indexes).toEqual([
      { fields: ["title"], unique: true },
      { fields: ["body"] },
    ]);
    // Another collection, and a Single of the same slug, keep their settings.
    expect(pages.fields).toEqual([body, title]);
    expect(held.singles).toEqual(config.singles);
  });

  it("returns the config itself when no field leaves", () => {
    expect(configWithLeavingSettingsHeld(config, [])).toBe(config);
  });
});
