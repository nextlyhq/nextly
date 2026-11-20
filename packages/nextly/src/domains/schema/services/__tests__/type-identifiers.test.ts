/**
 * Every identifier the generators write is valid TypeScript, whatever the
 * slug it is made from: hyphens and underscores, digits (a leading one
 * included), a space, and a word TypeScript reserves.
 *
 * Judged by the TypeScript compiler itself, through its command line: each
 * generated file is compiled and must carry no syntax error (codes 1000 to
 * 1999), so an identifier the generators get wrong is caught whatever shape
 * the mistake takes. Type errors are not asked: a file on its own cannot
 * resolve the `nextly` module it imports.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { compile } from "../../../../../../../scripts/tsc-cli.mjs";
import type { DynamicCollectionRecord } from "../../../../schemas/dynamic-collections/types";
import { TypeGenerator } from "../type-generator";
import { ZodGenerator } from "../zod-generator";

/** A collection with one text field under `slug`. */
const collection = (slug: string) =>
  ({
    slug,
    labels: { singular: "Item", plural: "Items" },
    fields: [{ name: "title", type: "text", required: true }],
    timestamps: true,
  }) as unknown as DynamicCollectionRecord;

/**
 * Slugs a site can have, or a generator can be handed: hyphens and
 * underscores, digits, a leading digit, a space, and reserved words.
 */
const SLUGS = [
  "blog-posts",
  "blog_posts_2",
  "2fa-codes",
  "404",
  "blog posts",
  "class",
  "delete",
  "enum-values",
];

/** Each generated file, by a name of its own, and the syntax errors in it. */
const files = new Map<string, string>();
const syntaxErrors = new Map<string, string[]>();
let dir = "";

const typesFile = (index: number) => `types-${index}.ts`;
const zodFile = (index: number) => `zod-${index}.ts`;
const ALL_FILE = "types-all.ts";

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "nextly-identifiers-"));
  SLUGS.forEach((slug, index) => {
    files.set(
      typesFile(index),
      new TypeGenerator().generateTypesFile([collection(slug)]).code
    );
    files.set(
      zodFile(index),
      new ZodGenerator().generateSchema(collection(slug)).code
    );
  });
  files.set(
    ALL_FILE,
    new TypeGenerator().generateTypesFile(
      SLUGS.filter(slug => slug !== "blog posts").map(collection)
    ).code
  );
  for (const [name, code] of files) writeFileSync(join(dir, name), code);
  // One compiler run over every file: the command line is slow to start.
  const diagnostics = compile(
    [
      "--target",
      "es2022",
      "--module",
      "esnext",
      "--moduleResolution",
      "bundler",
      "--skipLibCheck",
      ...files.keys(),
    ],
    dir
  ) as Array<{ file?: string; code: string; message: string }>;
  for (const diagnostic of diagnostics) {
    if (!/^(TS)?1\d{3}$/.test(diagnostic.code)) continue;
    const name = (diagnostic.file ?? "").split("/").at(-1) ?? "";
    syntaxErrors.set(name, [
      ...(syntaxErrors.get(name) ?? []),
      `${diagnostic.code} ${diagnostic.message}`,
    ]);
  }
}, 120_000);

afterAll(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe("generated identifiers, whatever the slug", () => {
  it.each(SLUGS.map((slug, index) => [slug, index] as const))(
    "the types file for a collection `%s` has no syntax error",
    (_slug, index) => {
      expect(syntaxErrors.get(typesFile(index)) ?? []).toEqual([]);
    }
  );

  it.each(SLUGS.map((slug, index) => [slug, index] as const))(
    "the Zod schemas for a collection `%s` have no syntax error",
    (_slug, index) => {
      expect(syntaxErrors.get(zodFile(index)) ?? []).toEqual([]);
    }
  );

  it("has no syntax error with every slug in one types file", () => {
    // Distinct slugs stay distinct names: one file holding them all compiles.
    expect(syntaxErrors.get(ALL_FILE) ?? []).toEqual([]);
  });

  it("the compiler was asked about every file", () => {
    // The control: a run that read none of them would report no error.
    expect(files.size).toBe(SLUGS.length * 2 + 1);
  });
});
