/**
 * The first Schema Builder save of a table an earlier Nextly version made: the table has no
 * history, so the save adopts it as it stands and converts each difference from what Nextly now
 * declares. Each conversion is one the person confirms before it is written, so the preview the
 * Builder's review reads names them, by the keys the apply asks to have confirmed.
 *
 * Driven through each kind's dispatcher, as the Builder's requests reach it: a collection, a Single
 * and a field group, on every configured dialect.
 */
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { dispatchCollections } from "../../../../dispatcher/handlers/collection-dispatcher";
import { dispatchComponents } from "../../../../dispatcher/handlers/component-dispatcher";
import { dispatchSingles } from "../../../../dispatcher/handlers/single-dispatcher";
import { describeEachDialect } from "../../../../plugins/__tests__/helpers/dialect-matrix";
import {
  createTestNextly,
  type TestNextly,
} from "../../../../plugins/test-nextly";
import type { ServiceContainer } from "../../../../services";

import { asCreatedBefore, tableOf, withNoHistory } from "./helpers/older-table";

type Field = { name: string; type: string };

const FIELDS: Field[] = [
  { name: "heading", type: "text" },
  { name: "views", type: "number" },
];
/** The person's change: one field added. */
const WITH_EXTRA: Field[] = [...FIELDS, { name: "extra", type: "text" }];

/** What the preview tells the Builder's review. */
interface Preview {
  schemaVersion: number;
  conversions?: {
    table: string;
    column: string;
    from: string;
    to: string;
    change: string;
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
