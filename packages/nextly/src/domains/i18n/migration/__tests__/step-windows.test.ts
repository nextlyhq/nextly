/**
 * Where a `--step` budget may end (`filesWithinStep`), read from the files' own headers
 * (`stepFileOf`), as `nextly migrate` and `nextly migrate:down` read them.
 */
import { describe, expect, it } from "vitest";

import { entityHeaderLine } from "../../../schema/migrate-create/format-file";
import { formatLocalizationIntent } from "../migration-intent";
import type { LocalizationMigrationKind } from "../migration-intent";
import { filesWithinStep, stepFileOf, type StepFile } from "../step-windows";
import type { CompanionMigrationSpec } from "../types";

const spec: CompanionMigrationSpec = {
  dialect: "sqlite",
  collection: "docs",
  kind: "collection",
  mainTable: "dc_docs",
  companionTable: "dc_docs_locales",
  defaultLocale: "en",
  parentIdType: "TEXT",
  columns: [{ name: "body", kind: "text" }],
};

/** A companion file of `kind` for docs' `body`, as `migrate:create` heads it. */
const companion = (
  kind: LocalizationMigrationKind
): StepFile & { name: string } => ({
  name: kind,
  ...stepFileOf(
    `${entityHeaderLine("collection", "docs")}\n` +
      `${formatLocalizationIntent({ kind, entity: "collection", spec })}\n\n-- UP\nSELECT 1;\n`,
    `${kind}.sql`
  ),
});

/** A main migration that names `slug` in its header. */
const main = (slug: string): StepFile & { name: string } => ({
  name: `main:${slug}`,
  ...stepFileOf(
    `${entityHeaderLine("collection", slug)}\n\n-- UP\nSELECT 1;\n`,
    "main.sql"
  ),
});

const pending = (files: (StepFile & { name: string })[]) =>
  files.map(file => ({ file, done: false }));
const names = (run: { name: string }[]) => run.map(f => f.name);

describe("filesWithinStep", () => {
  it("goes on through a field leaving translation, from its archive file to its shared file", () => {
    const within = filesWithinStep(
      pending([
        companion("archive"),
        main("docs"),
        companion("shared"),
        main("notes"),
      ]),
      1,
      "up"
    );

    expect(names(within.run)).toEqual(["archive", "main:docs", "shared"]);
    expect(within.continued).toBe('"body" in collection "docs"');
  });

  it("goes on through a field joining translation, from its joins file to the main file", () => {
    const within = filesWithinStep(
      pending([companion("joins"), main("docs"), main("notes")]),
      1,
      "up"
    );

    expect(names(within.run)).toEqual(["joins", "main:docs"]);
  });

  it("finishes a move an earlier run left open", () => {
    const within = filesWithinStep(
      [
        { file: companion("archive"), done: true },
        { file: main("docs"), done: true },
        { file: companion("shared"), done: false },
        { file: main("notes"), done: false },
      ],
      1,
      "up"
    );

    expect(names(within.run)).toEqual(["shared"]);
  });

  it("rolls back through a field leaving translation, from its shared file to the main file", () => {
    // Newest first, as `migrate:down` takes them.
    const within = filesWithinStep(
      pending([companion("shared"), main("docs"), companion("archive")]),
      1,
      "down"
    );

    expect(names(within.run)).toEqual(["shared", "main:docs"]);
    expect(within.continued).toBe('"body" in collection "docs"');
  });

  it("keeps to the step outside a move, and where nothing closes the move", () => {
    expect(
      names(
        filesWithinStep(pending([main("docs"), main("notes")]), 1, "up").run
      )
    ).toEqual(["main:docs"]);
    // An archive file whose shared file is not among the files keeps no run going.
    expect(
      names(
        filesWithinStep(
          pending([companion("archive"), main("docs"), main("notes")]),
          1,
          "up"
        ).run
      )
    ).toEqual(["archive"]);
    // A main file for another entity does not close docs' move.
    expect(
      names(
        filesWithinStep(
          pending([companion("joins"), main("notes"), main("docs")]),
          1,
          "up"
        ).run
      )
    ).toEqual(["joins", "main:notes", "main:docs"]);
  });

  it("takes every pending file with no step", () => {
    expect(
      filesWithinStep(pending([main("docs"), main("notes")]), undefined, "up")
        .run
    ).toHaveLength(2);
  });
});
