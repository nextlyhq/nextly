/**
 * The first Schema Builder save of a table an earlier Nextly version made: the table has no
 * history, so the save adopts it as it stands and converts each difference from what Nextly now
 * declares. Each conversion is one the person confirms before it is written, so the preview the
 * Builder's review reads names them, by the keys the apply asks to have confirmed.
 *
 * Driven through each kind's dispatcher, as the Builder's requests reach it: a collection, a Single
 * and a field group, on every configured dialect.
 */
import { join } from "node:path";

import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { migrateCore } from "../../../../cli/commands/migrate";
import { createLogger } from "../../../../cli/utils/logger";
import { dispatchCollections } from "../../../../dispatcher/handlers/collection-dispatcher";
import { dispatchComponents } from "../../../../dispatcher/handlers/component-dispatcher";
import { dispatchSingles } from "../../../../dispatcher/handlers/single-dispatcher";
import { describeEachDialect } from "../../../../plugins/__tests__/helpers/dialect-matrix";
import {
  createTestNextly,
  type TestNextly,
} from "../../../../plugins/test-nextly";
import type { ServiceContainer } from "../../../../services";
import { NO_CONSENT } from "../../migrate/data-loss-consent";

import {
  asCreatedBefore,
  execOn,
  tableOf,
  withNoHistory,
  withStrayDefault,
} from "./helpers/older-table";

type Field = { name: string; type: string };

const FIELDS: Field[] = [
  { name: "heading", type: "text" },
  { name: "views", type: "number" },
];
/** The person's change: one field added. */
const WITH_EXTRA: Field[] = [...FIELDS, { name: "extra", type: "text" }];

/**
 * The person's change that keeps the push rather than the save's file: a column's type changed,
 * whose stored values the push judges before it alters the column.
 */
const HEADING_AS_NUMBER: Field[] = [
  { name: "heading", type: "number" },
  { name: "views", type: "number" },
];

/** What the preview tells the Builder's review. */
interface Preview {
  schemaVersion: number;
  conversions?: {
    table: string;
    column: string;
    from: string;
    to: string;
    change: string;
    deletesValues: boolean;
  }[];
  notices: string[];
}

/** The answers the Builder's apply sends beyond the fields. */
interface Answers {
  schemaVersion: number;
  acknowledgedConversions?: string[];
}

/** One kind of entity the Builder saves, through its own dispatcher. */
interface Kind {
  name: string;
  table: string;
  create(): Promise<unknown>;
  preview(fields: Field[]): Promise<unknown>;
  apply(fields: Field[], answers: Answers): Promise<unknown>;
}

const applyBody = (fields: Field[], answers: Answers) => ({
  fields,
  confirmed: true,
  schemaVersion: answers.schemaVersion,
  ...(answers.acknowledgedConversions === undefined
    ? {}
    : { acknowledgedConversions: answers.acknowledgedConversions }),
});

const KINDS: Kind[] = [
  {
    name: "a collection",
    table: "dc_posts",
    create: () =>
      dispatchCollections(
        {} as ServiceContainer,
        "createCollection",
        {},
        { name: "posts", label: "Post", fields: FIELDS }
      ),
    preview: fields =>
      dispatchCollections(
        {} as ServiceContainer,
        "previewSchemaChanges",
        { collectionName: "posts" },
        { fields }
      ),
    apply: (fields, answers) =>
      dispatchCollections(
        {} as ServiceContainer,
        "applySchemaChanges",
        { collectionName: "posts" },
        applyBody(fields, answers)
      ),
  },
  {
    name: "a Single",
    table: "single_notice",
    create: () =>
      dispatchSingles(
        "createSingle",
        {},
        { slug: "notice", label: "Notice", fields: FIELDS }
      ),
    preview: fields =>
      dispatchSingles(
        "previewSingleSchemaChanges",
        { slug: "notice" },
        { fields }
      ),
    apply: (fields, answers) =>
      dispatchSingles(
        "applySingleSchemaChanges",
        { slug: "notice" },
        applyBody(fields, answers)
      ),
  },
  {
    name: "a field group",
    table: "comp_card",
    create: () =>
      dispatchComponents(
        "createComponent",
        {},
        { slug: "card", label: "Card", fields: FIELDS }
      ),
    preview: fields =>
      dispatchComponents(
        "previewComponentSchemaChanges",
        { slug: "card" },
        { fields }
      ),
    apply: (fields, answers) =>
      dispatchComponents(
        "applyComponentSchemaChanges",
        { slug: "card" },
        applyBody(fields, answers)
      ),
  },
];

/** The body a dispatcher answered, whether enveloped or not. */
async function bodyOf<T>(response: unknown): Promise<T> {
  const read = (await (response as Response).json()) as T & { data?: T };
  return read.data ?? read;
}

/** The keys a refused apply asks to have confirmed, or the reason it was not that refusal. */
function unconfirmedKeysOf(refusal: unknown): string[] {
  const { code, logContext } = refusal as {
    code?: string;
    logContext?: { columns?: string[] };
  };
  expect(code, String(refusal)).toBe("NEXTLY_SCHEMA_CONVERSION_UNCONFIRMED");
  return [...(logContext?.columns ?? [])].sort();
}

for (const kind of KINDS) {
  describeEachDialect(
    `the first Builder save of ${kind.name}'s table an earlier version made`,
    dialect => {
      let t: TestNextly;

      beforeEach(async () => {
        vi.stubEnv("NODE_ENV", "development");
        t = await createTestNextly({ dialect });
        await kind.create();
        await asCreatedBefore(t, dialect, kind.table, ["heading"]);
        await withNoHistory(t, dialect);
      });

      afterEach(async () => {
        await t.destroy();
        vi.unstubAllEnvs();
      });

      const preview = async (): Promise<Preview> =>
        bodyOf<Preview>(await kind.preview(WITH_EXTRA));

      it("previews each conversion by the key its apply asks to have confirmed, and that apply changes nothing", async () => {
        const before = await tableOf(t, dialect, kind.table);

        const shown = await preview();
        const keys = (shown.conversions ?? []).map(c => c.column).sort();
        expect(keys.length, JSON.stringify(shown)).toBeGreaterThan(0);
        // Worded once, in plain words: the review's line reads the same phrase the conversion carries.
        expect(shown.conversions).toContainEqual(
          expect.objectContaining({
            table: kind.table,
            change: "adds an index on created_at",
            deletesValues: false,
          })
        );
        expect(shown.notices).toContain(
          `${kind.table} was made by an earlier Nextly version. This save brings it up to date: adds an index on created_at.`
        );

        const refusal = await kind
          .apply(WITH_EXTRA, { schemaVersion: shown.schemaVersion })
          .then(
            () => undefined,
            (error: unknown) => error
          );
        expect(refusal).toBeDefined();
        expect(unconfirmedKeysOf(refusal)).toEqual(keys);
        expect(await tableOf(t, dialect, kind.table)).toEqual(before);
      });

      // An earlier version could leave a column its fields no longer declare, which bringing the
      // table up to date removes with its values: named as a conversion that deletes values, so the
      // review shows it as data loss.
      it("names a column the fields no longer declare as a conversion that deletes values", async () => {
        const q = (name: string) =>
          dialect === "mysql" ? `\`${name}\`` : `"${name}"`;
        await execOn(t)(
          `ALTER TABLE ${q(kind.table)} ADD COLUMN ${q("legacy_notes")} text`
        );

        const shown = await preview();

        expect(shown.conversions).toContainEqual(
          expect.objectContaining({
            table: kind.table,
            column: "legacy_notes",
            change: "removes the column legacy_notes",
            deletesValues: true,
          })
        );
      });

      it("saves once the previewed conversions are confirmed, and the next preview names none", async () => {
        const shown = await preview();
        const keys = (shown.conversions ?? []).map(c => c.column);
        expect(keys.length, JSON.stringify(shown)).toBeGreaterThan(0);

        await kind.apply(WITH_EXTRA, {
          schemaVersion: shown.schemaVersion,
          acknowledgedConversions: keys,
        });

        const after = await tableOf(t, dialect, kind.table);
        expect(after.columns.map(c => c.name)).toContain("extra");
        const next = await preview();
        expect(next.conversions).toEqual([]);
      });
    }
  );
}

// A Single's and a field group's save of a column type change is the push's; a collection's runs
// its own files, adoption and conversion included, as the cases above show.
for (const kind of KINDS.filter(k => k.name !== "a collection")) {
  describeEachDialect(
    `the first Builder save of ${kind.name}'s table an earlier version made with a column default, by a change the push applies`,
    dialect => {
      let t: TestNextly;

      beforeEach(async () => {
        vi.stubEnv("NODE_ENV", "development");
        t = await createTestNextly({ dialect });
        await kind.create();
        await asCreatedBefore(t, dialect, kind.table);
        // An earlier create wrote a column DEFAULT for a field stating a default; today's writes
        // none, and the field here states none, so the default is a difference to convert. On a
        // number field's column, which takes a DEFAULT on every dialect.
        await withStrayDefault(t, dialect, kind.table, "views", "0");
        await withNoHistory(t, dialect);
      });

      afterEach(async () => {
        await t.destroy();
        vi.unstubAllEnvs();
      });

      it("converts the column default with its change, and leaves nothing for the next preview or migrate", async () => {
        const columnOf = async (name: string) =>
          (await tableOf(t, dialect, kind.table)).columns.find(
            c => c.name === name
          );
        // Both columns there before the save: a column the reader missed would read as no default.
        const headingBefore = await columnOf("heading");
        const viewsBefore = await columnOf("views");
        expect(headingBefore).toBeDefined();
        expect(viewsBefore).toBeDefined();
        expect(viewsBefore!.default).not.toBeNull();

        const shown = await bodyOf<Preview>(
          await kind.preview(HEADING_AS_NUMBER)
        );
        const keys = (shown.conversions ?? []).map(c => c.column);
        // What the person is asked to confirm: the default removed, on this table's column.
        expect(
          (shown.conversions ?? []).find(
            c => c.table === kind.table && c.column.includes("views")
          ),
          JSON.stringify(shown)
        ).toMatchObject({
          change: "removes the default of views",
          to: "no default",
          deletesValues: false,
        });

        // A save the push applies records the files it wrote applied once the table stands as the
        // newest one says: a default the push left would refuse it as drift, here.
        await kind.apply(HEADING_AS_NUMBER, {
          schemaVersion: shown.schemaVersion,
          acknowledgedConversions: keys,
        });

        // The push recorded the save's files applied with no statement of their own run, where the
        // file road runs the change's: so the default went with the push, not with a file.
        const recorded = await execOn(t)<{ ran: number | string | null }>(
          "SELECT statements_executed AS ran FROM nextly_schema_events WHERE event_type = 'file_apply' AND status = 'applied'"
        );
        expect(recorded.length).toBeGreaterThan(0);
        // A count the record does not hold is not none run: `null` stays `null` here.
        expect(
          recorded.map(r => (r.ran === null ? null : Number(r.ran)))
        ).toEqual(recorded.map(() => 0));
        // `heading` now has the type a number field's column has: `views`'s, made by the create.
        expect(viewsBefore!.type).not.toBe(headingBefore!.type);
        expect(await columnOf("heading")).toMatchObject({
          type: viewsBefore!.type,
        });
        expect(await columnOf("views")).toMatchObject({ default: null });
        const next = await bodyOf<Preview>(
          await kind.preview(HEADING_AS_NUMBER)
        );
        expect(next.conversions).toEqual([]);
        const migrated = await migrateCore({
          extensionSchema: undefined,
          dialect,
          db: (t.adapter as unknown as { getDrizzle(): unknown }).getDrizzle(),
          adapter: t.adapter as never,
          migrationsDir: join(t.basePath, "src", "db", "migrations"),
          logger: createLogger({ quiet: true }),
          lockMode: "fail-fast",
          consent: NO_CONSENT,
          interactive: false,
        } as never);
        expect(migrated).toMatchObject({ applied: 0 });
      });
    }
  );
}
