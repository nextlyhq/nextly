/**
 * A Builder save keeps a camelCase field name a plugin or the API declared, and the field's values
 * with it, on every dialect.
 *
 * The admin sends every stored name as it is. A collection whose `metaTitle` holds a value is
 * saved again through the Builder's apply with that name beside a new field: the registry keeps
 * `metaTitle`, and the entry reads back with its value under `metaTitle`.
 *
 * Every save runs under `NODE_ENV=development`, where a Builder save applies its DDL at once.
 */
// Set before the harness boots (env validation reads it once).
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { dispatchCollections } from "../../../dispatcher/handlers/collection-dispatcher";
import { describeEachDialect } from "../../../plugins/__tests__/helpers/dialect-matrix";
import {
  createTestNextly,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { ServiceContainer } from "../../../services";

type Field = { name: string; type: string };

const DECLARED: Field[] = [
  { name: "body", type: "text" },
  { name: "metaTitle", type: "text" },
];

describeEachDialect(
  "a Builder save of a field with a declared camelCase name",
  dialect => {
    let current: TestNextly;

    beforeEach(async () => {
      vi.stubEnv("NODE_ENV", "development");
      current = await createTestNextly({ dialect, collections: [] });
    });

    afterEach(async () => {
      await current.destroy();
      vi.unstubAllEnvs();
    });

    const q = (name: string) =>
      dialect === "mysql" ? `\`${name}\`` : `"${name}"`;

    /** The registry's field names and schema version for `posts`. */
    async function registered(): Promise<{
      names: string[];
      version: number;
    }> {
      const [row] = await (
        current.adapter as unknown as {
          executeQuery<R>(statement: string): Promise<R[]>;
        }
      ).executeQuery<{ fields: unknown; schema_version: unknown }>(
        `SELECT ${q("fields")} AS fields, ${q("schema_version")} AS schema_version FROM ${q("dynamic_collections")} WHERE ${q("slug")} = 'posts'`
      );
      const fields = (
        typeof row?.fields === "string" ? JSON.parse(row.fields) : row?.fields
      ) as { name: string }[];
      return {
        names: fields.map(field => field.name),
        version: Number(row?.schema_version ?? 1),
      };
    }

    it("keeps the name and its values when it is sent as stored", async () => {
      await dispatchCollections(
        {} as ServiceContainer,
        "createCollection",
        {},
        { name: "posts", label: "Posts", fields: DECLARED }
      );
      expect((await registered()).names).toEqual(["body", "metaTitle"]);
      const created = await current.nextly.create({
        collection: "posts",
        data: { body: "b", metaTitle: "kept" },
      });
      const id = String((created.item as { id: unknown }).id);

      // The Builder's apply, as its Save button sends it: every stored name as it is, and a new
      // field beside them.
      await dispatchCollections(
        {} as ServiceContainer,
        "applySchemaChanges",
        { collectionName: "posts" },
        {
          fields: [...DECLARED, { name: "teaser", type: "text" }],
          confirmed: true,
          schemaVersion: (await registered()).version,
        }
      );

      expect((await registered()).names).toEqual([
        "body",
        "metaTitle",
        "teaser",
      ]);
      expect(
        await current.nextly.findByID({ collection: "posts", id })
      ).toMatchObject({ metaTitle: "kept" });
    });
  }
);
