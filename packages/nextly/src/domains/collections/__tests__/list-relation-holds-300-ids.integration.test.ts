/**
 * A list relationship marked unique still saves a long list, on a real database of each dialect.
 *
 * "Unique" on a relation holding a list would mean no two entries hold the identical list, which
 * is rarely what is meant, and a unique index over the stored list refuses a row on PostgreSQL once
 * the list holds about a hundred ids ("index row size exceeds btree version 4 maximum"). So such a
 * relation is never made unique on any dialect, and a Builder collection whose list relation
 * carries the mark builds no unique index for it: a row holding 300 related ids is kept.
 *
 * Built through the Builder's own create, as a development server runs it, and written straight to
 * the table, so what is judged is the index the create built and nothing above it.
 */
import { randomUUID } from "node:crypto";
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

/** A Builder create, as a development server runs it, where it applies its DDL first. */
async function inDevelopment<T>(run: () => Promise<T>): Promise<T> {
  const previous = process.env.NODE_ENV;
  vi.stubEnv("NODE_ENV", "development");
  try {
    return await run();
  } finally {
    vi.stubEnv("NODE_ENV", previous);
  }
}

function createCollection(
  name: string,
  fields: Record<string, unknown>[]
): Promise<unknown> {
  return inDevelopment(() =>
    dispatchCollections(
      {} as ServiceContainer,
      "createCollection",
      {},
      { name, label: name, fields }
    )
  );
}

/** As many ids as the list holds: each a UUID, as an entry's id is. */
const IDS = Array.from({ length: 300 }, () => randomUUID());

for (const dialect of getConfiguredTestDialects()) {
  describe(`a list relationship marked unique keeps a long list — ${dialect}`, () => {
    let t: TestNextly | undefined;
    let projectRoot: string;

    beforeEach(async () => {
      projectRoot = await mkdtemp(join(tmpdir(), "nextly-list-unique-"));
      vi.spyOn(process, "cwd").mockReturnValue(projectRoot);
      clearServices();
      t = await createTestNextly({ dialect, basePath: projectRoot });
    }, 120_000);

    afterEach(async () => {
      await t?.destroy();
      t = undefined;
      clearServices();
      vi.restoreAllMocks();
      vi.unstubAllEnvs();
      await rm(projectRoot, { recursive: true, force: true });
    });

    it("a row holding 300 related ids is saved", async () => {
      await createCollection("tags", [{ name: "label", type: "text" }]);
      await createCollection("posts", [
        {
          name: "tags",
          type: "relationship",
          relationTo: "tags",
          // As the Builder's create takes a relationship: its target and
          // relation type as options too. A list on the row, not a junction.
          options: { target: "tags", relationType: "manyToOne" },
          hasMany: true,
          unique: true,
        },
      ]);

      const id = randomUUID();
      const now = new Date();
      await t!.adapter.insert("dc_posts", {
        id,
        title: "A post",
        slug: "a-post",
        // The list as its JSON column stores it, on every dialect.
        tags: JSON.stringify(IDS),
        created_at: now,
        updated_at: now,
      });

      const rows = await t!.adapter.select<{ id: string }>("dc_posts", {
        columns: ["id"],
      });
      expect(rows.map(row => row.id)).toEqual([id]);
    }, 120_000);
  });
}
