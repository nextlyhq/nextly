/**
 * The picker's fields: only what the person editing may read, marked by
 * whether visitors may, previewed as the person reads it, with a draft's
 * value marked rather than shown.
 */
import type { BindingFieldShape } from "@nextlyhq/blocks-engine";
import { describe, expect, it, vi } from "vitest";

import type { BindingFieldsResponse, PickerField } from "./binding-fields-contract";
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
    { name: "meta", type: "group", fields: [{ name: "lede", type: "text" }] },
  ],
  "collection:users": [
    { name: "name", type: "text" },
    { name: "email", type: "text" },
  ],
  "single:contact": [{ name: "phone", type: "text" }],
  "single:payroll": [{ name: "account", type: "text" }],
};

/** As the editor reads: `cost` and `email` hidden, `payroll` refused. */
const AS_EDITOR: Readonly<Record<string, Record<string, unknown> | null>> = {
  "posts:p1": {
    title: "Spring sale",
    internalNote: "Check stock first",
    author: "u1",
    meta: { lede: "Thirty per cent off (draft)" },
  },
  "users:u1": { name: "Ada Lovelace" },
  contact: { phone: "+44 20 7946 0000" },
  payroll: null,
};

/** As published: the lede's draft not yet out. */
const PUBLISHED: Readonly<Record<string, Record<string, unknown> | null>> = {
  "posts:p1": {
    title: "Spring sale",
    author: "u1",
    meta: { lede: "Thirty per cent off" },
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
    publicShapes: async ref => PUBLIC[keyOf(ref)] ?? [],
    asEditor: vi.fn(async (ref: FieldsRef) => AS_EDITOR[rowKey(ref)] ?? null),
    published: async ref => PUBLISHED[rowKey(ref)] ?? null,
    singles: async () => [
      { slug: "contact", label: "Contact details" },
      { slug: "payroll", label: "Payroll" },
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
      "meta",
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
      public: true,
      preview: "Northwind Academy",
    });
  });
});
