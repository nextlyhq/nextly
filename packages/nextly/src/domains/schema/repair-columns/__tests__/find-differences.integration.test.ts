/**
 * `findColumnDifferences` against live tables on every configured dialect.
 *
 * Tables are created by the production generators. A legacy table is the current generator's table
 * with each column the legacy type map renders differently retyped to that map's answer, which is
 * the column the Builder created before its new columns read the descriptor. A component's
 * many-to-many is retyped to the scalar the field-group generator gave a single relation, which is
 * what it held before it became a JSON list.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestNextly,
} from "../../../../plugins/test-nextly";
import type { FieldDefinition } from "../../../../schemas/dynamic-collections";
import { DynamicCollectionSchemaService } from "../../../dynamic-collections/services/dynamic-collection-schema-service";
import { FieldGroupSchemaService } from "../../../field-groups/services/field-group-schema-service";
import { UserExtSchemaService } from "../../../users/services/user-ext-schema-service";
import { deriveCompanionSpec } from "../../../i18n/migration/derive-companion-spec";
import {
  _resetPerLanguageStorage,
  setPerLanguageStorage,
} from "../../../i18n/per-language-storage";
import { buildCompanionCreateOnlySql } from "../../../i18n/migration/generate-up";
import { getSchemaEventsDdl } from "../../events/schema-events-ddl";
import { SchemaEventsRepository } from "../../events/schema-events-repository";
import { typesDiffer } from "../../pipeline/diff/declared-size";
import { introspectLiveColumns } from "../../pipeline/diff/introspect-live";
import type { SupportedDialect } from "../../services/field-column-descriptor";
import { findColumnDifferences } from "../find-differences";
import { readRepairEntities } from "../read-entities";
import {
  resolveRepairEntities,
  type ConfiguredEntity,
  type RegistryEntity,
  type SnapshotEntity,
} from "../resolve-entities";
import type {
  ColumnFinding,
  DiffersFinding,
  EntityDefinition,
  RepairColumnOrigin,
  RepairEntity,
} from "../types";

const f = (field: Record<string, unknown>) =>
  field as unknown as FieldDefinition;

/** A Builder collection holding every field type a known shape lives in. */
const ARTICLE_FIELDS: FieldDefinition[] = [
  f({ name: "body", type: "text" }),
  f({
    name: "links",
    type: "repeater",
    fields: [{ name: "url", type: "text" }],
  }),
  f({
    name: "hero",
    type: "group",
    fields: [{ name: "heading", type: "text" }],
  }),
  f({ name: "price", type: "number", options: { format: "float" } }),
  f({
    name: "category",
    type: "select",
    options: [{ label: "A", value: "a" }],
  }),
  f({ name: "tone", type: "radio", options: [{ label: "A", value: "a" }] }),
  f({ name: "cover", type: "upload", relationTo: "users" }),
  f({
    name: "author",
    type: "relationship",
    relationTo: "users",
    required: true,
  }),
  f({ name: "ratings", type: "number", hasMany: true }),
];

/** A field group holding a many-to-many and a bounded text field. */
const CARD_FIELDS: FieldDefinition[] = [
  f({
    name: "related",
    type: "relationship",
    relationTo: "users",
    options: { relationType: "manyToMany" },
  }),
  f({ name: "caption", type: "text", maxLength: 120 }),
];

/** The same field group as an older generator saw it: the many-to-many was a single relation. */
const LEGACY_CARD_FIELDS: FieldDefinition[] = CARD_FIELDS.map(field =>
  field.name === "related"
    ? f({ name: "related", type: "relationship", relationTo: "users" })
    : field
);

/** A test-owned copy of `user_ext`, so the instance's own table is never touched. */
const USER_EXT = "rc_user_ext";

/** One user field of each kind of column the user-extension builder makes. */
const USER_FIELDS: FieldDefinition[] = [
  f({ name: "score", type: "number" }),
  f({ name: "rank", type: "number", required: true }),
  f({ name: "companyName", type: "text", required: true }),
  f({ name: "shortBio", type: "text", maxLength: 80 }),
  f({ name: "handle", type: "text", unique: true }),
  f({ name: "about", type: "textarea" }),
  f({ name: "workEmail", type: "email" }),
  f({ name: "website", type: "url" }),
  f({ name: "isActive", type: "checkbox" }),
  f({ name: "birthday", type: "date" }),
  f({
    name: "teams",
    type: "select",
    hasMany: true,
    options: [{ label: "A", value: "a" }],
  }),
  f({ name: "tier", type: "radio", options: [{ label: "A", value: "a" }] }),
  // The builder gives a relationship no column, so it names none to look for.
  f({ name: "manager", type: "relationship", relationTo: "users" }),
];

const ARTICLES = "dc_rc_articles";
const LOCALIZED = "dc_rc_localized";
const CARDS = "comp_rc_card";

/** The generator's SQL as statements a driver runs one at a time. */
function statements(sql: string): string[] {
  return sql
    .split("--> statement-breakpoint")
    .flatMap(chunk =>
      chunk
        .split("\n")
        .filter(line => !line.trim().startsWith("--"))
        .join("\n")
        .split(/;\s*(?:\n|$)/)
    )
    .map(statement => statement.trim())
    .filter(statement => statement.length > 0);
}

/** Where an entity is, which builder made it, and the plugin that owns it, if one does. */
interface EntityIdentity {
  kind: RepairEntity["kind"];
  slug: string;
  table: string;
  origin: RepairColumnOrigin;
  plugin?: string;
}

/** An entity applied and configured alike, both by the builder `origin` names. */
function entity(
  { origin, ...over }: EntityIdentity,
  fields: FieldDefinition[]
): RepairEntity {
  const definition: EntityDefinition = { fields, localized: false, origin };
  return {
    applied: { ...definition, source: "snapshot" },
    configured: definition,
    ...over,
  };
}

const articles = (
  fields = ARTICLE_FIELDS,
  over: Partial<EntityIdentity> = {}
) =>
  entity(
    {
      kind: "collection",
      slug: "rc-articles",
      table: ARTICLES,
      origin: "collection",
      ...over,
    },
    fields
  );
const cards = () =>
  entity(
    { kind: "fieldGroup", slug: "rc-card", table: CARDS, origin: "fieldGroup" },
    CARD_FIELDS
  );

/**
 * The pending-state matrix: one code-first collection, whose applied side lives in `MX_OLD` and
 * whose configured side may move to `MX_NEW`. Its two fields hold the same column whether the
 * Builder's generator or the code-first descriptor makes it, on every dialect, so a live table the
 * Builder's generator creates matches the applied definition exactly.
 */
const MX_OLD = "dc_rc_mx_old";
const MX_NEW = "dc_rc_mx_new";
/** The applied table's name in another case: a distinct table name, as a quoted name is. */
const MX_RECASED = "dc_rc_MX_old";
const MX_FIELDS: FieldDefinition[] = [
  f({ name: "body", type: "textarea" }),
  f({ name: "score", type: "number" }),
];
/** The same fields with `score` retyped, as a configuration not yet migrated holds it. */
const MX_RETYPED: FieldDefinition[] = [
  f({ name: "body", type: "textarea" }),
  f({ name: "score", type: "textarea" }),
];

const mxConfigured = (
  table: string,
  fields: FieldDefinition[] = MX_FIELDS
): ConfiguredEntity => ({
  kind: "collection",
  slug: "rc-mx",
  table,
  fields,
  localized: false,
  origin: "codeFirst",
});
const mxRow = (over: Partial<RegistryEntity> = {}): RegistryEntity => ({
  kind: "collection",
  slug: "rc-mx",
  tableName: MX_OLD,
  fields: MX_FIELDS,
  localized: false,
  source: "code",
  locked: true,
  migrationStatus: "applied",
  ...over,
});
const mxSnapshot = (over: Partial<SnapshotEntity> = {}): SnapshotEntity => ({
  kind: "collection",
  slug: "rc-mx",
  source: "code",
  fields: MX_FIELDS,
  localized: false,
  table: MX_OLD,
  ...over,
});

/**
 * One finding as a matrix cell names it: kind, column, what is missing or pending, the table a
 * pending change moves the column from, and whether a pending change found a live column.
 */
type MatrixRow = [string, string, string, string, string];

/** What a cell's configured side declares: the applied table, another table, or nothing. */
type ConfiguredAxis = "same table" | "another table" | "absent";
/** Where a cell's applied definition comes from, or why there is none. */
type AppliedAxis =
  | "snapshot"
  | "registry row"
  | "registry row synced"
  | "none"
  | "registry pending"
  | "registry generated"
  | "registry failed";

/** What stops a run before any finding is made. */
type MatrixStop =
  | "unreadable snapshot"
  | "malformed snapshot"
  | "unreadable manifest";

/** One cell: its sources, whether the live table exists, and the outcome expected. */
interface MatrixCell {
  name: string;
  configured: ConfiguredEntity[];
  registry: RegistryEntity[];
  snapshots: SnapshotEntity[];
  /** Whether a Builder manifest is checked out. */
  hasManifest: boolean;
  /** Whether `MX_OLD`, the applied table, exists as the applied definition makes it. */
  liveTable: boolean;
  /** The findings, or what stops the run before any is made. */
  expected: MatrixRow[] | { stops: MatrixStop };
}

const col = (table: string, column: string) => `${table}.${column}`;
const MX_COLUMNS = ["body", "score"] as const;
const liveMark = (found: boolean) => (found ? "live" : "no live");
/** A pending add of every column at `table`. */
const adds = (table: string, found: boolean): MatrixRow[] =>
  MX_COLUMNS.map(c => [
    "pending-migration",
    col(table, c),
    "add",
    "",
    liveMark(found),
  ]);
/** A pending removal of every column at the applied table. */
const removals = (found: boolean): MatrixRow[] =>
  MX_COLUMNS.map(c => [
    "pending-migration",
    col(MX_OLD, c),
    "remove",
    "",
    liveMark(found),
  ]);
/** A pending move of every column from the applied table to `MX_NEW`. */
const moves = (found: boolean): MatrixRow[] =>
  MX_COLUMNS.map(c => [
    "pending-migration",
    col(MX_NEW, c),
    "change",
    MX_OLD,
    liveMark(found),
  ]);
/** Every applied column not migrated, its whole table missing. */
const missing: MatrixRow[] = MX_COLUMNS.map(c => [
  "not-migrated",
  col(MX_OLD, c),
  "table",
  "",
  "",
]);

/** The status a registry row holds on each applied axis that reads one. */
const ROW_STATUS: Partial<Record<AppliedAxis, string>> = {
  "registry row": "applied",
  "registry row synced": "synced",
  "registry pending": "pending",
  "registry generated": "generated",
  "registry failed": "failed",
};

/**
 * The sources for one cell of the grid. A Builder manifest is checked out in every one, so a
 * registry row never stands in for the configured side and "absent" means nothing declares it.
 */
function gridSources(
  configured: ConfiguredAxis,
  applied: AppliedAxis
): Pick<MatrixCell, "configured" | "registry" | "snapshots" | "hasManifest"> {
  const table = configured === "another table" ? MX_NEW : MX_OLD;
  const declared = configured === "absent" ? [] : [mxConfigured(table)];
  const base = { configured: declared, hasManifest: true };
  if (applied === "snapshot") {
    // Boot has already rewritten the code-first row's table from the configuration.
    return {
      ...base,
      registry: [mxRow({ tableName: table })],
      snapshots: [mxSnapshot()],
    };
  }
  if (applied === "none") return { ...base, registry: [], snapshots: [] };
  return {
    ...base,
    registry: [mxRow({ migrationStatus: ROW_STATUS[applied] })],
    snapshots: [],
  };
}

const cell = (
  configured: ConfiguredAxis,
  applied: AppliedAxis,
  liveTable: boolean,
  expected: MatrixRow[]
): MatrixCell => ({
  name: `configured ${configured}, applied ${applied}, live table ${liveTable ? "present" : "absent"}`,
  ...gridSources(configured, applied),
  liveTable,
  expected,
});

/** A cell whose run stops before any finding: the sources resolve, the reading refuses. */
const stopCell = (name: string, stops: MatrixStop): MatrixCell => ({
  name,
  configured: [mxConfigured(MX_OLD)],
  registry: [],
  snapshots: [],
  hasManifest: stops === "unreadable manifest",
  liveTable: true,
  expected: { stops },
});

/** The applied axes on which a record says what was applied, and those on which none does. */
const APPLIED: AppliedAxis[] = [
  "snapshot",
  "registry row",
  "registry row synced",
];
const NOT_APPLIED: AppliedAxis[] = [
  "none",
  "registry pending",
  "registry generated",
  "registry failed",
];
const LIVE = [true, false];

const MATRIX: MatrixCell[] = [
  // Configured at the applied table: judged as usual, nothing pending.
  ...APPLIED.flatMap(applied =>
    LIVE.map(live => cell("same table", applied, live, live ? [] : missing))
  ),
  // Nothing applied it: every configured column is the next migration's to add, whatever is live.
  ...NOT_APPLIED.flatMap(applied =>
    LIVE.map(live => cell("same table", applied, live, adds(MX_OLD, live)))
  ),
  // Removed: judged as usual, and every applied column pending removal.
  ...APPLIED.flatMap(applied =>
    LIVE.map(live =>
      cell(
        "absent",
        applied,
        live,
        live ? removals(true) : [...missing, ...removals(false)]
      )
    )
  ),
  // Neither side: no entity at all.
  ...NOT_APPLIED.flatMap(applied =>
    LIVE.map(live => cell("absent", applied, live, []))
  ),
  // Renamed: judged at the applied table, and every column pending a move from it.
  ...APPLIED.flatMap(applied =>
    LIVE.map(live =>
      cell(
        "another table",
        applied,
        live,
        live ? moves(true) : [...missing, ...moves(false)]
      )
    )
  ),
  // Nothing applied it: every configured column an add at the configured table, which is not live.
  ...NOT_APPLIED.flatMap(applied =>
    LIVE.map(live => cell("another table", applied, live, adds(MX_NEW, false)))
  ),
  {
    name: "configured with a field retyped, applied snapshot, live table present: the change alone",
    configured: [mxConfigured(MX_OLD, MX_RETYPED)],
    registry: [mxRow({ fields: MX_RETYPED })],
    snapshots: [mxSnapshot()],
    hasManifest: true,
    liveTable: true,
    expected: [
      ["pending-migration", col(MX_OLD, "score"), "change", "", "live"],
    ],
  },
  {
    name: "renamed with a field retyped, applied snapshot, live table present: every column moves",
    configured: [mxConfigured(MX_NEW, MX_RETYPED)],
    registry: [mxRow({ tableName: MX_NEW, fields: MX_RETYPED })],
    snapshots: [mxSnapshot()],
    hasManifest: true,
    liveTable: true,
    expected: moves(true),
  },
  {
    name: "renamed by case alone, applied snapshot, live table present: every column moves",
    configured: [mxConfigured(MX_RECASED)],
    registry: [mxRow({ tableName: MX_RECASED })],
    snapshots: [mxSnapshot()],
    hasManifest: true,
    liveTable: true,
    expected: MX_COLUMNS.map(c => [
      "pending-migration",
      col(MX_RECASED, c),
      "change",
      MX_OLD,
      "live",
    ]),
  },
  {
    name: "no manifest, a pending Builder row stands in as configured, live table present: adds",
    configured: [],
    registry: [
      mxRow({ source: "ui", locked: false, migrationStatus: "pending" }),
    ],
    snapshots: [],
    hasManifest: false,
    liveTable: true,
    expected: adds(MX_OLD, true),
  },
  {
    name: "no manifest, an applied Builder row stands in as configured, live table present: nothing",
    configured: [],
    registry: [mxRow({ source: "ui", locked: false })],
    snapshots: [],
    hasManifest: false,
    liveTable: true,
    expected: [],
  },
  {
    name: "manifest present omitting an applied Builder row, live table present: removals",
    configured: [],
    registry: [mxRow({ source: "ui", locked: false })],
    snapshots: [mxSnapshot({ source: "builder" })],
    hasManifest: true,
    liveTable: true,
    expected: removals(true),
  },
  stopCell(
    "the newest applied snapshot is unreadable: the run stops, naming it",
    "unreadable snapshot"
  ),
  stopCell(
    "the newest applied snapshot's entity record is malformed: the run stops, naming it",
    "malformed snapshot"
  ),
  stopCell(
    "the checked-out manifest cannot be read: the run stops",
    "unreadable manifest"
  ),
];

/** One finding as its matrix row. */
function matrixRow(x: ColumnFinding): MatrixRow {
  const where = `${x.location.table}.${x.location.column}`;
  switch (x.kind) {
    case "not-migrated":
      return [x.kind, where, x.missing, "", ""];
    case "differs":
    case "definition-unreadable":
      return [x.kind, where, "", "", ""];
    case "pending-migration":
      return [
        x.kind,
        where,
        x.applied === null
          ? "add"
          : x.configured === null
            ? "remove"
            : "change",
        x.renamedFrom ?? "",
        liveMark(x.live !== null),
      ];
  }
}

const differs = (findings: ColumnFinding[]): DiffersFinding[] =>
  findings.filter((x): x is DiffersFinding => x.kind === "differs");
const at = (x: ColumnFinding) => `${x.location.table}.${x.location.column}`;

describe.each(getConfiguredTestDialects())(
  "findColumnDifferences on %s",
  dialect => {
    let handle: TestNextly;
    const run = (statement: string) => handle.adapter.executeQuery(statement);
    const q = (name: string) =>
      dialect === "mysql" ? `\`${name}\`` : `"${name}"`;
    const db = () => handle.adapter.getDrizzle();
    const find = (entities: RepairEntity[]) =>
      findColumnDifferences({ db: db(), dialect, entities });

    /** Create a Builder collection table with the current generator. */
    async function createBuilderTable(
      table: string,
      fields: FieldDefinition[]
    ) {
      const sql = new DynamicCollectionSchemaService(
        undefined,
        dialect
      ).generateMigrationSQL(table, fields, {});
      for (const statement of statements(sql)) await run(statement);
    }

    async function createFieldGroupTable(
      table: string,
      fields: FieldDefinition[]
    ) {
      const sql = new FieldGroupSchemaService(dialect).generateMigrationSQL(
        table,
        fields as unknown as Parameters<
          FieldGroupSchemaService["generateMigrationSQL"]
        >[1]
      );
      for (const statement of statements(sql)) await run(statement);
    }

    /** Retype an empty column, keeping its nullability. SQLite never needs it here. */
    async function retype(
      table: string,
      column: string,
      type: string,
      nullable: boolean
    ) {
      if (dialect === "postgresql") {
        await run(
          `ALTER TABLE ${q(table)} ALTER COLUMN ${q(column)} TYPE ${type} USING ${q(column)}::text::${type}`
        );
      } else if (dialect === "mysql") {
        await run(
          `ALTER TABLE ${q(table)} MODIFY ${q(column)} ${type} ${nullable ? "NULL" : "NOT NULL"}`
        );
      } else {
        throw new Error("SQLite holds no retyped legacy column in this suite");
      }
    }

    /** The current tables, then every column the legacy generators rendered differently. */
    async function createLegacyTables() {
      await createBuilderTable(ARTICLES, ARTICLE_FIELDS);
      // Before a component's many-to-many became a JSON list, the field-group generator built it
      // as a single relation, so the legacy table is that generator's table for one.
      await createFieldGroupTable(CARDS, LEGACY_CARD_FIELDS);
      if (dialect === "sqlite") return;

      const builder = new DynamicCollectionSchemaService(undefined, dialect);
      const current = builder.plannedColumnTypes(ARTICLE_FIELDS);
      for (const field of ARTICLE_FIELDS) {
        const legacy = builder.mapFieldTypeToSQL(
          field.type,
          field.length,
          field.options,
          field.validation,
          field
        );
        const now = current.get(field.name);
        if (now === undefined) continue;
        if (
          !typesDiffer(
            { name: "", type: legacy, nullable: true },
            { name: "", type: now, nullable: true }
          )
        ) {
          continue;
        }
        await retype(ARTICLES, field.name, legacy, field.required !== true);
      }

      if (dialect === "mysql") await retype(CARDS, "caption", "text", true);
    }

    /** Every table and column of the database's managed tables, to show a run changed nothing. */
    async function schemaOf(tables: string[]) {
      return introspectLiveColumns(db(), dialect, tables);
    }

    beforeEach(async () => {
      handle = await createTestNextly(dialect === "sqlite" ? {} : { dialect });
    });

    afterEach(async () => {
      // A companion first: it holds a foreign key to its main table.
      for (const table of [
        `${LOCALIZED}_locales`,
        LOCALIZED,
        ARTICLES,
        CARDS,
        "dc_rc_missing",
        "dc_rc_partial",
        "dc_rc_pending",
        USER_EXT,
        MX_OLD,
        MX_NEW,
      ]) {
        await run(`DROP TABLE IF EXISTS ${q(table)}`);
      }
      await handle?.destroy();
    });

    /** The columns each dialect's legacy tables hold differently, with their cause. */
    const LEGACY_CAUSES: Record<SupportedDialect, Record<string, string>> = {
      postgresql: {
        [`${ARTICLES}.links`]: "legacy:structured-as-text",
        [`${ARTICLES}.hero`]: "legacy:structured-as-text",
        [`${ARTICLES}.price`]: "legacy:float-as-decimal",
        [`${ARTICLES}.ratings`]: "current-generator",
        [`${CARDS}.related`]: "legacy:component-list-in-scalar",
      },
      mysql: {
        [`${ARTICLES}.links`]: "legacy:structured-as-text",
        [`${ARTICLES}.hero`]: "legacy:structured-as-text",
        [`${ARTICLES}.price`]: "legacy:float-as-decimal",
        [`${ARTICLES}.category`]: "legacy:mysql-text-fallback",
        [`${ARTICLES}.tone`]: "legacy:mysql-text-fallback",
        [`${ARTICLES}.cover`]: "legacy:mysql-text-fallback",
        [`${ARTICLES}.ratings`]: "current-generator",
        [`${CARDS}.related`]: "legacy:component-list-in-scalar",
        [`${CARDS}.caption`]: "legacy:mysql-text-fallback",
      },
      // SQLite keeps JSON as text, so a repeater, group or component list holds no other type.
      sqlite: {
        [`${ARTICLES}.ratings`]: "current-generator",
      },
    };

    const causeLabel = (x: DiffersFinding) =>
      x.cause === null
        ? "unknown"
        : x.cause.kind === "legacy"
          ? `legacy:${x.cause.shape}`
          : x.cause.kind;

    it("reports each seeded legacy shape once", async () => {
      await createLegacyTables();
      const findings = await find([articles(), cards()]);
      const columns = findings.map(at);
      expect(new Set(columns).size).toBe(columns.length);
      expect(findings.every(x => x.kind === "differs")).toBe(true);
      expect(columns.sort()).toEqual(
        Object.keys(LEGACY_CAUSES[dialect]).sort()
      );
    });

    it("finds each legacy shape on each dialect that can hold it", async () => {
      await createLegacyTables();
      const found = Object.fromEntries(
        differs(await find([articles(), cards()])).map(x => [
          at(x),
          causeLabel(x),
        ])
      );
      expect(found).toEqual(LEGACY_CAUSES[dialect]);
      if (dialect === "sqlite") {
        // No type change for a repeater or group: JSON is text there.
        expect(found[`${ARTICLES}.links`]).toBeUndefined();
        expect(found[`${ARTICLES}.hero`]).toBeUndefined();
      }
    });

    it("on a current database reports only what a current generator still creates, with that cause", async () => {
      // On MySQL today's field-group generator cannot create a many-to-many at all: it indexes the
      // JSON list column, which MySQL refuses. So no current MySQL table holds one to compare.
      const cardFields = [
        ...CARD_FIELDS.filter(
          field => dialect !== "mysql" || field.name !== "related"
        ),
        f({ name: "when", type: "date" }),
        f({
          name: "owner",
          type: "relationship",
          relationTo: "users",
          required: true,
        }),
      ];
      await createBuilderTable(ARTICLES, ARTICLE_FIELDS);
      await createFieldGroupTable(CARDS, cardFields);
      const findings = await find([
        articles(),
        entity(
          {
            kind: "fieldGroup",
            slug: "rc-card",
            table: CARDS,
            origin: "fieldGroup",
          },
          cardFields
        ),
      ]);
      expect(findings.length).toBeGreaterThan(0);
      for (const finding of findings) {
        expect(finding.kind, at(finding)).toBe("differs");
        expect(causeLabel(finding as DiffersFinding), at(finding)).toBe(
          "current-generator"
        );
      }
    });

    it("reports a missing table and a missing column as not migrated and creates nothing", async () => {
      const partialFields = [
        f({ name: "title", type: "text" }),
        f({ name: "summary", type: "textarea" }),
      ];
      await createBuilderTable("dc_rc_partial", partialFields.slice(0, 1));
      const tables = ["dc_rc_missing", "dc_rc_partial"];
      const before = await schemaOf(tables);

      const findings = await find([
        entity(
          {
            kind: "collection",
            slug: "rc-missing",
            table: "dc_rc_missing",
            origin: "collection",
          },
          [
            f({ name: "headline", type: "text" }),
            f({ name: "score", type: "number" }),
          ]
        ),
        entity(
          {
            kind: "collection",
            slug: "rc-partial",
            table: "dc_rc_partial",
            origin: "collection",
          },
          partialFields
        ),
      ]);

      expect(
        findings.map(x => [
          x.kind,
          at(x),
          x.kind === "not-migrated" ? x.missing : "",
        ])
      ).toEqual([
        ["not-migrated", "dc_rc_missing.headline", "table"],
        ["not-migrated", "dc_rc_missing.score", "table"],
        ["not-migrated", "dc_rc_partial.summary", "column"],
      ]);
      expect(await schemaOf(tables)).toEqual(before);
    });

    it("reports a changed, unmigrated field as pending", async () => {
      const applied = [f({ name: "rating", type: "number" })];
      const configured = [f({ name: "rating", type: "text" })];
      await createBuilderTable("dc_rc_pending", applied);
      // Applied as `fields`, configured as `now`.
      const pending = (
        fields: FieldDefinition[],
        now: FieldDefinition[]
      ): RepairEntity => ({
        ...entity(
          {
            kind: "collection",
            slug: "rc-pending",
            table: "dc_rc_pending",
            origin: "collection",
          },
          fields
        ),
        configured: { fields: now, localized: false, origin: "collection" },
      });

      const findings = await find([pending(applied, configured)]);
      expect(findings.map(x => [x.kind, at(x)])).toEqual([
        ["pending-migration", "dc_rc_pending.rating"],
      ]);
      const [record] = findings;
      expect(record?.kind === "pending-migration" && record.live).toBeTruthy();

      // Once the change's migration has applied, the table holds the new column and the applied
      // definition is the configured one: nothing is reported for it.
      await run(`DROP TABLE ${q("dc_rc_pending")}`);
      await createBuilderTable("dc_rc_pending", configured);
      expect(await find([pending(configured, configured)])).toEqual([]);
    });

    it("reports a legacy shape under a pending field as two differences", async () => {
      // A NOT NULL column under a relationship that is now optional.
      const author = (required: boolean) =>
        f({
          name: "author",
          type: "relationship",
          relationTo: "users",
          required,
        });
      const applied = [author(false)];
      await createBuilderTable("dc_rc_pending", [author(true)]);
      const findings = await find([
        {
          ...entity(
            {
              kind: "collection",
              slug: "rc-pending",
              table: "dc_rc_pending",
              origin: "collection",
            },
            applied
          ),
          configured: {
            fields: [f({ name: "author", type: "number", required: true })],
            localized: false,
            origin: "collection",
          },
        },
      ]);
      expect(findings.map(x => [x.kind, at(x)])).toEqual([
        ["differs", "dc_rc_pending.author"],
        ["pending-migration", "dc_rc_pending.author"],
      ]);
      // The column is judged against the applied relationship, never the pending number.
      const [difference] = differs(findings);
      expect(difference?.aspects).toEqual({ type: false, nullability: true });
      expect(difference?.expected.nullable).toBe(true);
    });

    it("a required translatable field's column in the translation table is not reported", async () => {
      const fields = [
        f({ name: "summary", type: "text" }),
        f({ name: "headline", type: "text", localized: true, required: true }),
      ];
      // The Builder's own creation of a localized collection: the main table without its
      // translatable fields, then the companion its migration creates beside it.
      const main = new DynamicCollectionSchemaService(
        undefined,
        dialect
      ).generateMigrationSQL(LOCALIZED, fields, { localized: true });
      for (const statement of statements(main)) await run(statement);
      const spec = deriveCompanionSpec({
        slug: "rc-localized",
        kind: "collection",
        dbName: LOCALIZED,
        fields,
        dialect,
        builtBy: "collection",
        defaultLocale: "en",
        collectionLocalized: true,
      });
      if (spec === null) throw new Error("the fixture translates no field");
      for (const statement of statements(buildCompanionCreateOnlySql(spec))) {
        await run(statement);
      }

      const localized: RepairEntity = {
        ...entity(
          {
            kind: "collection",
            slug: "rc-localized",
            table: LOCALIZED,
            origin: "collection",
          },
          fields
        ),
        applied: {
          fields,
          localized: true,
          origin: "collection",
          source: "snapshot",
        },
        configured: { fields, localized: true, origin: "collection" },
      };
      // The column exists where the finder looks for it, so absence cannot pass this case.
      const companion = await schemaOf([`${LOCALIZED}_locales`]);
      expect(
        companion.tables[0]?.columns.map(c => c.name.toLowerCase())
      ).toContain("headline");
      expect(await find([localized])).toEqual([]);
    });

    // Under `experimental.perLanguageStorage` an entity that is not marked translatable keeps its
    // translatable fields in its translation table all the same, so that is where they are looked for.
    it("looks for an untranslated entity's translatable column in its translation table under the setting", async () => {
      const fields = [
        f({ name: "summary", type: "number" }),
        f({ name: "headline", type: "text" }),
      ];
      // Laid out as the setting lays it out: the main table without the translatable field, and
      // the translation table holding it.
      const main = new DynamicCollectionSchemaService(
        undefined,
        dialect
      ).generateMigrationSQL(LOCALIZED, fields, { localized: true });
      for (const statement of statements(main)) await run(statement);
      const spec = deriveCompanionSpec({
        slug: "rc-localized",
        kind: "collection",
        dbName: LOCALIZED,
        fields,
        dialect,
        builtBy: "collection",
        defaultLocale: "en",
        collectionLocalized: true,
      });
      if (spec === null) throw new Error("the fixture translates no field");
      for (const statement of statements(buildCompanionCreateOnlySql(spec))) {
        await run(statement);
      }
      const untranslated: RepairEntity = {
        ...entity(
          {
            kind: "collection",
            slug: "rc-localized",
            table: LOCALIZED,
            origin: "collection",
          },
          fields
        ),
        applied: {
          fields,
          localized: false,
          origin: "collection",
          source: "snapshot",
        },
        configured: { fields, localized: false, origin: "collection" },
      };
      setPerLanguageStorage(true);
      try {
        expect(await find([untranslated])).toEqual([]);
      } finally {
        _resetPerLanguageStorage();
      }
    });

    it("reports a table awaiting its first migration as pending, never as not migrated", async () => {
      // Only the configuration declares it: no migration file creates it yet, so the next step is
      // `migrate:create`, not `nextly migrate`.
      const fields = [
        f({ name: "headline", type: "text" }),
        f({ name: "score", type: "number" }),
      ];
      const findings = await find([
        {
          kind: "collection",
          slug: "rc-missing",
          table: "dc_rc_missing",
          applied: null,
          configured: { fields, localized: false, origin: "codeFirst" },
        },
      ]);
      expect(
        findings.map(x => [
          x.kind,
          at(x),
          x.kind === "pending-migration" ? x.applied : "",
          x.kind === "pending-migration" ? x.live : "",
        ])
      ).toEqual([
        ["pending-migration", "dc_rc_missing.headline", null, null],
        ["pending-migration", "dc_rc_missing.score", null, null],
      ]);
    });

    it("judges a Builder collection that code adopted by the Builder until the adoption's migration applies", async () => {
      // The Builder made the table and the last applied migration recorded it as the Builder's;
      // the configuration now declares the same fields in code, and that migration is pending.
      const fields = [
        f({ name: "body", type: "text" }),
        f({
          name: "author",
          type: "relationship",
          relationTo: "users",
          required: true,
        }),
        f({ name: "ratings", type: "number", hasMany: true }),
      ];
      await createBuilderTable("dc_rc_pending", fields);
      const findings = await find([
        {
          kind: "collection",
          slug: "rc-pending",
          table: "dc_rc_pending",
          applied: {
            fields,
            localized: false,
            origin: "collection",
            source: "snapshot",
          },
          configured: { fields, localized: false, origin: "codeFirst" },
        },
      ]);
      // The columns the Builder's generator still creates are named as its, which only the
      // applied side's owner can say: code-first tables have no generator of their own.
      expect(
        Object.fromEntries(differs(findings).map(x => [at(x), causeLabel(x)]))
      ).toEqual({
        "dc_rc_pending.ratings": "current-generator",
      });
      // Code-first bounds an unbounded MySQL text field where the Builder does not, so on MySQL the
      // adoption's migration changes `body`; each side is described by its own builder.
      const pending = findings.filter(x => x.kind === "pending-migration");
      expect(
        pending.map(x =>
          x.kind === "pending-migration"
            ? [at(x), x.applied?.type, x.configured?.type]
            : []
        )
      ).toEqual(
        dialect === "mysql"
          ? [["dc_rc_pending.body", "text", "varchar(255)"]]
          : []
      );
    });

    it("finds nothing in user fields the user-extension builder created as they are", async () => {
      // The builder's own CREATE TABLE, under a test-owned name; its index and key statements
      // name the instance's tables and are left out.
      const sql = new UserExtSchemaService(dialect)
        .generateMigrationSQL(
          USER_FIELDS as unknown as Parameters<
            UserExtSchemaService["generateMigrationSQL"]
          >[0]
        )
        .replaceAll("user_ext", USER_EXT);
      for (const statement of statements(sql)) {
        if (statement.startsWith("CREATE TABLE")) await run(statement);
      }
      const definition: EntityDefinition = {
        fields: USER_FIELDS,
        localized: false,
        origin: "userFields",
      };
      const users: RepairEntity = {
        kind: "userFields",
        slug: "users",
        table: USER_EXT,
        applied: { ...definition, source: "registry" },
        configured: definition,
      };
      // Every column exists where the finder looks for it, so absence cannot pass this case.
      const created = await schemaOf([USER_EXT]);
      expect(created.tables[0]?.columns.map(c => c.name.toLowerCase())).toEqual(
        expect.arrayContaining(["score", "rank", "company_name", "is_active"])
      );
      expect(await find([users])).toEqual([]);

      // A change of type is found against the builder's column for the field as applied.
      const changed = USER_FIELDS.map(field =>
        field.name === "score" ? f({ name: "score", type: "checkbox" }) : field
      );
      const findings = await find([
        {
          ...users,
          applied: { ...definition, fields: changed, source: "registry" },
          configured: { ...definition, fields: changed },
        },
      ]);
      expect(findings.map(x => [x.kind, at(x)])).toEqual([
        ["differs", `${USER_EXT}.score`],
      ]);
    });

    /**
     * Read a project whose newest applied snapshot or manifest cannot be read, through the same
     * reading the command does, with the snapshot's migration recorded as applied in the ledger.
     */
    async function readUnreadable(stops: MatrixStop) {
      const adapter = handle.adapter as unknown as DrizzleAdapter;
      const projectRoot = mkdtempSync(join(tmpdir(), "nextly-rc-matrix-"));
      try {
        mkdirSync(join(projectRoot, "meta"));
        if (stops === "unreadable manifest") {
          writeFileSync(join(projectRoot, "ui-schema.json"), "{");
        } else {
          if (!(await adapter.tableExists("nextly_schema_events"))) {
            for (const statement of getSchemaEventsDdl(dialect)) {
              await adapter.executeQuery(statement);
            }
          }
          const name = `0901_rc_matrix_${stops === "unreadable snapshot" ? "broken" : "malformed"}`;
          writeFileSync(
            join(projectRoot, "meta", `${name}.snapshot.json`),
            stops === "unreadable snapshot"
              ? "{ not json"
              : JSON.stringify({
                  version: 1,
                  snapshot: { tables: [] },
                  entities: [],
                })
          );
          const events = new SchemaEventsRepository(db(), dialect);
          const id = await events.recordStart({
            eventType: "file_apply",
            source: "cli-migrate",
            filename: `${name}.sql`,
          });
          await events.markApplied(id, { uniqueFilename: `${name}.sql` });
        }
        return await readRepairEntities({
          adapter,
          dialect,
          config: {
            collections: [{ slug: "rc-mx", dbName: MX_OLD, fields: MX_FIELDS }],
            db: { uiSchemaFile: "ui-schema.json" },
          },
          projectRoot,
          migrationsDir: projectRoot,
          logger: { debug() {}, info() {}, warn() {}, error() {} },
        });
      } finally {
        rmSync(projectRoot, { recursive: true, force: true });
      }
    }

    it.each(MATRIX)("pending-state matrix: $name", async cell => {
      if (cell.liveTable) await createBuilderTable(MX_OLD, MX_FIELDS);
      const { expected } = cell;
      if ("stops" in expected) {
        // A record that cannot be read stops the run rather than let an older one stand in.
        await expect(readUnreadable(expected.stops)).rejects.toMatchObject(
          expected.stops === "unreadable manifest"
            ? { code: "NEXTLY_UI_SCHEMA_INVALID" }
            : {
                code: "CONFIGURATION_ERROR",
                logMessage: expect.stringContaining(
                  expected.stops === "unreadable snapshot"
                    ? "0901_rc_matrix_broken.snapshot.json"
                    : "0901_rc_matrix_malformed.snapshot.json"
                ) as unknown,
              }
        );
        return;
      }
      const entities = resolveRepairEntities({
        configured: cell.configured,
        registry: cell.registry,
        snapshots: cell.snapshots,
        hasManifest: cell.hasManifest,
      });
      expect((await find(entities)).map(matrixRow)).toEqual(expected);
    });

    it("does not judge a column's type on a removed entity whose applied storage no record keeps", async () => {
      // `score` is held as text where its field's own storage is a number: an override of the
      // app's would explain it, and with the entity gone from the configuration and no snapshot,
      // nothing says whether one was applied.
      await createBuilderTable(MX_OLD, MX_RETYPED);
      const removed = resolveRepairEntities({
        configured: [],
        registry: [mxRow()],
        snapshots: [],
        hasManifest: true,
      });
      expect((await find(removed)).map(matrixRow)).toEqual(removals(true));

      // The same column is judged where the applied storage is known, so the table does differ.
      const known = removed.map(
        ({ applied, ...entity }): RepairEntity => ({
          ...entity,
          applied:
            applied === null ? null : { ...applied, storageUnknown: false },
        })
      );
      expect((await find(known)).map(matrixRow)).toEqual([
        ["differs", col(MX_OLD, "score"), "", "", ""],
        ...removals(true),
      ]);
    });

    it("reports a plugin's legacy column and names the plugin", async () => {
      await createLegacyTables();
      const findings = await find([
        articles(ARTICLE_FIELDS, { plugin: "seo-kit" }),
      ]);
      // A shape each dialect holds: a float in decimal(10,2) where the legacy map gave one, else
      // a number list's column.
      const column = `${ARTICLES}.${dialect === "sqlite" ? "ratings" : "price"}`;
      const finding = findings.find(x => at(x) === column);
      expect(finding?.kind).toBe("differs");
      expect(finding?.plugin).toBe("seo-kit");
      expect(findings.every(x => x.plugin === "seo-kit")).toBe(true);
    });
  }
);
