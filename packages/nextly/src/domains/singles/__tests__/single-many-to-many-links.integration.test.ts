/**
 * A Single's many-to-many made in the Schema Builder keeps its links in the junction table its
 * create made, on every dialect: an entry save writes them, a replace and a clear rewrite them, and
 * a read gives them back, as ids where it populates nothing and as rows where it does.
 *
 * The junction is named as the create's SQL names it: the Single's table and the target's,
 * sorted, then the field; its link columns are the Single's table and the target slug, each with
 * `_id`. Spelled out here rather than derived, so a read or write that derived another name would
 * not agree with the test by deriving it the same way.
 */
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { defineCollection, text } from "../../../config";
import { dispatchSingles } from "../../../dispatcher/handlers/single-dispatcher";
import { describeEachDialect } from "../../../plugins/__tests__/helpers/dialect-matrix";
import {
  createTestNextly,
  type TestNextly,
} from "../../../plugins/test-nextly";

// Slugs prefixed for this file (`smm_`), so the tables it owns are its own.
const HERO = "smm_hero";
const TAGS = "smm_tags";
const TABLE = `single_${HERO}`;
const JUNCTION = `dc_${TAGS}_${TABLE}_tags`;
const SOURCE_COLUMN = `${TABLE}_id`;
const TARGET_COLUMN = `${TAGS}_id`;

describeEachDialect("a Builder Single's many-to-many links", dialect => {
  let t: TestNextly;
  let tagIds: string[];

  beforeEach(async () => {
    // The Builder's create runs its migration in development only.
    vi.stubEnv("NODE_ENV", "development");
    t = await createTestNextly({
      dialect,
      collections: [
        defineCollection({ slug: TAGS, fields: [text({ name: "name" })] }),
      ],
    });
    await dispatchSingles(
      "createSingle",
      {},
      {
        slug: HERO,
        label: "Hero",
        fields: [
          { name: "title", type: "text" },
          {
            name: "tags",
            type: "relationship",
            options: { relationType: "manyToMany", target: TAGS },
          },
        ],
      }
    );
    tagIds = [];
    for (const name of ["a", "b", "c"]) {
      const created = await t.nextly.create({
        collection: TAGS,
        data: { name },
      });
      tagIds.push(String(created.item.id));
    }
  });

  afterEach(async () => {
    await t.destroy();
    vi.unstubAllEnvs();
  });

  const quote = (name: string) =>
    dialect === "mysql" ? `\`${name}\`` : `"${name}"`;
  const query = <T>(statement: string): Promise<T[]> =>
    (
      t.adapter as unknown as {
        executeQuery<R>(sql: string): Promise<R[]>;
      }
    ).executeQuery<T>(statement);

  /** The tags the junction links to the Single's row, sorted. */
  async function linked(): Promise<string[]> {
    const [row] = await query<{ id: string }>(
      `SELECT ${quote("id")} AS ${quote("id")} FROM ${quote(TABLE)}`
    );
    expect(row, "the Single's row").toBeDefined();
    const links = await query<{ source: string; target: string }>(
      `SELECT ${quote(SOURCE_COLUMN)} AS ${quote("source")}, ${quote(TARGET_COLUMN)} AS ${quote("target")} FROM ${quote(JUNCTION)}`
    );
    for (const link of links) expect(String(link.source)).toBe(String(row!.id));
    return links.map(link => String(link.target)).sort();
  }

  const save = (tags: string[]) =>
    t.nextly.updateSingle({
      slug: HERO,
      data: { title: "Hero", tags, _overwrite: true },
    });

  /** The Single's `tags` as a read at `depth` gives them. */
  async function read(depth: number): Promise<unknown[]> {
    const doc = (await t.nextly.findSingle({ slug: HERO, depth })) as {
      tags?: unknown[];
    } | null;
    return doc?.tags ?? [];
  }
  const idsOf = (tags: unknown[]) =>
    tags
      .map(tag =>
        typeof tag === "object" && tag !== null
          ? String((tag as { id: unknown }).id)
          : String(tag)
      )
      .sort();

  it("writes the links an entry save sends into its junction table", async () => {
    const [a, b] = tagIds;
    await save([a!, b!]);

    expect(await linked()).toEqual([a, b].sort());
  });

  it("reads them back, as ids where the read populates nothing and as rows where it does", async () => {
    const [a, b] = tagIds;
    await save([a!, b!]);

    const stored = await read(0);
    expect(stored.every(tag => typeof tag === "string")).toBe(true);
    expect(idsOf(stored)).toEqual([a, b].sort());

    const populated = await read(1);
    expect(
      populated.every(tag => typeof tag === "object" && tag !== null)
    ).toBe(true);
    expect(idsOf(populated)).toEqual([a, b].sort());
    expect(
      populated.map(tag => (tag as { name?: unknown }).name).sort()
    ).toEqual(["a", "b"]);
  });

  it("replaces the links with the ones a later save sends", async () => {
    const [a, b, c] = tagIds;
    await save([a!, b!]);

    await save([b!, c!]);

    expect(await linked()).toEqual([b, c].sort());
    expect(idsOf(await read(0))).toEqual([b, c].sort());
  });

  it("clears the links when a save sends none", async () => {
    const [a, b] = tagIds;
    await save([a!, b!]);
    // Held first, so an empty junction after the clear is the clear's doing.
    expect(await linked()).toEqual([a, b].sort());

    await save([]);

    expect(await linked()).toEqual([]);
    expect(await read(0)).toEqual([]);
  });
});
