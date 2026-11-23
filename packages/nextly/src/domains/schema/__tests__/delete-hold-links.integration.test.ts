/**
 * A Builder save that drops a many-to-many's links deletes only the count the person confirmed, as
 * a save that removes a field's values does (`deletionHoldOf`): the review counts the links in the
 * field's link table, and the save counts them again before the statements that drop the table,
 * refusing where a link was added since, with every link kept. The links go where the field is
 * removed; a many-to-many made single or pointed elsewhere drops them the same way, through the
 * same count (`deletionHoldOf`, unit-tested).
 *
 * What separates the count from plausible wrong ones: a review that cannot count the links reads
 * them as unknown, which the save cannot be confirmed against; a save that compares only the row's
 * columns drops a link added after the review uncounted.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { dispatchCollections } from "../../../dispatcher/handlers/collection-dispatcher";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { ServiceContainer } from "../../../services";
import type { FieldDefinition } from "../../../schemas/dynamic-collections";
import { junctionTableNameFor } from "../services/field-column-descriptor";

const POSTS = "dhl_posts";
const TAGS = "dhl_tags";
const POSTS_TABLE = `dc_${POSTS}`;

const TITLE = { name: "title", type: "text" };
const MANY_TAGS = {
  name: "tags",
  type: "relationship",
  relationTo: TAGS,
  hasMany: true,
  options: { target: TAGS, relationType: "manyToMany" },
};

let instance: TestNextly | undefined;
afterEach(async () => {
  vi.unstubAllEnvs();
  await instance?.destroy();
  instance = undefined;
});

describe.each(getConfiguredTestDialects())(
  "a save that drops a many-to-many's links deletes the count confirmed (%s)",
  dialect => {
    const q = (n: string) => (dialect === "mysql" ? `\`${n}\`` : `"${n}"`);
    const linkTable = junctionTableNameFor(
      POSTS_TABLE,
      MANY_TAGS as unknown as FieldDefinition
    );

    /** The app in development, with the tags and the posts linking to them. */
    async function boot(): Promise<TestNextly> {
      vi.stubEnv("NODE_ENV", "development");
      const t = await createTestNextly({
        dialect,
        db: {
          migrationsDir: "./database/history",
          uiSchemaFile: "./schema/builder.json",
        },
      });
      instance = t;
      for (const [name, fields] of [
        [TAGS, [{ name: "label", type: "text" }]],
        [POSTS, [TITLE, MANY_TAGS]],
      ] as const) {
        await dispatchCollections(
          {} as ServiceContainer,
          "createCollection",
          {},
          { name, label: name, fields }
        );
      }
      return t;
    }

    /** A tag, by its id. */
    async function tag(t: TestNextly, label: string): Promise<string> {
      const created = (await t.nextly.create({
        collection: TAGS,
        data: { label },
      } as never)) as unknown as { item: { id: unknown } };
      return String(created.item.id);
    }

    /** A post linked to `tags`. */
    async function post(t: TestNextly, tags: string[]): Promise<void> {
      await t.nextly.create({
        collection: POSTS,
        data: { title: "p", tags },
      } as never);
    }

    async function linksHeld(t: TestNextly): Promise<number | "no table"> {
      try {
        const [row] = await (
          t.adapter as unknown as {
            executeQuery<R>(statement: string): Promise<R[]>;
          }
        ).executeQuery<{ n: number | string }>(
          `SELECT COUNT(*) AS n FROM ${q(linkTable)}`
        );
        return Number(row?.n);
      } catch {
        return "no table";
      }
    }

    async function schemaVersion(t: TestNextly): Promise<number> {
      const [row] = await (
        t.adapter as unknown as {
          executeQuery<R>(statement: string): Promise<R[]>;
        }
      ).executeQuery<{ v: number | string | null }>(
        `SELECT ${q("schema_version")} AS v FROM ${q("dynamic_collections")} WHERE ${q("slug")} = '${POSTS}'`
      );
      return Number(row?.v ?? 1);
    }

    /** A row of the review: a field, and the values the change deletes from it. */
    type ReviewedRow = {
      name: string;
      rowCount?: number;
      rowCountUnknown?: boolean;
    };

    /** What the review shows for `tags` when the posts are given `fields`. */
    async function reviewed(
      fields: unknown[]
    ): Promise<{ rowCount?: number; rowCountUnknown?: boolean } | undefined> {
      const body = (await dispatchCollections(
        {} as ServiceContainer,
        "previewSchemaChanges",
        { collectionName: POSTS },
        { fields }
      )) as Response | Record<string, unknown>;
      const json = (
        body instanceof Response ? await body.json() : body
      ) as Record<string, unknown>;
      const changes = ((json.data ?? json) as { changes?: unknown }).changes as
        | {
            removed?: Array<ReviewedRow>;
            changed?: Array<ReviewedRow>;
          }
        | undefined;
      return [...(changes?.removed ?? []), ...(changes?.changed ?? [])].find(
        field => field.name === "tags"
      );
    }

    async function apply(
      t: TestNextly,
      fields: unknown[],
      confirmed: number
    ): Promise<unknown> {
      return dispatchCollections(
        {} as ServiceContainer,
        "applySchemaChanges",
        { collectionName: POSTS },
        {
          fields,
          confirmed: true,
          schemaVersion: await schemaVersion(t),
          resolutions: { tags: { action: "confirm_drop" } },
          confirmedDeletions: [{ field: "tags", count: confirmed }],
        }
      ).then(
        () => "applied",
        (error: unknown) => error
      );
    }

    const refusedWith = (count: number) => ({
      code: "VALIDATION_ERROR",
      publicData: {
        errors: [
          expect.objectContaining({
            path: "fields.tags",
            code: "DELETION_COUNT_CHANGED",
            message: expect.stringContaining(
              `now holds ${String(count)} value`
            ),
          }),
        ],
      },
    });

    /** Three links: two on one post, one on another. */
    async function threeLinks(t: TestNextly): Promise<string> {
      const a = await tag(t, "a");
      const b = await tag(t, "b");
      await post(t, [a, b]);
      await post(t, [a]);
      expect(await linksHeld(t)).toBe(3);
      return a;
    }

    it("counts a removed many-to-many's links in the review", async () => {
      const t = await boot();
      await threeLinks(t);

      expect(await reviewed([TITLE])).toMatchObject({ rowCount: 3 });
      expect((await reviewed([TITLE]))?.rowCountUnknown).toBeUndefined();
    }, 60_000);

    it("deletes a removed many-to-many's links when their count is still the one confirmed", async () => {
      const t = await boot();
      await threeLinks(t);

      expect(await apply(t, [TITLE], 3)).toBe("applied");
      expect(await linksHeld(t)).toBe("no table");
    }, 60_000);

    it("deletes nothing and names the new count when a link was added after the review", async () => {
      const t = await boot();
      const a = await threeLinks(t);
      // A link written after the review counted three.
      await post(t, [a]);

      expect(await apply(t, [TITLE], 3)).toMatchObject(refusedWith(4));
      expect(await linksHeld(t)).toBe(4);
    }, 60_000);
  }
);
