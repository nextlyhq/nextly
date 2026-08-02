import { describe, expect, it } from "vitest";

import { NextlyError } from "../../../errors/nextly-error";

import {
  formatLocalizationIntent,
  LOCALIZATION_INTENT_HEADER,
  LOCALIZATION_INTENT_VERSION,
  parseLocalizationIntent,
} from "./migration-intent";
import type { CompanionMigrationSpec } from "./types";

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
        `{"collection":"p","mainTable":"a","companionTable":"b","defaultLocale":"en","columns":[]}}`
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
        `{"collection":"p","mainTable":"a","companionTable":"b","defaultLocale":"en","columns":[]}}`
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
