/**
 * A template's Entry content block judged at save against the collection it
 * draws: a field that is not one of its top-level blocks fields is refused,
 * naming the field and the collection, and so is a block naming none; a
 * template stored before its field was removed keeps saving; and a document
 * of kind `template` stored anywhere but the templates collection (an
 * entry's own blocks field) is refused for holding one.
 *
 * Each refusal sits beside the write that passes: Body is the control for a
 * field the collection lacks, the templates collection for an entry's field.
 */
import type {
  PluginFieldValidateArgs,
  PluginFieldWrite,
} from "@nextlyhq/plugin-sdk";
import { describe, expect, it, vi } from "vitest";

import type { StoredForms } from "./added-undefined-ids";
import {
  newEntryContentIssues,
  type EntryBlocksFieldsReader,
} from "./entry-content-judgement";
import type { TemplateTargets } from "./list-query-judgement";

function templateOf(field?: unknown) {
  return {
    formatVersion: 1,
    kind: "template",
    nodes: [
      {
        id: "ec",
        type: "core/entry-content",
        version: 1,
        props: field === undefined ? {} : { field },
      },
    ],
  };
}

function args(
  write: Partial<PluginFieldWrite>,
  data: Record<string, unknown> = { collection: "posts" }
): PluginFieldValidateArgs {
  return {
    data,
    req: {},
    path: "content",
    field: { name: "content", type: "blocks" },
    write: {
      kind: "collection",
      slug: "templates",
      id: "t1",
      inTransaction: false,
      readStored: async () => ({ kind: "absent" }),
      ...write,
    },
  } as unknown as PluginFieldValidateArgs;
}

const templates: TemplateTargets = {
  collection: "templates",
  fields: ["collection", "entryCollection"],
  storedTargetsOf: async () => new Map([["t1", "posts"]]),
};

/** Posts with two blocks fields, Body and Sidebar; Notes with one. */
const blocksFieldsOf: EntryBlocksFieldsReader = async collection =>
  collection === "posts"
    ? {
        label: "Posts",
        fields: [
          { name: "body", label: "Body" },
          { name: "sidebar", label: "Sidebar" },
        ],
      }
    : collection === "notes"
      ? { label: "Notes", fields: [{ name: "text", label: "Text" }] }
      : undefined;

const nothingStored = async (): Promise<StoredForms> => ({
  forms: [],
  readable: true,
});

function judge(
  value: unknown,
  write: Partial<PluginFieldWrite> = {},
  storedForms: () => Promise<StoredForms> = nothingStored,
  data?: Record<string, unknown>
) {
  return newEntryContentIssues(value, args(write, data), "Template", {
    templates,
    blocksFieldsOf,
    storedForms,
  });
}

describe("a template's Entry content field, at save", () => {
  it("takes a top-level blocks field of the collection the template draws (the control)", async () => {
    expect(await judge(templateOf("body"))).toEqual([]);
    // Several blocks fields: the author's choice is kept, whichever it is.
    expect(await judge(templateOf("sidebar"))).toEqual([]);
  });

  it("refuses a field that isn't one of its blocks fields, naming the field and the collection", async () => {
    const issues = await judge(templateOf("summary"));
    expect(issues).toHaveLength(1);
    expect(issues[0]?.code).toBe("ENTRY_CONTENT_FIELD_UNKNOWN");
    expect(issues[0]?.message).toContain('"summary"');
    expect(issues[0]?.message).toContain("Posts");
    expect(issues[0]?.message).toContain("Choose Body or Sidebar.");
  });

  it("refuses a block that names no field, offering the collection's", async () => {
    const issues = await judge(templateOf());
    expect(issues.map(issue => issue.code)).toEqual([
      "ENTRY_CONTENT_FIELD_UNSET",
    ]);
    expect(issues[0]?.message).toContain("Choose Body or Sidebar.");
  });

  it("judges against the collection the stored template draws when the write names none", async () => {
    // No collection carried: the stored one is read, and it is Posts.
    expect(await judge(templateOf("body"), {}, nothingStored, {})).toEqual([]);
    const refused = await judge(templateOf("text"), {}, nothingStored, {});
    expect(refused.map(issue => issue.code)).toEqual([
      "ENTRY_CONTENT_FIELD_UNKNOWN",
    ]);
  });

  it("keeps saving a template whose field was removed since it was stored, keeping its choice", async () => {
    const stored = vi.fn(
      async (): Promise<StoredForms> => ({
        forms: [templateOf("summary")] as never,
        readable: true,
      })
    );
    expect(await judge(templateOf("summary"), {}, stored)).toEqual([]);
    expect(stored).toHaveBeenCalledTimes(1);
    // The control: newly choosing a field the collection lacks is refused,
    // whatever was stored before.
    const changed = await judge(templateOf("summary2"), {}, stored);
    expect(changed.map(issue => issue.code)).toEqual([
      "ENTRY_CONTENT_FIELD_UNKNOWN",
    ]);
  });

  it("judges afresh a template retargeted to another collection, whatever it stored", async () => {
    // Stored as Posts' template choosing Body; now written as Notes', which
    // has no Body. A choice made for another collection is no choice here.
    const stored = async (): Promise<StoredForms> => ({
      forms: [templateOf("body")] as never,
      readable: true,
    });
    const retargeted = await judge(templateOf("body"), {}, stored, {
      collection: "notes",
    });
    expect(retargeted.map(issue => issue.code)).toEqual([
      "ENTRY_CONTENT_FIELD_UNKNOWN",
    ]);
    expect(retargeted[0]?.message).toContain("Notes");
  });

  it("refuses the save when the collection's fields can't be read, and judges them once they can (the control)", async () => {
    const failing: EntryBlocksFieldsReader = () =>
      Promise.reject(new Error("the registry is down"));
    const refused = await newEntryContentIssues(
      templateOf("body"),
      args({}),
      "Template",
      { templates, blocksFieldsOf: failing, storedForms: nothingStored }
    );
    expect(refused.map(issue => issue.code)).toEqual([
      "ENTRY_CONTENT_FIELD_UNCHECKED",
    ]);
    // The same write against a reader that answers is judged, and passes.
    expect(await judge(templateOf("body"))).toEqual([]);
  });

  it("reads the stored forms only once a field is not one of the collection's", async () => {
    const stored = vi.fn(nothingStored);
    await judge(templateOf("body"), {}, stored);
    expect(stored).not.toHaveBeenCalled();
  });
});

describe("Entry content outside the templates collection", () => {
  it("is refused in an entry's own blocks field, whatever kind that field accepts", async () => {
    const issues = await judge(templateOf("body"), {
      slug: "posts",
      id: "p1",
    });
    expect(issues.map(issue => issue.code)).toEqual([
      "ENTRY_CONTENT_OUTSIDE_TEMPLATES",
    ]);
  });

  it("leaves a document of another kind to the engine's own refusal, said once", async () => {
    const page = { ...templateOf("body"), kind: "page" };
    expect(await judge(page, { slug: "pages", id: "p1" })).toEqual([]);
  });
});
