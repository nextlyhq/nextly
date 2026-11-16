/**
 * A relationship holding a list, marked unique, is refused by the Schema Builder on every dialect,
 * at the create and at a later save alike, before any statement runs.
 *
 * "Unique" on a list would mean no two entries hold the identical list, which is rarely what is
 * meant, and no dialect keeps it well: PostgreSQL's index refuses a row once the list holds about a
 * hundred ids, MySQL cannot key the column at all, and SQLite keys the whole list. So the Builder
 * refuses the mark the same way everywhere, naming the field and what to do instead, and nothing is
 * built for it.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { clearServices } from "../../../di/register";
import { dispatchCollections } from "../../../dispatcher/handlers/collection-dispatcher";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { ServiceContainer } from "../../../services";

/** A Builder action, as a development server runs it, where it applies its DDL first. */
async function inDevelopment<T>(run: () => Promise<T>): Promise<T> {
  const previous = process.env.NODE_ENV;
  vi.stubEnv("NODE_ENV", "development");
  try {
    return await run();
  } finally {
    vi.stubEnv("NODE_ENV", previous);
  }
}

function dispatch(
  method: string,
  params: Record<string, unknown>,
  body: Record<string, unknown>
): Promise<unknown> {
  return inDevelopment(() =>
    dispatchCollections({} as ServiceContainer, method, params, body)
  );
}

/** A relationship to the target collection holding a list, on the row. */
function listOfTags(unique: boolean): Record<string, unknown> {
  return {
    name: "tags",
    type: "relationship",
    relationTo: "uql_tags",
    // As the Builder's create takes a relationship: its target and relation type as options too.
    options: { target: "uql_tags", relationType: "manyToOne" },
    hasMany: true,
    ...(unique ? { unique: true } : {}),
  };
}

/** The refusal, naming the field and what to do instead. */
const REFUSED = {
  publicData: {
    errors: [
      expect.objectContaining({
        path: "fields.tags",
        code: "UNIQUE_NOT_ON_LIST",
        message: expect.stringContaining(
          'Turn Unique off on "tags", or make it a single link.'
        ),
      }),
    ],
  },
};

for (const dialect of getConfiguredTestDialects()) {
  describe(`a list relationship marked unique is refused — ${dialect}`, () => {
    let t: TestNextly | undefined;
    let projectRoot: string;

    beforeEach(async () => {
      projectRoot = await mkdtemp(join(tmpdir(), "nextly-unique-list-"));
      vi.spyOn(process, "cwd").mockReturnValue(projectRoot);
      clearServices();
      t = await createTestNextly({ dialect, basePath: projectRoot });
      await dispatch(
        "createCollection",
        {},
        {
          name: "uql_tags",
          label: "Tags",
          fields: [{ name: "label", type: "text" }],
        }
      );
    }, 120_000);

    afterEach(async () => {
      await t?.destroy();
      t = undefined;
      clearServices();
      vi.restoreAllMocks();
      vi.unstubAllEnvs();
      await rm(projectRoot, { recursive: true, force: true });
    });

    it("at the create, building nothing", async () => {
      await expect(
        dispatch(
          "createCollection",
          {},
          { name: "uql_posts", label: "Posts", fields: [listOfTags(true)] }
        )
      ).rejects.toMatchObject(REFUSED);
      expect(await t!.adapter.tableExists("dc_uql_posts")).toBe(false);
    }, 120_000);

    it("at a later save that marks it unique", async () => {
      await dispatch(
        "createCollection",
        {},
        { name: "uql_posts", label: "Posts", fields: [listOfTags(false)] }
      );
      await expect(
        dispatch(
          "applySchemaChanges",
          { collectionName: "uql_posts" },
          { fields: [listOfTags(true)], confirmed: true, schemaVersion: 1 }
        )
      ).rejects.toMatchObject(REFUSED);
    }, 120_000);
  });
}
