/**
 * The picker's fields: only what the person editing may read, marked by
 * whether visitors may, previewed as the person reads it, with a draft's
 * value marked rather than shown.
 */
import type { BindingFieldShape } from "@nextlyhq/blocks-engine";
import { describe, expect, it, vi } from "vitest";

import type {
  BindingFieldsResponse,
  PickerField,
} from "./binding-fields-contract";
import {
  readBindingFields,
  type BindingFieldsReads,
  type FieldsRef,
} from "./binding-fields-route";

const DECLARED: Readonly<Record<string, readonly BindingFieldShape[]>> = {
  "collection:posts": [
    { name: "title", type: "text" },
    { name: "internalNote", type: "text" },
    // Declared, but hidden from this editor by a field rule.
    { name: "cost", type: "number" },
    { name: "author", type: "relationship", relationTo: "users" },
    // Visitors may not follow it, though they may read the user it names.
    { name: "reviewer", type: "relationship", relationTo: "users" },
    { name: "meta", type: "group", fields: [{ name: "lede", type: "text" }] },
    { name: "createdAt", type: "date" },
  ],
  "collection:users": [
    { name: "name", type: "text" },
    { name: "email", type: "text" },
  ],
  "single:contact": [{ name: "phone", type: "text" }],
  "single:payroll": [{ name: "account", type: "text" }],
  // Readable by the author, by no visitor: a plugin's own settings.
  "single:settings": [{ name: "apiMode", type: "text" }],
};

/** As the editor reads: `cost` and `email` hidden, `payroll` refused. */
const AS_EDITOR: Readonly<Record<string, Record<string, unknown> | null>> = {
  "posts:p1": {
    title: "Spring sale",
    internalNote: "Check stock first",
    author: "u1",
    reviewer: "u1",
    meta: { lede: "Thirty per cent off (draft)" },
    createdAt: "2026-03-01T09:00:00.000Z",
  },
  "users:u1": { name: "Ada Lovelace" },
  contact: { phone: "+44 20 7946 0000" },
  payroll: null,
  settings: { apiMode: "live" },
};

/** As published: the lede's draft not yet out. */
const PUBLISHED: Readonly<Record<string, Record<string, unknown> | null>> = {
  "posts:p1": {
    title: "Spring sale",
    author: "u1",
    meta: { lede: "Thirty per cent off" },
    createdAt: "2026-03-01T09:00:00.000Z",
  },
  "users:u1": { name: "Ada Lovelace" },
  contact: { phone: "+44 20 7946 0000" },
  payroll: null,
};

const PUBLIC: Readonly<Record<string, readonly BindingFieldShape[]>> = {
  "collection:posts": [
    { name: "title", type: "text" },
    { name: "author", type: "relationship", relationTo: "users" },
    { name: "meta", type: "group", fields: [{ name: "lede", type: "text" }] },
  ],
  "collection:users": [{ name: "name", type: "text" }],
  "single:contact": [{ name: "phone", type: "text" }],
};

const keyOf = (ref: { collection: string } | { single: string }) =>
  "collection" in ref ? `collection:${ref.collection}` : `single:${ref.single}`;
const rowKey = (ref: FieldsRef) =>
  "single" in ref ? ref.single : `${ref.collection}:${ref.id}`;

function reads(): BindingFieldsReads {
  return {
    declared: async ref => DECLARED[keyOf(ref)],
    // None for a source no visitor may read; a list, even empty, otherwise.
    publicShapes: async ref => PUBLIC[keyOf(ref)],
    asEditor: vi.fn(async (ref: FieldsRef) => AS_EDITOR[rowKey(ref)] ?? null),
    published: async ref => PUBLISHED[rowKey(ref)] ?? null,
    singles: async () => [
      { slug: "contact", label: "Contact details" },
      { slug: "payroll", label: "Payroll" },
      { slug: "settings", label: "Settings" },
    ],
    collectionLabel: async () => "Post",
    site: async () => ({ applicationName: "Northwind Academy" }),
  };
}

const ask = (id?: string) =>
  readBindingFields(
    {
      source: {
        kind: "collection",
        slug: "posts",
        ...(id === undefined ? {} : { id }),
      },
    },
    reads()
  );

const fieldsOf = (answer: BindingFieldsResponse, label: string) =>
  answer.sources.find(source => source.label === label)?.fields ?? [];
const named = (fields: readonly PickerField[], name: string) =>
  fields.find(field => field.name === name);

describe("the picker's fields", () => {
  it("lists the entry, the Singles the editor may read, then the site", async () => {
    const answer = await ask("p1");
    expect(answer.sources.map(source => source.binding)).toEqual([
      { source: "entry" },
      { source: "single", sourceKey: "contact" },
      { source: "site" },
    ]);
  });

  it("never shows a Single the editor may not read, not even its name", async () => {
    const answer = await ask("p1");
    expect(JSON.stringify(answer)).not.toContain("payroll");
    expect(JSON.stringify(answer)).not.toContain("account");
  });

  it("leaves out a field the editor's rules hide, rather than showing it empty", async () => {
    const post = fieldsOf(await ask("p1"), "Post");
    expect(post.map(field => field.name)).toEqual([
      "title",
      "internalNote",
      "author",
      "reviewer",
      "meta",
      "createdAt",
    ]);
    expect(named(named(post, "author")?.fields ?? [], "email")).toBeUndefined();
  });

  it("marks a field visitors can't read, and shows no value for it", async () => {
    const note = named(fieldsOf(await ask("p1"), "Post"), "internalNote");
    expect(note).toMatchObject({ public: false });
    expect(note?.preview).toBeUndefined();
  });

  it("previews a published value, and marks a draft's instead of showing it", async () => {
    const post = fieldsOf(await ask("p1"), "Post");
    expect(named(post, "title")).toMatchObject({
      public: true,
      preview: "Spring sale",
    });
    const lede = named(named(post, "meta")?.fields ?? [], "lede");
    expect(lede).toMatchObject({ public: true, draft: true });
    expect(lede?.preview).toBeUndefined();
  });

  it("follows a relation one step in, as the entry it names is read", async () => {
    const author = named(fieldsOf(await ask("p1"), "Post"), "author");
    expect(author?.fields).toEqual([
      { name: "name", type: "text", public: true, preview: "Ada Lovelace" },
    ]);
  });

  it("lists the Singles and the site for a document with no entry of its own", async () => {
    // A component's document, which reads each placing page's entry.
    const answer = await readBindingFields({}, reads());
    expect(answer.sources.map(source => source.binding.source)).toEqual([
      "single",
      "site",
    ]);
  });

  it("lists no entry's fields where there is no entry to read", async () => {
    const answer = await ask();
    expect(answer.sources.map(source => source.binding.source)).toEqual([
      "single",
      "site",
    ]);
  });

  it("previews the site settings as every visitor sees them", async () => {
    const site = fieldsOf(await ask("p1"), "Site");
    expect(named(site, "applicationName")).toEqual({
      name: "applicationName",
      type: "text",
      label: "Application name",
      public: true,
      preview: "Northwind Academy",
    });
    // Named as the settings screen names them.
    expect(site.map(field => field.label)).toEqual([
      "Application name",
      "Site URL",
      "Logo URL",
      "Time zone",
    ]);
  });

  it("marks a relation's fields as visitors reach them, through the relation", async () => {
    const post = fieldsOf(await ask("p1"), "Post");
    // The reviewer's user is public, but visitors can't follow the reviewer.
    expect(named(named(post, "reviewer")?.fields ?? [], "name")).toEqual({
      name: "name",
      type: "text",
      public: false,
    });
  });

  it("carries the relation's visibility into a group's fields, every level down", async () => {
    const base = reads();
    const answer = await readBindingFields(
      { source: { kind: "collection", slug: "posts", id: "p1" } },
      {
        ...base,
        // The reviewer's user has a profile group; visitors could read it,
        // but not through the reviewer.
        declared: async ref =>
          "collection" in ref && ref.collection === "users"
            ? [
                { name: "name", type: "text" },
                {
                  name: "profile",
                  type: "group",
                  fields: [{ name: "bio", type: "text" }],
                },
              ]
            : base.declared(ref),
        publicShapes: async ref =>
          "collection" in ref && ref.collection === "users"
            ? [
                { name: "name", type: "text" },
                {
                  name: "profile",
                  type: "group",
                  fields: [{ name: "bio", type: "text" }],
                },
              ]
            : base.publicShapes(ref),
        asEditor: async (ref, select) =>
          "collection" in ref && ref.collection === "users"
            ? { name: "Ada Lovelace", profile: { bio: "Mathematician" } }
            : base.asEditor(ref, select),
        published: async (ref, select) =>
          "collection" in ref && ref.collection === "users"
            ? { name: "Ada Lovelace", profile: { bio: "Mathematician" } }
            : base.published(ref, select),
      }
    );
    const profile = named(
      named(fieldsOf(answer, "Post"), "reviewer")?.fields ?? [],
      "profile"
    );
    expect(named(profile?.fields ?? [], "bio")).toEqual({
      name: "bio",
      type: "text",
      public: false,
    });
  });

  it("marks a relation's fields a draft's where the relation names another entry", async () => {
    const answer = await readBindingFields(
      { source: { kind: "collection", slug: "posts", id: "p1" } },
      {
        ...reads(),
        // Published, the post names no author yet.
        published: async ref =>
          rowKey(ref) === "posts:p1"
            ? { ...PUBLISHED["posts:p1"], author: null }
            : (PUBLISHED[rowKey(ref)] ?? null),
      }
    );
    const name = named(
      named(fieldsOf(answer, "Post"), "author")?.fields ?? [],
      "name"
    );
    expect(name).toMatchObject({ public: true, draft: true });
    expect(name?.preview).toBeUndefined();
  });

  it("counts the timestamps public where visitors may read the entry", async () => {
    expect(named(fieldsOf(await ask("p1"), "Post"), "createdAt")).toMatchObject(
      {
        public: true,
      }
    );
  });

  it("counts a public Single's timestamps public, though it has no public field", async () => {
    const base = reads();
    const answer = await readBindingFields(
      { source: { kind: "collection", slug: "posts", id: "p1" } },
      {
        ...base,
        singles: async () => [{ slug: "news", label: "News" }],
        declared: async ref =>
          "single" in ref && ref.single === "news"
            ? [{ name: "updatedAt", type: "date" }]
            : base.declared(ref),
        // Readable by visitors, with no custom field they read.
        publicShapes: async ref =>
          "single" in ref && ref.single === "news"
            ? []
            : base.publicShapes(ref),
        asEditor: async (ref, select) =>
          "single" in ref && ref.single === "news"
            ? { updatedAt: "2026-03-02T10:00:00.000Z" }
            : base.asEditor(ref, select),
        published: async (ref, select) =>
          "single" in ref && ref.single === "news"
            ? { updatedAt: "2026-03-02T10:00:00.000Z" }
            : base.published(ref, select),
      }
    );
    expect(named(fieldsOf(answer, "News"), "updatedAt")).toMatchObject({
      public: true,
    });
  });

  it("leaves out a Single no visitor may read any of", async () => {
    const answer = await ask("p1");
    expect(answer.sources.some(source => source.label === "Settings")).toBe(
      false
    );
  });

  it("names a Single's own entry by the Single's label", async () => {
    const answer = await readBindingFields(
      { source: { kind: "single", slug: "contact" } },
      reads()
    );
    expect(answer.sources[0]).toMatchObject({
      binding: { source: "entry" },
      label: "Contact details",
    });
  });

  it("names a source whose read fails for a reason but access, and lists the rest", async () => {
    const answer = await readBindingFields(
      { source: { kind: "collection", slug: "posts", id: "p1" } },
      {
        ...reads(),
        asEditor: async (ref, select) => {
          if ("single" in ref && ref.single === "contact") {
            throw new Error("connection reset");
          }
          return reads().asEditor(ref, select);
        },
      }
    );
    // The failing Single is named, with nothing to bind, and said to have
    // failed; the entry and the site still list.
    expect(
      answer.sources.find(source => source.label === "Contact details")
    ).toEqual({
      binding: { source: "single", sourceKey: "contact" },
      label: "Contact details",
      fields: [],
      readFailed: true,
    });
    expect(named(fieldsOf(answer, "Post"), "title")?.preview).toBe(
      "Spring sale"
    );
    expect(answer.sources.at(-1)?.binding).toEqual({ source: "site" });
    // Refused is not failed: the payroll Single is still not named at all.
    expect(JSON.stringify(answer)).not.toContain("payroll");
  });
});
