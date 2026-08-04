import { describe, expect, it } from "vitest";

import { NextlyError } from "../../../errors/nextly-error";

import { parseSqlSections } from "../../../cli/commands/migrate";

import {
  formatLocalizationIntent,
  isLocalizationIntentRefusal,
  isUpSectionMarker,
  LOCALIZATION_INTENT_HEADER,
  LOCALIZATION_INTENT_VERSION,
  parseLocalizationIntent,
} from "./migration-intent";
import { LOCALIZED_COLUMN_KINDS, type CompanionMigrationSpec } from "./types";

const spec = (
  overrides: Partial<CompanionMigrationSpec> = {}
): CompanionMigrationSpec => ({
  dialect: "postgresql",
  collection: "posts",
  mainTable: "dc_posts",
  companionTable: "dc_posts_locales",
  defaultLocale: "en",
  parentIdType: "TEXT",
  columns: [{ name: "body", kind: "text" }],
  ...overrides,
});

/** A file as the writer produces it, so the parser is tested against the real layout. */
const fileWith = (intentLine: string): string =>
  `-- Migration: 20260802_000001_enable_localization_posts\n` +
  `-- Collections: posts\n` +
  `-- Generated: localization companion (enable) (i18n)\n` +
  `${intentLine}\n\n-- UP\nSELECT 1;\n\n-- DOWN\nSELECT 1;\n`;

describe("localization migration intent", () => {
  it("round-trips a spec through the header line", () => {
    const line = formatLocalizationIntent({
      kind: "enable",
      entity: "collection",
      spec: spec({ columnsOnMain: ["body"], status: true }),
    });

    const parsed = parseLocalizationIntent(fileWith(line), "m.sql");

    expect(parsed).not.toBeNull();
    expect(parsed?.kind).toBe("enable");
    expect(parsed?.entity).toBe("collection");
    expect(parsed?.spec.companionTable).toBe("dc_posts_locales");
    expect(parsed?.spec.columnsOnMain).toEqual(["body"]);
    expect(parsed?.spec.status).toBe(true);
    expect(parsed?.spec.columns).toEqual([{ name: "body", kind: "text" }]);
  });

  // Every kind the spec type permits, rather than a chosen one. The generator may write any member
  // of this set into a header, so a parser that accepts a subset aborts a run on a file the same
  // build just produced. Enumerating the set is what makes the next kind added fail here instead of
  // at a user's migrate.
  it.each(LOCALIZED_COLUMN_KINDS)("round-trips the %s column kind", kind => {
    const line = formatLocalizationIntent({
      kind: "enable",
      entity: "collection",
      spec: spec({ columns: [{ name: "body", kind }] }),
    });

    const parsed = parseLocalizationIntent(fileWith(line), "m.sql");

    expect(parsed?.spec.columns).toEqual([{ name: "body", kind }]);
  });

  // The file's checksum covers this line, so an unstable rendering would make two runs that
  // planned the same transition look like two different migrations.
  it("renders the same spec identically every time", () => {
    const args = {
      kind: "enable" as const,
      entity: "collection" as const,
      spec: spec({ columnsOnMain: ["body"] }),
    };
    expect(formatLocalizationIntent(args)).toBe(formatLocalizationIntent(args));
  });

  // Undefined optionals are omitted rather than serialized as null, so a spec that never had a
  // value does not come back carrying one.
  it("omits optional fields that were not set", () => {
    const line = formatLocalizationIntent({
      kind: "create-only",
      entity: "single",
      spec: spec(),
    });

    expect(line).not.toContain("columnsOnMain");
    expect(line).not.toContain("status");
    const parsed = parseLocalizationIntent(fileWith(line), "m.sql");
    expect(parsed?.spec.columnsOnMain).toBeUndefined();
    expect(parsed?.spec.status).toBeUndefined();
  });

  it("keeps the whole payload on one line", () => {
    const line = formatLocalizationIntent({
      kind: "enable",
      entity: "fieldGroup",
      spec: spec({ collection: "hero\nbreak" }),
    });
    expect(line.split("\n")).toHaveLength(1);
  });

  // The field is new, so every companion file written before it exists without one. Those must
  // keep applying exactly as they always have.
  it("returns null for a file that declares no intent", () => {
    const legacy =
      `-- Migration: 20260101_000001_enable_localization_posts\n` +
      `-- Collections: posts\n` +
      `-- Generated: localization companion (enable) (i18n)\n\n` +
      `-- UP\nSELECT 1;\n`;
    expect(parseLocalizationIntent(legacy, "legacy.sql")).toBeNull();
  });

  it("returns null for an ordinary migration", () => {
    expect(
      parseLocalizationIntent("-- Migration: x\n\n-- UP\nSELECT 1;\n", "x.sql")
    ).toBeNull();
  });

  // Refusing rather than falling back to null is the point: a header meant to steer the apply
  // that cannot be read must not quietly become "no steering", which would run the very
  // statements the intent existed to reconsider.
  it("refuses a payload that is not JSON", () => {
    const file = fileWith(`${LOCALIZATION_INTENT_HEADER} {not json`);
    expect(() => parseLocalizationIntent(file, "broken.sql")).toThrow(
      NextlyError
    );
    try {
      parseLocalizationIntent(file, "broken.sql");
    } catch (error) {
      expect(NextlyError.is(error) ? error.logContext?.reason : undefined).toBe(
        "localization_intent_unparsable"
      );
    }
  });

  it("refuses a payload missing the fields it must carry", () => {
    const file = fileWith(
      `${LOCALIZATION_INTENT_HEADER} {"version":1,"kind":"enable","entity":"collection","spec":{}}`
    );
    try {
      parseLocalizationIntent(file, "partial.sql");
      expect.unreachable("expected a refusal");
    } catch (error) {
      expect(NextlyError.is(error) ? error.logContext?.reason : undefined).toBe(
        "localization_intent_malformed"
      );
    }
  });

  it("refuses an entity kind it has no transition record key for", () => {
    const file = fileWith(
      `${LOCALIZATION_INTENT_HEADER} {"version":1,"kind":"enable","entity":"widget","spec":` +
        `{"dialect":"sqlite","collection":"p","mainTable":"a","companionTable":"b",` +
        `"defaultLocale":"en","parentIdType":"TEXT","columns":[]}}`
    );
    try {
      parseLocalizationIntent(file, "kind.sql");
      expect.unreachable("expected a refusal");
    } catch (error) {
      expect(NextlyError.is(error) ? error.logContext?.reason : undefined).toBe(
        "localization_intent_malformed"
      );
    }
  });

  // A newer writer may describe the transition in terms this reader has no rule for. Applying the
  // statements anyway would run a route chosen for a database in a different state.
  it("refuses a payload from a newer writer", () => {
    const file = fileWith(
      `${LOCALIZATION_INTENT_HEADER} {"version":${LOCALIZATION_INTENT_VERSION + 1},` +
        `"kind":"enable","entity":"collection","spec":` +
        `{"dialect":"sqlite","collection":"p","mainTable":"a","companionTable":"b",` +
        `"defaultLocale":"en","parentIdType":"TEXT","columns":[]}}`
    );
    try {
      parseLocalizationIntent(file, "future.sql");
      expect.unreachable("expected a refusal");
    } catch (error) {
      expect(NextlyError.is(error) ? error.logContext?.reason : undefined).toBe(
        "localization_intent_version_unsupported"
      );
    }
  });
});

describe("the header field is confined to the preamble", () => {
  // A hand-written migration is free to comment its own SQL. Scanning the whole file would read
  // such a comment as a corrupt header and take the file out of the run entirely.
  it("ignores a lookalike comment inside the UP section", () => {
    const file =
      `-- Migration: 20260101_000001_add_index\n\n-- UP\n` +
      `${LOCALIZATION_INTENT_HEADER} this is prose, not a payload\n` +
      `CREATE INDEX idx_a ON t (c);\n`;
    expect(parseLocalizationIntent(file, "prose.sql")).toBeNull();
  });

  it("ignores a lookalike comment inside the DOWN section", () => {
    const file =
      `-- Migration: m\n\n-- UP\nSELECT 1;\n\n-- DOWN\n` +
      `${LOCALIZATION_INTENT_HEADER} {"version":1}\nSELECT 1;\n`;
    expect(parseLocalizationIntent(file, "down.sql")).toBeNull();
  });

  // If this module's idea of where the header ends drifts from the one the SQL splitter uses, the
  // scan walks back into statements and the case above regresses silently.
  it("ends the header on every spelling the SQL splitter treats as UP", () => {
    for (const marker of ["-- UP", "-- UP:", "-- UP extra"]) {
      expect(isUpSectionMarker(marker)).toBe(true);
      const { upSql } = parseSqlSections(
        `-- Migration: m\n${marker}\nSELECT 1;\n`
      );
      expect(upSql).toBe("SELECT 1;");
    }
    expect(isUpSectionMarker("-- UPDATE something")).toBe(false);
  });
});

describe("the spec guard covers every required field", () => {
  const base = {
    version: 1,
    kind: "enable",
    entity: "collection",
    spec: {
      dialect: "postgresql",
      collection: "posts",
      mainTable: "dc_posts",
      companionTable: "dc_posts_locales",
      defaultLocale: "en",
      parentIdType: "TEXT",
      columns: [{ name: "body", kind: "text" }],
    },
  };
  const withSpec = (patch: Record<string, unknown>): string =>
    fileWith(
      `${LOCALIZATION_INTENT_HEADER} ${JSON.stringify({
        ...base,
        spec: { ...base.spec, ...patch },
      })}`
    );

  it("accepts the complete payload", () => {
    expect(parseLocalizationIntent(withSpec({}), "ok.sql")).not.toBeNull();
  });

  // Each of these is declared required and is read by the apply path. Accepting the payload
  // without them would hand back a value typed as complete that is not.
  const missing: [string, Record<string, unknown>][] = [
    ["dialect", { dialect: undefined }],
    ["an unknown dialect", { dialect: "oracle" }],
    ["parentIdType", { parentIdType: undefined }],
    ["a column name", { columns: [{ kind: "text" }] }],
    ["a known column kind", { columns: [{ name: "body", kind: "blob" }] }],
    ["a well-formed columnsOnMain", { columnsOnMain: [1, 2] }],
    ["a boolean status", { status: "yes" }],
  ];
  for (const [label, patch] of missing) {
    it(`refuses a payload without ${label}`, () => {
      try {
        parseLocalizationIntent(withSpec(patch), "bad.sql");
        expect.unreachable("expected a refusal");
      } catch (error) {
        expect(
          NextlyError.is(error) ? error.logContext?.reason : undefined
        ).toBe("localization_intent_malformed");
      }
    });
  }
});

describe("a refusal is distinguishable from an unreadable file", () => {
  // Migration discovery drops a file it cannot parse and warns. That is survivable for a file it
  // cannot read at all, and not survivable for one whose intent it cannot read: the run would
  // continue past it and report success.
  it("identifies each refusal this module raises", () => {
    for (const payload of [
      "{not json",
      '{"version":1,"kind":"enable","entity":"collection","spec":{}}',
      '{"version":999,"kind":"enable","entity":"collection","spec":' +
        '{"dialect":"sqlite","collection":"p","mainTable":"a","companionTable":"b",' +
        '"defaultLocale":"en","parentIdType":"TEXT","columns":[]}}',
    ]) {
      try {
        parseLocalizationIntent(
          fileWith(`${LOCALIZATION_INTENT_HEADER} ${payload}`),
          "x.sql"
        );
        expect.unreachable("expected a refusal");
      } catch (error) {
        expect(isLocalizationIntentRefusal(error)).toBe(true);
      }
    }
  });

  it("does not claim an unrelated failure as its own", () => {
    expect(isLocalizationIntentRefusal(new Error("disk gone"))).toBe(false);
    expect(
      isLocalizationIntentRefusal(
        NextlyError.internal({ logContext: { reason: "something_else" } })
      )
    ).toBe(false);
  });
});

// A newer writer is entitled to a shape this build has never seen, so version skew must be
// reported as version skew. Diagnosing it as corruption sends the operator looking for damage
// that is not there when the remedy is to upgrade.
describe("version skew is reported before shape", () => {
  it("names the version even when the payload's shape is unknown to this build", () => {
    const file = fileWith(
      `${LOCALIZATION_INTENT_HEADER} {"version":${LOCALIZATION_INTENT_VERSION + 1},` +
        `"somethingEntirelyNew":true}`
    );
    try {
      parseLocalizationIntent(file, "future.sql");
      expect.unreachable("expected a refusal");
    } catch (error) {
      expect(NextlyError.is(error) ? error.logContext?.reason : undefined).toBe(
        "localization_intent_version_unsupported"
      );
    }
  });
});

// These reach DDL as VARCHAR(n) / DECIMAL(p,s), so a value that is not a whole number in range
// would be rendered into the statement as written.
describe("column dimensions are validated, not merely carried", () => {
  const withColumn = (column: Record<string, unknown>): string =>
    fileWith(
      `${LOCALIZATION_INTENT_HEADER} ${JSON.stringify({
        version: 1,
        kind: "enable",
        entity: "collection",
        spec: {
          dialect: "postgresql",
          collection: "posts",
          mainTable: "dc_posts",
          companionTable: "dc_posts_locales",
          defaultLocale: "en",
          parentIdType: "TEXT",
          columns: [column],
        },
      })}`
    );

  it("accepts whole-number dimensions and a zero scale", () => {
    expect(
      parseLocalizationIntent(
        withColumn({ name: "price", kind: "decimal", precision: 18, scale: 0 }),
        "ok.sql"
      )?.spec.columns[0]
    ).toEqual({ name: "price", kind: "decimal", precision: 18, scale: 0 });
    expect(
      parseLocalizationIntent(
        withColumn({ name: "title", kind: "text" }),
        "ok.sql"
      )
    ).not.toBeNull();
  });

  const bad: [string, Record<string, unknown>][] = [
    [
      "a numeric string precision",
      { name: "p", kind: "decimal", precision: "20" },
    ],
    ["a fractional precision", { name: "p", kind: "decimal", precision: 1.5 }],
    ["a negative scale", { name: "p", kind: "decimal", scale: -1 }],
    ["a zero length", { name: "t", kind: "text", length: 0 }],
    ["a non-finite length", { name: "t", kind: "text", length: 1e999 }],
  ];
  for (const [label, column] of bad) {
    it(`refuses ${label}`, () => {
      try {
        parseLocalizationIntent(withColumn(column), "bad.sql");
        expect.unreachable("expected a refusal");
      } catch (error) {
        expect(
          NextlyError.is(error) ? error.logContext?.reason : undefined
        ).toBe("localization_intent_malformed");
      }
    });
  }
});

// `parseSqlSections` supports a migration with no `-- UP` marker at all, so the preamble cannot be
// bounded by that marker alone. Without a second bound, a raw migration's own comment is read as a
// header — and prose behind the prefix aborts the entire run rather than being ignored.
describe("the preamble ends at the first statement, not only at UP", () => {
  it("ignores a lookalike comment in a file that has no UP marker", () => {
    const raw =
      `-- Migration: 20260101_000001_raw\n` +
      `CREATE TABLE "t" (id TEXT);\n` +
      `${LOCALIZATION_INTENT_HEADER} this is prose, not a payload\n`;
    expect(parseLocalizationIntent(raw, "raw.sql")).toBeNull();
  });

  it("still reads a real header that precedes the first statement", () => {
    const line = formatLocalizationIntent({
      kind: "create-only",
      entity: "collection",
      spec: spec(),
    });
    const raw = `-- Migration: m\n${line}\nCREATE TABLE "t" (id TEXT);\n`;
    expect(parseLocalizationIntent(raw, "raw.sql")?.kind).toBe("create-only");
  });

  it("treats blank lines inside the preamble as part of it", () => {
    const line = formatLocalizationIntent({
      kind: "enable",
      entity: "single",
      spec: spec(),
    });
    const raw = `-- Migration: m\n\n${line}\n\nSELECT 1;\n`;
    expect(parseLocalizationIntent(raw, "raw.sql")?.entity).toBe("single");
  });
});

// A `>` ceiling admits 0, a negative and a fraction as "not newer". This build has a parser for
// exactly one version, so anything it cannot name is something it cannot interpret.
describe("only versions this build can parse are accepted", () => {
  const withVersion = (version: unknown): string =>
    fileWith(
      `${LOCALIZATION_INTENT_HEADER} ${JSON.stringify({
        version,
        kind: "enable",
        entity: "collection",
        spec: {
          dialect: "sqlite",
          collection: "p",
          mainTable: "a",
          companionTable: "b",
          defaultLocale: "en",
          parentIdType: "TEXT",
          columns: [],
        },
      })}`
    );

  it("accepts the version it declares", () => {
    expect(
      parseLocalizationIntent(
        withVersion(LOCALIZATION_INTENT_VERSION),
        "ok.sql"
      )
    ).not.toBeNull();
  });

  for (const version of [0, -1, 0.5, 1.5]) {
    it(`refuses version ${version}`, () => {
      try {
        parseLocalizationIntent(withVersion(version), "v.sql");
        expect.unreachable("expected a refusal");
      } catch (error) {
        expect(
          NextlyError.is(error) ? error.logContext?.reason : undefined
        ).toBe("localization_intent_version_unsupported");
      }
    });
  }
});
