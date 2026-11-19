/**
 * A field group's many-to-many relationship changing type, judged as any other field's type change
 * on a Schema Builder save, on every dialect and by both roads a field group's save takes: the
 * migration writer (in development with a migrations folder) and the push.
 *
 * On a field group's row a many-to-many keeps its links as a JSON list in a column of its own
 * (`componentRelationshipStoresJson`), where a collection keeps them in a junction table. A
 * judgement asking the collection question finds no column for it, and lets a change of its type
 * through over the links the row holds. What separates the correct judgement from that broken one:
 * the same save is refused, naming the field, and the stored links are kept.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { resetSessionStandingForTests } from "../../../../../auth/session/session-standing";
import { defineCollection, text } from "../../../../../config";
import { dispatchComponents } from "../../../../../dispatcher/handlers/component-dispatcher";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestNextly,
} from "../../../../../plugins/test-nextly";

const TARGETS = "fgm_targets";
const GROUP = "fgm_meta";
const TABLE = `comp_${GROUP}`;

const links = {
  name: "links",
  type: "relationship",
  options: { relationType: "manyToMany", target: TARGETS },
};

let instance: TestNextly | undefined;
afterEach(async () => {
  vi.unstubAllEnvs();
  resetSessionStandingForTests();
  await instance?.destroy();
  instance = undefined;
});

describe.each(getConfiguredTestDialects())(
  "a field group's many-to-many changing type on a Builder save (%s)",
  dialect => {
    const q = (name: string) =>
      dialect === "mysql" ? `\`${name}\`` : `"${name}"`;

    async function boot(road: "writer" | "push"): Promise<TestNextly> {
      const t = await createTestNextly({
        dialect,
        collections: [
          defineCollection({ slug: TARGETS, fields: [text({ name: "name" })] }),
        ],
        ...(road === "writer"
          ? {
              db: {
                migrationsDir: "./database/history",
                uiSchemaFile: "./schema/builder.json",
              },
            }
          : {}),
      });
      instance = t;
      // As the Builder runs: each save is applied here.
      vi.stubEnv("NODE_ENV", "development");
      return t;
    }

    async function storedLinks(t: TestNextly): Promise<unknown> {
      const [row] = (await t.adapter.executeQuery(
        `SELECT ${q("links")} FROM ${q(TABLE)} WHERE ${q("id")} = 'r1'`
      )) as Array<{ links: unknown }>;
      return row?.links;
    }

    it.each(["writer", "push"] as const)(
      "refuses turning it into text over the links it holds, by the %s",
      async road => {
        const t = await boot(road);
        await dispatchComponents(
          "createComponent",
          {},
          { slug: GROUP, label: "Meta", fields: [links] }
        );
        // An instance holding one link, as its row keeps it: a JSON list in its own column.
        await t.adapter.executeQuery(
          `INSERT INTO ${q(TABLE)} (${q("id")}, ${q("_parent_id")}, ${q("_parent_table")}, ${q("_parent_field")}, ${q("links")}) VALUES ('r1', 'p1', 'dc_posts', 'meta', '["t1"]')`
        );
        const before = await storedLinks(t);
        const { schemaVersion } = await t
          .getService("fieldGroupRegistryService")
          .getComponent(GROUP);

        await expect(
          dispatchComponents(
            "applyComponentSchemaChanges",
            { slug: GROUP },
            {
              fields: [{ name: "links", type: "text" }],
              confirmed: true,
              schemaVersion,
            }
          )
        ).rejects.toMatchObject({
          publicData: {
            errors: [
              expect.objectContaining({
                path: "fields.links",
                code: "TYPE_CHANGE_BLOCKED",
              }),
            ],
          },
        });
        // Nothing changed: the definition still says many-to-many, and the links are kept.
        const kept = await t
          .getService("fieldGroupRegistryService")
          .getComponent(GROUP);
        expect(
          (kept.fields as Array<{ name: string; type: string }>).find(
            f => f.name === "links"
          )?.type
        ).toBe("relationship");
        expect(await storedLinks(t)).toEqual(before);
      }
    );
  }
);
