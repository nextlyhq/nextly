/**
 * A collection's top-level blocks fields as the save and the page actions
 * read them: a collection the site does not have offers none, and any other
 * failure to read it is thrown, so the save refuses rather than storing a
 * field nobody checked.
 */
import { NextlyError } from "@nextlyhq/plugin-sdk";
import { describe, expect, it } from "vitest";

import {
  entryBlocksFieldsOf,
  readEntryBlocksFields,
} from "./entry-content-fields";

const POSTS = {
  slug: "posts",
  label: "Post",
  labels: { singular: "Post", plural: "Posts" },
  fields: [
    { name: "title", type: "text" },
    { name: "body", type: "blocks", label: "Body" },
    // An unnamed group: presentation only, its fields stored on the entry.
    { type: "group", fields: [{ name: "membersOnly", type: "blocks" }] },
  ],
};

describe("a blocks field inside an unnamed container", () => {
  it("is the entry's own inside a group, never inside a repeater, whose rows store it", () => {
    const record = {
      fields: [
        { type: "group", fields: [{ name: "intro", type: "blocks" }] },
        // Unnamed, yet its children are stored per row.
        { type: "repeater", fields: [{ name: "slides", type: "blocks" }] },
        {
          name: "steps",
          type: "repeater",
          fields: [{ name: "step", type: "blocks" }],
        },
      ],
    };
    expect(entryBlocksFieldsOf(record).map(field => field.name)).toEqual([
      "intro",
    ]);
  });
});

describe("a collection's blocks fields, read for a template", () => {
  it("names each by its label, else its key in the admin's words", () => {
    expect(entryBlocksFieldsOf(POSTS)).toEqual([
      { name: "body", label: "Body" },
      { name: "membersOnly", label: "Members Only" },
    ]);
  });

  it("answers the fields and the collection's name for a collection read (the control)", async () => {
    const read = await readEntryBlocksFields(
      { getCollection: async () => POSTS },
      "posts"
    );
    expect(read?.label).toBe("Posts");
    expect(read?.fields.map(field => field.name)).toEqual([
      "body",
      "membersOnly",
    ]);
  });

  it("answers nothing for a collection the site does not have", async () => {
    const read = await readEntryBlocksFields(
      {
        getCollection: () => Promise.reject(NextlyError.notFound({})),
      },
      "gone"
    );
    expect(read).toBeUndefined();
  });

  it("throws any other failure to read, never answering it as no fields", async () => {
    await expect(
      readEntryBlocksFields(
        {
          getCollection: () =>
            Promise.reject(new Error("the registry is down")),
        },
        "posts"
      )
    ).rejects.toThrow("the registry is down");
  });
});
