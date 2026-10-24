/**
 * What a card's content settings may offer: the collection sources a reader
 * may see, each with only the fields no read rule can refuse and no read hook
 * transforms.
 *
 * The source builder and the field-function registry are the real ones; only
 * the collection is a fixture. Which collections a reader may see is decided
 * per request by the workspace route, and tested there.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  clearFieldFunctions,
  registerFieldFunctions,
} from "../../../shared/lib/field-level-registry";
import { registerBuiltInSources } from "../built-in-sources";
import { publishableContentSources } from "../publish";
import { clearSources } from "../sources";

beforeEach(() => {
  clearSources();
  clearFieldFunctions();
  registerFieldFunctions("collection", "posts", [
    { name: "secret", access: { read: () => true } },
    { name: "shout", hooks: { afterRead: [(value: unknown) => value] } },
  ]);
  registerBuiltInSources([
    {
      slug: "posts",
      fields: [
        { name: "title", type: "text", label: "Title" },
        {
          name: "state",
          type: "select",
          label: "State",
          choices: [{ label: "Open", value: "open" }],
        },
        { name: "secret", type: "text" },
        { name: "shout", type: "text" },
        // Readable, so offered to filter and sort, but its values live per
        // language, so the read will not group by it.
        { name: "headline", type: "text", localized: true },
      ],
      timestamps: false,
    },
  ]);
});

afterEach(() => {
  clearSources();
  clearFieldFunctions();
});

const offeredFor = (collection: string) =>
  publishableContentSources([{ generated: true, collection }]);

describe("the content sources a card's settings may offer", () => {
  it("offers a plain field with its label, type and choices", () => {
    const [posts] = offeredFor("posts");
    expect(posts?.collection).toBe("posts");
    const byName = new Map(posts?.fields.map(field => [field.name, field]));
    expect(byName.get("title")).toEqual({
      name: "title",
      type: "string",
      label: "Title",
    });
    expect(byName.get("state")).toMatchObject({
      name: "state",
      label: "State",
      choices: [{ value: "open", label: "Open" }],
    });
  });

  it("marks a field the read will not group by, and only that one", () => {
    const [posts] = offeredFor("posts");
    const byName = new Map(posts?.fields.map(field => [field.name, field]));
    expect(byName.get("headline")).toMatchObject({ groupable: false });
    // The control: a plain field carries no mark, so it stays groupable.
    expect(byName.get("title")).not.toHaveProperty("groupable");
  });

  it("never offers a field a read rule could refuse", () => {
    const [posts] = offeredFor("posts");
    const names = posts?.fields.map(field => field.name);
    // The control beside it: the source does carry fields.
    expect(names).toContain("title");
    expect(names).not.toContain("secret");
  });

  it("never offers a field a read hook transforms", () => {
    const [posts] = offeredFor("posts");
    const names = posts?.fields.map(field => field.name);
    expect(names).toContain("title");
    expect(names).not.toContain("shout");
  });

  it("names the field that titles an entry, so a list can ask each row's name", () => {
    expect(offeredFor("posts")[0]?.titleField).toBe("title");
  });

  it("names no title the reader is not offered", () => {
    // 🔴 Published regardless, a list would ask for a field a read rule may
    // refuse this reader, and every row would read as untitled or fail.
    registerFieldFunctions("collection", "notes", [
      { name: "secret", access: { read: () => true } },
    ]);
    registerBuiltInSources([
      {
        slug: "notes",
        useAsTitle: "secret",
        fields: [
          { name: "secret", type: "text" },
          { name: "body", type: "text" },
        ],
        timestamps: false,
      },
    ]);
    const [notes] = offeredFor("notes");
    expect(notes?.collection).toBe("notes");
    expect(notes).not.toHaveProperty("titleField");
  });

  it("offers only collections whose own card the reader may see", () => {
    // Derived from the visible cards: a declared card and a collection with no
    // card here are not collections this reader was found able to read.
    expect(
      publishableContentSources([
        { generated: false, collection: "posts" },
        { generated: true, collection: "absent" },
      ])
    ).toEqual([]);
    expect(offeredFor("posts")).toHaveLength(1);
  });
});
