// F11 PR 3: format-file tests.

import { describe, expect, it } from "vitest";

import {
  ENTITY_HEADER_GUIDANCE,
  FIELD_GROUP_HEADER_PATTERN,
  formatBlankFile,
  parseEntityHeaders,
  SCOPED_ENTITIES_MARKER,
  formatMigrationFile,
  formatTimestamp,
  slugify,
} from "../format-file";

describe("formatMigrationFile", () => {
  const NOW = new Date("2026-04-29T15:45:00.123Z");

  it("emits header with collections + dialect + UP body", () => {
    const out = formatMigrationFile({
      name: "add_excerpt",
      dialect: "postgresql",
      sqlStatements: ['ALTER TABLE "dc_posts" ADD COLUMN "excerpt" text'],
      downSqlStatements: [],
      collections: ["posts"],
      singles: [],
      components: [],
      hasUserExt: false,
      now: NOW,
    });
    expect(out).toContain("-- Migration: add_excerpt");
    expect(out).toContain("-- Collections: posts");
    expect(out).toContain("-- Generated at: 2026-04-29T15:45:00.123Z");
    expect(out).toContain("-- Dialect: PostgreSQL");
    expect(out).toContain("-- UP");
    expect(out).toContain('ALTER TABLE "dc_posts" ADD COLUMN "excerpt" text;');
  });

  it("emits a -- DOWN section with the down statements, after -- UP", () => {
    const out = formatMigrationFile({
      name: "add_slug",
      dialect: "postgresql",
      sqlStatements: ['ALTER TABLE "dc_posts" ADD COLUMN "slug" text'],
      downSqlStatements: ['ALTER TABLE "dc_posts" DROP COLUMN "slug"'],
      collections: ["posts"],
      singles: [],
      components: [],
      hasUserExt: false,
      now: NOW,
    });
    expect(out).toContain("-- UP");
    expect(out).toContain("-- DOWN");
    expect(out.indexOf("-- UP")).toBeLessThan(out.indexOf("-- DOWN"));
    expect(out).toContain('ALTER TABLE "dc_posts" DROP COLUMN "slug";');
  });

  it("emits a placeholder -- DOWN when there are no down statements", () => {
    const out = formatMigrationFile({
      name: "data_only",
      dialect: "postgresql",
      sqlStatements: ["INSERT INTO dc_posts (id) VALUES ('x')"],
      downSqlStatements: [],
      collections: ["posts"],
      singles: [],
      components: [],
      hasUserExt: false,
      now: NOW,
    });
    expect(out).toContain("-- DOWN");
    expect(out).toContain("no automatic down");
  });

  it("appends `;` to each SQL statement", () => {
    const out = formatMigrationFile({
      name: "two_statements",
      dialect: "postgresql",
      sqlStatements: [
        'ALTER TABLE "dc_posts" ADD COLUMN "a" text',
        'ALTER TABLE "dc_posts" ADD COLUMN "b" text',
      ],
      downSqlStatements: [],
      collections: ["posts"],
      singles: [],
      components: [],
      hasUserExt: false,
      now: NOW,
    });
    // Two UP statements → two semicolons; the empty-down placeholder is a
    // comment and contributes none.
    const matches = out.match(/;/g);
    expect(matches?.length).toBe(2);
  });

  it("omits empty collection / single / component lines", () => {
    const out = formatMigrationFile({
      name: "no_metadata",
      dialect: "mysql",
      sqlStatements: ["SELECT 1"],
      downSqlStatements: [],
      collections: [],
      singles: [],
      components: [],
      hasUserExt: false,
      now: NOW,
    });
    expect(out).not.toContain("-- Collections:");
    expect(out).not.toContain("-- Singles:");
    expect(out).not.toContain("-- Components:");
    expect(out).not.toContain("-- UserExt:");
  });

  it("includes UserExt line when hasUserExt=true", () => {
    const out = formatMigrationFile({
      name: "user_ext_change",
      dialect: "postgresql",
      sqlStatements: ['ALTER TABLE "user_ext" ADD COLUMN "bio" text'],
      downSqlStatements: [],
      collections: [],
      singles: [],
      components: [],
      hasUserExt: true,
      now: NOW,
    });
    expect(out).toContain("-- UserExt: user_ext");
  });

  it("comma-separates multiple collections", () => {
    const out = formatMigrationFile({
      name: "multi",
      dialect: "postgresql",
      sqlStatements: ["SELECT 1"],
      downSqlStatements: [],
      collections: ["posts", "comments"],
      singles: [],
      components: [],
      hasUserExt: false,
      now: NOW,
    });
    expect(out).toContain("-- Collections: posts, comments");
  });
});

describe("formatBlankFile", () => {
  it("emits a -- UP section and a -- DOWN placeholder, no body", () => {
    const out = formatBlankFile(
      "custom_seed",
      "postgresql",
      new Date("2026-04-29T00:00:00Z")
    );
    expect(out).toContain("-- UP");
    expect(out).toContain("-- DOWN");
    expect(out).toContain("-- Migration: custom_seed");
    expect(out).toContain("-- Dialect: PostgreSQL");
  });
});

describe("formatTimestamp", () => {
  it("matches YYYYMMDD_HHMMSS_mmm pattern", () => {
    const t = formatTimestamp(new Date("2026-04-29T15:45:00.123Z"));
    expect(t).toBe("20260429_154500_123");
  });

  it("zero-pads single-digit components", () => {
    const t = formatTimestamp(new Date("2026-01-02T03:04:05.006Z"));
    expect(t).toBe("20260102_030405_006");
  });
});

describe("slugify", () => {
  it("lowercases", () => {
    expect(slugify("AddExcerpt")).toBe("addexcerpt");
  });

  it("collapses non-alphanumeric runs to single underscore", () => {
    expect(slugify("rename: title -> name")).toBe("rename_title_name");
  });

  it("trims leading/trailing underscores", () => {
    expect(slugify("__hello__")).toBe("hello");
  });

  it("handles empty input", () => {
    expect(slugify("")).toBe("");
  });
});

describe("field-group header", () => {
  const args = (components: string[]) => ({
    name: "add_hero",
    dialect: "postgresql" as const,
    sqlStatements: ['ALTER TABLE "dc_posts" ADD COLUMN "hero" jsonb'],
    downSqlStatements: [],
    collections: ["posts"],
    singles: [],
    components,
    hasUserExt: false,
    now: new Date("2026-04-29T15:45:00.123Z"),
  });

  it("writes the current vocabulary, not the pre-rename one", () => {
    const out = formatMigrationFile(args(["hero", "seo"]));
    expect(out).toContain("-- Field groups: hero, seo");
    expect(out).not.toContain("-- Components:");
  });

  it("reads back a file it just wrote", () => {
    const out = formatMigrationFile(args(["hero", "seo"]));
    expect(out.match(FIELD_GROUP_HEADER_PATTERN)?.[1]).toBe("hero, seo");
  });

  it("still reads the legacy headers, which remain on disk forever", () => {
    // Files generated before the rename are never rewritten. A reader that knew only the
    // current header would report those migrations as touching no field groups, silently.
    expect(
      "-- Components: hero, seo".match(FIELD_GROUP_HEADER_PATTERN)?.[1]
    ).toBe("hero, seo");
    expect("-- Component: hero".match(FIELD_GROUP_HEADER_PATTERN)?.[1]).toBe(
      "hero"
    );
  });

  it("does not match a different header", () => {
    expect(
      "-- Collections: posts".match(FIELD_GROUP_HEADER_PATTERN)
    ).toBeNull();
  });
});

/*
 * 🔴 A blank migration carries arbitrary hand-written SQL, so the tool cannot
 * know which entities it changes — and `nextly migrate` reads exactly that to
 * decide which registry rows are still waiting. Without the line, an entity the
 * migration alters is recorded as migrated once its old table exists. The
 * template asks for it, because the remedy is one line and nothing else can
 * supply it.
 */
describe("the blank template asks for an entity header", () => {
  it("tells the author how to name what the migration changes", () => {
    const out = formatBlankFile(
      "custom_thing",
      "postgresql",
      new Date("2026-04-29T15:45:00.123Z")
    );

    expect(out).toContain("-- Collections: posts");
    expect(out).toContain("-- Singles: home");
    expect(out).toContain("-- Field groups: hero");
  });

  it("leaves them as guidance, not as a header the parser would read", () => {
    // The lines are examples inside a comment block. If they parsed as real
    // headers, every blank migration would claim to change `posts`.
    const out = formatBlankFile(
      "custom_thing",
      "postgresql",
      new Date("2026-04-29T15:45:00.123Z")
    );

    expect(parseEntityHeaders(out).collections).toEqual([]);
    expect(parseEntityHeaders(out).singles).toEqual([]);
    expect(parseEntityHeaders(out).components).toEqual([]);
  });
});

/*
 * 🔴 The remediation has to WORK. The scope marker decides whether a header is
 * read as ownership, so a blank file that lacks it discards any slug the
 * operator adds — the provenance gate rejecting precisely the annotation the
 * template asks for, silently. The template therefore ships the marker, and an
 * operator who follows it only has to name the entity.
 */
describe("following the blank template's instruction actually annotates the file", () => {
  const blank = (): string =>
    formatBlankFile(
      "custom_thing",
      "postgresql",
      new Date("2026-04-29T15:45:00.123Z")
    );

  it("ships the scope marker, so an added header is read as ownership", () => {
    // What the operator writes, following the template.
    const annotated = `${blank()}\n-- Collections: posts\n`;
    const parsed = parseEntityHeaders(annotated);

    expect(parsed.collections).toEqual(["posts"]);
    expect(parsed.scoped).toBe(true);
  });

  it("claims nothing until the operator names something", () => {
    // The control, and the reason shipping the marker is not a loophole: the
    // untouched template is still unknown scope, because "changes nothing" and
    // "nobody said" are different facts.
    const parsed = parseEntityHeaders(blank());

    expect(parsed.collections).toEqual([]);
    expect(parsed.singles).toEqual([]);
    expect(parsed.components).toEqual([]);
  });
});

/*
 * 🔴 One remediation is shown for two different files, so it has to work on
 * both. A new blank migration ships the marker and only needs the entity named;
 * a migration generated before headers were scoped has headers and NO marker,
 * and adding another header to it changes nothing — the names stay discarded.
 */
describe("the shared remediation is sufficient for a legacy file too", () => {
  it("names the marker as well as the headers", () => {
    expect(ENTITY_HEADER_GUIDANCE).toContain(SCOPED_ENTITIES_MARKER);
    expect(ENTITY_HEADER_GUIDANCE).toContain("-- Collections:");
    expect(ENTITY_HEADER_GUIDANCE).toContain("-- Singles:");
    expect(ENTITY_HEADER_GUIDANCE).toContain("-- Field groups:");
  });

  it("following it on a legacy file makes its names count", () => {
    // A file generated before headers were scoped: names, no marker.
    const legacy =
      "-- Migration: old\n-- Collections: posts\n\n-- UP\nSELECT 1;";
    expect(parseEntityHeaders(legacy).scoped).toBe(false);

    // What the remediation asks the operator to add.
    const repaired = `${legacy}\n${SCOPED_ENTITIES_MARKER}\n`;
    const parsed = parseEntityHeaders(repaired);

    expect(parsed.scoped).toBe(true);
    expect(parsed.collections).toEqual(["posts"]);
  });
});

/*
 * 🔴 The marker counts only as its own line. A substring test reads the
 * marker's own guidance sentence as provenance — and the blank template prints
 * that sentence — so a file whose real marker was removed still answered
 * `scoped`, and the test guarding the marker could not fail either way.
 */
describe("the scope marker is recognised as a header line, not as text", () => {
  it("does not read the guidance sentence as a declaration", () => {
    // Exactly the shape that defeated the substring test: the marker named
    // inside prose, with no standalone header line.
    const prose = `-- Migration: x\n-- ${ENTITY_HEADER_GUIDANCE}\n\n-- UP\nSELECT 1;`;

    expect(prose).toContain(SCOPED_ENTITIES_MARKER);
    expect(parseEntityHeaders(prose).scoped).toBe(false);
  });

  it("does not read the marker inside SQL as a declaration", () => {
    const inSql = `-- Migration: x\n\n-- UP\nINSERT INTO t VALUES ('${SCOPED_ENTITIES_MARKER}');`;

    expect(parseEntityHeaders(inSql).scoped).toBe(false);
  });

  it("reads a standalone marker line as a declaration", () => {
    // The control: without it, a parser that always answered false would
    // satisfy both cases above.
    const declared = `-- Migration: x\n${SCOPED_ENTITIES_MARKER}\n\n-- UP\nSELECT 1;`;

    expect(parseEntityHeaders(declared).scoped).toBe(true);
  });
});

/*
 * 🔴 A caller that does not compute the entity arrays must not publish a
 * declaration about them. `migrate-baseline` passes all three empty while its
 * SQL adopts existing tables, so a marker there would say "scoped, and it
 * changes nothing" about a migration that creates the whole schema.
 */
describe("a caller can decline to declare scope", () => {
  const base = {
    name: "m",
    dialect: "postgresql" as const,
    sqlStatements: ["SELECT 1"],
    downSqlStatements: [],
    collections: [],
    singles: [],
    components: [],
    hasUserExt: false,
    now: new Date("2026-04-29T15:45:00.123Z"),
  };

  it("omits the marker when the caller says the arrays are not scoped", () => {
    const out = formatMigrationFile({ ...base, entitiesAreScoped: false });

    expect(parseEntityHeaders(out).scoped).toBe(false);
  });

  it("writes it for a caller that computed them, even when none were touched", () => {
    // "Changes no entity" and "nobody recorded what this changes" stay
    // different facts, and only the marker separates them.
    const out = formatMigrationFile(base);

    expect(parseEntityHeaders(out).scoped).toBe(true);
  });
});
