/**
 * A Single's read answers the fields its `select` names, and reads only their
 * columns where nothing else needs the rest, on every dialect.
 *
 * The SEO settings read is why: on a site that upgraded and has not run
 * `nextly migrate` yet, a field added in code has no column, and a read of the
 * Single fails as not migrated. A read that names only the fields the database
 * has must then succeed, so the reader can answer what it can. A read that
 * names the missing field, or names none, must still be refused, as before.
 *
 * Narrowing the SQL must not change what a read hook or a field read rule sees:
 * they are handed the whole document, so a Single that has one is read whole,
 * and only the answer is narrowed.
 */
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { afterEach, describe, expect, it } from "vitest";

import { defineSingle, text } from "../../../../config";
import { NextlyError } from "../../../../errors/nextly-error";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../../plugins/test-nextly";
import { SYSTEM_TIMESTAMP_KEYS } from "../../../../shared/lib/case-conversion";

const PLAIN = "srs_plain";
const WORDS = "srs_words";
const HOOKED = "srs_hooked";
const RULED = "srs_ruled";

/** What each read hook and field rule was handed, by Single. */
const seen: Record<string, unknown[]> = { [HOOKED]: [], [RULED]: [] };

let current: TestNextly | undefined;
afterEach(async () => {
  await current?.destroy();
  current = undefined;
  seen[HOOKED] = [];
  seen[RULED] = [];
});

type Doc = Record<string, unknown>;
interface SingleReads {
  findSingle(args: Record<string, unknown>): Promise<Doc>;
  updateSingle(args: Record<string, unknown>): Promise<unknown>;
}
const reads = (t: TestNextly) => t.nextly as unknown as SingleReads;

async function boot(dialect: TestDialect): Promise<SingleReads> {
  current = await createTestNextly({
    dialect,
    singles: [
      defineSingle({
        slug: PLAIN,
        fields: [
          text({ name: "headline" }),
          text({ name: "tagline" }),
          text({ name: "notes" }),
        ],
      }),
      defineSingle({
        slug: HOOKED,
        fields: [text({ name: "headline" }), text({ name: "audience" })],
        hooks: {
          // Reads a field the caller below leaves out, and writes what it read
          // into one the caller selects.
          afterRead: [
            ({ data }) => {
              const doc = data as Doc;
              seen[HOOKED].push(doc.audience);
              return {
                ...doc,
                headline: `${doc.headline} for ${doc.audience}`,
              };
            },
          ],
        },
      }),
      defineSingle({
        slug: RULED,
        fields: [
          text({
            name: "headline",
            // Shown only while the audience, a field the caller below leaves
            // out, says everyone may see it.
            access: {
              read: ({ data }) => {
                seen[RULED].push(data?.audience);
                return data?.audience === "everyone";
              },
            },
          }),
          text({ name: "audience" }),
        ],
      }),
    ],
  });
  const nextly = reads(current);
  await nextly.updateSingle({
    slug: PLAIN,
    data: {
      headline: "Hello",
      tagline: "Short",
      notes: "Long",
      _overwrite: true,
    },
  });
  await nextly.updateSingle({
    slug: HOOKED,
    data: { headline: "Sale", audience: "members", _overwrite: true },
  });
  await nextly.updateSingle({
    slug: RULED,
    data: { headline: "Open day", audience: "everyone", _overwrite: true },
  });
  return nextly;
}

async function bootLocalized(dialect: TestDialect): Promise<SingleReads> {
  current = await createTestNextly({
    dialect,
    localization: { locales: ["en", "es"], defaultLocale: "en" },
    singles: [
      defineSingle({
        slug: WORDS,
        localized: true,
        fields: [
          text({ name: "headline", localized: true }),
          text({ name: "subhead", localized: true }),
          text({ name: "code" }),
        ],
      }),
    ],
  });
  const nextly = reads(current);
  await nextly.updateSingle({
    slug: WORDS,
    locale: "en",
    data: {
      headline: "Hello",
      subhead: "Welcome",
      code: "W1",
      _overwrite: true,
    },
  });
  await nextly.updateSingle({
    slug: WORDS,
    locale: "es",
    data: { headline: "Hola", subhead: "Bienvenido", _overwrite: true },
  });
  return nextly;
}

/** The keys any selected read answers besides the fields it names. */
const ALWAYS = new Set(["id", "_rev", ...SYSTEM_TIMESTAMP_KEYS]);

/** The keys of `doc` that are neither always answered nor named in `fields`. */
function unasked(doc: Doc, fields: string[]): string[] {
  return Object.keys(doc).filter(
    key => !ALWAYS.has(key) && !fields.includes(key)
  );
}

async function execute(dialect: TestDialect, sql: string): Promise<void> {
  const q = (name: string) =>
    dialect === "mysql" ? `\`${name}\`` : `"${name}"`;
  await (
    current!.adapter as unknown as { executeQuery(s: string): Promise<unknown> }
  ).executeQuery(sql.replace(/\{(\w+)\}/g, (_, name: string) => q(name)));
}

/** The error `work` rejects with, or undefined when it resolves. */
async function refusal(work: () => Promise<unknown>): Promise<unknown> {
  return work().then(
    () => undefined,
    (error: unknown) => error
  );
}

function expectColumnNotMigrated(error: unknown, slug: string, field: string) {
  expect(NextlyError.is(error), "a NextlyError").toBe(true);
  expect(error).toMatchObject({
    code: "ENTITY_NOT_MIGRATED",
    publicData: { kind: "single", slug, reason: "column", field },
  });
}

describe.each(getConfiguredTestDialects())(
  "a Single's read with select (%s)",
  dialect => {
    it("answers only the selected fields, with the values a whole read gives", async () => {
      const nextly = await boot(dialect);
      const whole = await nextly.findSingle({ slug: PLAIN });
      const selected = await nextly.findSingle({
        slug: PLAIN,
        // A `false` entry is ignored, as on a collection read.
        select: { headline: true, notes: false },
      });

      expect(selected.headline).toBe("Hello");
      expect(selected.headline).toBe(whole.headline);
      expect(selected.id).toBe(whole.id);
      expect(selected.updatedAt).toEqual(whole.updatedAt);
      expect(unasked(selected, ["headline"])).toEqual([]);
      // The whole read carries the fields the selected one leaves out.
      expect(unasked(whole, ["headline"])).toEqual(
        expect.arrayContaining(["tagline", "notes"])
      );
    }, 120_000);

    it("answers the whole document when the selection includes nothing", async () => {
      const nextly = await boot(dialect);
      const whole = await nextly.findSingle({ slug: PLAIN });
      const allFalse = await nextly.findSingle({
        slug: PLAIN,
        select: { headline: false },
      });
      const empty = await nextly.findSingle({ slug: PLAIN, select: {} });

      expect(allFalse).toEqual(whole);
      expect(empty).toEqual(whole);
    }, 120_000);

    it("answers a localized Single's selected fields in the read's language", async () => {
      const nextly = await bootLocalized(dialect);
      for (const locale of ["en", "es"]) {
        const whole = await nextly.findSingle({ slug: WORDS, locale });
        const selected = await nextly.findSingle({
          slug: WORDS,
          locale,
          select: { headline: true, code: true },
        });
        expect(selected.headline, locale).toBe(whole.headline);
        expect(selected.code, locale).toBe(whole.code);
        expect(unasked(selected, ["headline", "code"]), locale).toEqual([]);
      }
      const es = await nextly.findSingle({
        slug: WORDS,
        locale: "es",
        select: { headline: true },
      });
      expect(es.headline).toBe("Hola");
      // The shared field, read from the Single's own table.
      const shared = await nextly.findSingle({
        slug: WORDS,
        locale: "es",
        select: { code: true },
      });
      expect(shared.code).toBe("W1");
      expect(unasked(shared, ["code"])).toEqual([]);
    }, 120_000);

    it("reads a selection whose fields have columns, while an unselected field's column is missing", async () => {
      const nextly = await boot(dialect);
      // As a field added in code leaves the table until `nextly migrate` runs:
      // declared, and without a column. Dropped here in the test only.
      await execute(
        dialect,
        `ALTER TABLE {single_${PLAIN}} DROP COLUMN {notes}`
      );

      const selected = await nextly.findSingle({
        slug: PLAIN,
        select: { headline: true, tagline: true },
      });
      expect(selected.headline).toBe("Hello");
      expect(selected.tagline).toBe("Short");
      expect(unasked(selected, ["headline", "tagline"])).toEqual([]);

      // A read that needs the missing column is refused as before.
      expectColumnNotMigrated(
        await refusal(() =>
          nextly.findSingle({ slug: PLAIN, select: { notes: true } })
        ),
        PLAIN,
        "notes"
      );
      expectColumnNotMigrated(
        await refusal(() => nextly.findSingle({ slug: PLAIN })),
        PLAIN,
        "notes"
      );
    }, 120_000);

    it("hands an afterRead hook the fields the caller left out, and answers without them", async () => {
      const nextly = await boot(dialect);
      const selected = await nextly.findSingle({
        slug: HOOKED,
        select: { headline: true },
      });

      expect(seen[HOOKED]).toEqual(["members"]);
      expect(selected.headline).toBe("Sale for members");
      expect(unasked(selected, ["headline"])).toEqual([]);
    }, 120_000);

    it("judges a field read rule on the fields the caller left out, and answers without them", async () => {
      const nextly = await boot(dialect);
      const selected = await nextly.findSingle({
        slug: RULED,
        select: { headline: true },
        enforceFieldAccess: true,
      });

      expect(seen[RULED].length).toBeGreaterThan(0);
      expect(new Set(seen[RULED])).toEqual(new Set(["everyone"]));
      expect(selected.headline).toBe("Open day");
      expect(unasked(selected, ["headline"])).toEqual([]);
    }, 120_000);
  }
);
