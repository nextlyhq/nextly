/**
 * A collection whose entries are files: the fields it gains for each file,
 * who may write and read them, and the rules its `files` option is judged by,
 * both when `defineCollection` is called and when the configuration starts.
 *
 * The plausible broken implementations these separate it from: the file's
 * fields added but writable by a caller (one could mark an unchecked upload
 * ready, or point it at another file's bytes), the storage key readable, an
 * author's field allowed to replace a system one, and a `files` option that
 * is judged so loosely that a type a browser would run, a wildcard, or a
 * public read rule gets through. Each refusal is paired with the accepted
 * form, so a validator that refused everything would fail too.
 */
import { describe, expect, it } from "vitest";

import { configurationProblems } from "../../../shared/lib/config-problems";
import { text } from "../../fields/helpers";
import type { FieldConfig } from "../../fields/types";
import {
  fileSystemFields,
  filesProblems,
  resolveFilesPolicy,
  type CollectionFilesConfig,
} from "../collection-files";
import { defineCollection, type CollectionConfig } from "../define-collection";
import { validateCollectionConfig } from "../validate-config";

const FILES: CollectionFilesConfig = {
  visibility: "private",
  accept: ["application/pdf", "image/png"],
  maxSize: 10 * 1024 * 1024,
};

const FILE_FIELDS = [
  "filename",
  "mimeType",
  "size",
  "sha256",
  "storageKey",
  "fileStatus",
  "rejectReason",
  "uploadedByKind",
  "uploadedById",
];

function fieldNamed(collection: CollectionConfig, name: string): FieldConfig {
  const field = collection.fields.find(
    candidate => (candidate as { name?: string }).name === name
  );
  if (field === undefined) throw new Error(`no field ${name}`);
  return field;
}

/** The `FILES_INVALID` problems of `config`, by path. */
function filesErrors(config: Record<string, unknown>): string[] {
  return validateCollectionConfig({
    slug: "contracts",
    fields: [...fileSystemFields(), text({ name: "note" })],
    ...config,
  } as unknown as CollectionConfig)
    .errors.filter(error => error.code === "FILES_INVALID")
    .map(error => error.path);
}

describe("defineCollection with files", () => {
  it("adds each file's fields after title and slug, before the author's", () => {
    const contracts = defineCollection({
      slug: "contracts",
      files: FILES,
      fields: [text({ name: "note" })],
    });
    expect(
      contracts.fields.map(field => (field as { name?: string }).name)
    ).toEqual(["title", "slug", ...FILE_FIELDS, "note"]);

    // Control: without files, nothing is added beyond title and slug.
    const notes = defineCollection({
      slug: "notes",
      fields: [text({ name: "note" })],
    });
    expect(
      notes.fields.map(field => (field as { name?: string }).name)
    ).toEqual(["title", "slug", "note"]);
  });

  it("lets no caller write a file's fields, and withholds only the storage key from reads", () => {
    const contracts = defineCollection({
      slug: "contracts",
      files: FILES,
      fields: [text({ name: "note" })],
    });
    for (const name of FILE_FIELDS) {
      const { access } = fieldNamed(contracts, name);
      expect(access?.create, name).toBe(false);
      expect(access?.update, name).toBe(false);
      expect(access?.read, name).toBe(
        name === "storageKey" ? false : undefined
      );
    }
    // The author's own field keeps its own access.
    expect(fieldNamed(contracts, "note").access).toBeUndefined();
  });

  it("starts each file pending", () => {
    const contracts = defineCollection({
      slug: "contracts",
      files: FILES,
      fields: [],
    });
    const status = fieldNamed(contracts, "fileStatus") as FieldConfig & {
      options: Array<{ value: string }>;
      defaultValue?: unknown;
    };
    expect(status.options.map(option => option.value)).toEqual([
      "pending",
      "ready",
      "rejected",
    ]);
    expect(status.defaultValue).toBe("pending");
  });

  it("hides the collection in the admin unless told otherwise", () => {
    expect(
      defineCollection({ slug: "contracts", files: FILES, fields: [] }).admin
        ?.hidden
    ).toBe(true);
    expect(
      defineCollection({
        slug: "contracts",
        files: FILES,
        admin: { hidden: false },
        fields: [],
      }).admin?.hidden
    ).toBe(false);
    // Control: an ordinary collection is not hidden.
    expect(
      defineCollection({ slug: "notes", fields: [] }).admin?.hidden
    ).toBeUndefined();
  });
});

describe("the files option is judged", () => {
  it("fills in the policy's defaults, and keeps what is set", () => {
    expect(resolveFilesPolicy(FILES)).toEqual({
      accept: FILES.accept,
      maxSize: FILES.maxSize,
      delivery: "stream",
      pendingTimeout: 3600,
      principals: [],
    });
    expect(
      resolveFilesPolicy({
        ...FILES,
        delivery: "redirect",
        pendingTimeout: 600,
        principals: ["accounts:account"],
      })
    ).toMatchObject({
      delivery: "redirect",
      pendingTimeout: 600,
      principals: ["accounts:account"],
    });
  });

  it("accepts a well-formed option, and one with every setting", () => {
    expect(filesErrors({ files: FILES })).toEqual([]);
    expect(
      filesErrors({
        files: {
          ...FILES,
          delivery: "redirect",
          pendingTimeout: 600,
          principals: ["accounts:account", "nextlyhq-plugin-accounts:account"],
        },
      })
    ).toEqual([]);
    expect(
      filesErrors({ files: { ...FILES, maxSize: 2_147_483_647 } })
    ).toEqual([]);
  });

  it.each([
    ["not an object", "yes", "files"],
    ["an unknown option", { ...FILES, public: true }, "files.public"],
    [
      "a visibility other than private",
      { ...FILES, visibility: "public" },
      "files.visibility",
    ],
    ["no accepted type", { ...FILES, accept: [] }, "files.accept"],
    ["a wildcard type", { ...FILES, accept: ["image/*"] }, "files.accept[0]"],
    [
      "a type with parameters",
      { ...FILES, accept: ["text/plain; charset=utf-8"] },
      "files.accept[0]",
    ],
    [
      "an uppercase type",
      { ...FILES, accept: ["Application/PDF"] },
      "files.accept[0]",
    ],
    [
      "a type a browser runs as a page",
      { ...FILES, accept: ["application/pdf", "text/html"] },
      "files.accept[1]",
    ],
    ["SVG", { ...FILES, accept: ["image/svg+xml"] }, "files.accept[0]"],
    ["a size of zero", { ...FILES, maxSize: 0 }, "files.maxSize"],
    ["a size that is not whole", { ...FILES, maxSize: 1.5 }, "files.maxSize"],
    ["a size given as text", { ...FILES, maxSize: "10mb" }, "files.maxSize"],
    [
      "a size larger than the size column holds",
      { ...FILES, maxSize: 2_147_483_648 },
      "files.maxSize",
    ],
    ["an unknown delivery", { ...FILES, delivery: "inline" }, "files.delivery"],
    [
      "too short a wait for a confirm",
      { ...FILES, pendingTimeout: 30 },
      "files.pendingTimeout",
    ],
    [
      "kinds of person not in a list",
      { ...FILES, principals: "accounts:account" },
      "files.principals",
    ],
    [
      "a kind of person not written <plugin>:<name>",
      { ...FILES, principals: ["account"] },
      "files.principals[0]",
    ],
  ])("refuses %s", (_label, files, path) => {
    expect(filesErrors({ files })).toEqual([path]);
  });

  it.each([
    ["drafts", { status: true }, "status"],
    ["versions", { versions: true }, "versions"],
    ["localization", { localized: true }, "localized"],
    ["timestamps turned off", { timestamps: false }, "timestamps"],
    ["a public address", { publicAddress: "/files/{slug}" }, "publicAddress"],
    ["a read rule open to everyone", { access: { read: true } }, "access.read"],
  ])("refuses a collection with files and %s", (_label, setting, path) => {
    expect(filesErrors({ files: FILES, ...setting })).toContain(path);
    // Control: the same setting without files is no files problem.
    expect(filesErrors(setting)).toEqual([]);
  });

  it("leaves a read rule that decides per caller alone", () => {
    expect(
      filesErrors({ files: FILES, access: { read: () => false } })
    ).toEqual([]);
  });

  it("refuses a collection with files written as a plain object, which lacks the file's fields", () => {
    expect(
      filesProblems({
        files: FILES,
        fields: [{ type: "text", name: "note" }],
      }).map(p => p.path)
    ).toEqual(["fields"]);
    expect(filesProblems({ files: FILES, fields: fileSystemFields() })).toEqual(
      []
    );
  });
});

describe("an author's field taking a file field's name", () => {
  const withOwnKey = () =>
    defineCollection({
      slug: "contracts",
      files: FILES,
      fields: [text({ name: "storageKey", access: { read: true } })],
    });

  it("is refused when the configuration starts", () => {
    const problems = configurationProblems({ collections: [withOwnKey()] });
    expect(problems.map(problem => problem.code)).toContain(
      "FIELD_NAME_DUPLICATE"
    );
    // Control: the same collection without the clash has no problem.
    const clean = defineCollection({
      slug: "contracts",
      files: FILES,
      fields: [text({ name: "note" })],
    });
    expect(configurationProblems({ collections: [clean] })).toEqual([]);
  });
});
