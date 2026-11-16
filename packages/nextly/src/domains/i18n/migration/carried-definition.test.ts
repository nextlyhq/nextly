/**
 * What a column carries into the column that receives its values as translation is turned on or
 * off: its type only where that type is strictly wider than the field's own, and its default.
 */
import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";
import { describe, expect, it } from "vitest";

import type { ColumnSpec } from "../../schema/pipeline/diff/types";

import {
  carriableDefault,
  carriedDefinition,
  receivingColumnDefinition,
  typeCarried,
} from "./carried-definition";
import type { LocalizedColumnSpec } from "./types";

const column = (
  kind: LocalizedColumnSpec["kind"],
  extra: Partial<LocalizedColumnSpec> = {}
): LocalizedColumnSpec => ({ name: "body", kind, ...extra });

const source = (type: string, extra: Partial<ColumnSpec> = {}): ColumnSpec => ({
  name: "body",
  type,
  nullable: true,
  ...extra,
});

describe("carriedDefinition", () => {
  it.each<
    [
      string,
      SupportedDialect,
      ColumnSpec,
      LocalizedColumnSpec,
      string | undefined,
    ]
  >([
    // The field's own type holds every value already: its own spelling is kept.
    [
      "a unique text bounded to be keyed whole keeps the field's TEXT",
      "mysql",
      source("varchar(255)"),
      column("longText"),
      undefined,
    ],
    [
      "the same type under another spelling keeps the field's",
      "postgresql",
      source("int4"),
      column("integer"),
      undefined,
    ],
    [
      "the same type keeps the field's",
      "sqlite",
      source("text"),
      column("text"),
      undefined,
    ],
    // A wider column is carried, so no value is cut on the way.
    [
      "a LONGTEXT column is carried over the field's TEXT",
      "mysql",
      source("longtext"),
      column("longText"),
      "longtext",
    ],
    [
      "a wider decimal is carried",
      "postgresql",
      source("numeric", { typeModifier: "12,2" }),
      column("decimal", { precision: 10, scale: 2 }),
      "numeric(12,2)",
    ],
    [
      "a narrower decimal keeps the field's",
      "mysql",
      source("decimal(8,2)"),
      column("decimal", { precision: 10, scale: 2 }),
      undefined,
    ],
    // A MySQL integer the type rules cannot read is carried: its values may lie past the signed range.
    [
      "an unsigned integer is carried over the field's signed one",
      "mysql",
      source("int unsigned"),
      column("integer"),
      "int unsigned",
    ],
    [
      "an unsigned big integer is carried too",
      "mysql",
      source("bigint unsigned"),
      column("integer"),
      "bigint unsigned",
    ],
    // Pairs Nextly itself writes under two spellings keep the field's type, as every companion has it.
    [
      "a boolean spelled bool keeps the field's",
      "postgresql",
      source("bool"),
      column("boolean"),
      undefined,
    ],
    [
      "a date's timestamp keeps the field's",
      "postgresql",
      source("timestamp"),
      column("timestamp"),
      undefined,
    ],
  ])("%s (%s)", (_name, dialect, from, to, type) => {
    expect(carriedDefinition(from, to, dialect)?.type).toBe(type);
  });

  it("carries the source's default as DDL, with the field's own type where that is kept", () => {
    const carried = carriedDefinition(
      source("text", { default: "'none'::text" }),
      column("text"),
      "postgresql"
    );
    expect(carried).toEqual({ default: "'none'::text" });
    expect(
      receivingColumnDefinition({ ...column("text"), carried }, "postgresql")
    ).toBe("TEXT DEFAULT 'none'::text");
  });

  it("carries nothing from a column it holds whole and that has no default", () => {
    expect(
      carriedDefinition(source("text"), column("text"), "postgresql")
    ).toBeUndefined();
    expect(receivingColumnDefinition(column("longText"), "mysql")).toBe("TEXT");
  });
});

describe("typeCarried for MySQL integers the type rules cannot read", () => {
  it.each([
    ["int unsigned", "INT", true],
    ["int unsigned", "BIGINT", false],
    ["int unsigned", "INT UNSIGNED", false],
    ["bigint unsigned", "BIGINT", true],
    ["tinyint unsigned", "SMALLINT", false],
    ["int zerofill", "INT", true],
  ] as const)("%s over %s: %s", (source, own, carried) => {
    expect(typeCarried(source, own, "mysql")).toBe(carried);
  });
});

describe("carriableDefault", () => {
  it("does not carry a MySQL default in the catalog's escaped form, which no statement accepts", () => {
    expect(carriableDefault("lower(_utf8mb4\\'X\\')", "mysql")).toBe(false);
    expect(carriableDefault("'none'", "mysql")).toBe(true);
    expect(carriableDefault("'none'::text", "postgresql")).toBe(true);
    expect(carriableDefault(undefined, "mysql")).toBe(false);
  });
});
