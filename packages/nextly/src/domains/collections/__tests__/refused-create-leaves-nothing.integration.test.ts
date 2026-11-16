/**
 * A Builder create the server refuses leaves nothing behind, for every kind, on a real database
 * of each dialect: no table and no registry row.
 *
 * The Schema Builder saves a new collection, Single or field group by its create, with every
 * field at once. A create refused for its fields, after its address passed, must not have built
 * the entity's table or recorded it: the editor keeps the entity unsaved, and a later save under
 * the same address has to find it free. The refusal here is two fields under one name, which
 * every kind refuses (a collection drops a field named after a system field rather than refusing
 * it, so that refusal would not reach every kind).
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { clearServices } from "../../../di/register";
import { dispatchCollections } from "../../../dispatcher/handlers/collection-dispatcher";
import { dispatchComponents } from "../../../dispatcher/handlers/component-dispatcher";
import { dispatchSingles } from "../../../dispatcher/handlers/single-dispatcher";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { STORAGE_FORMAT } from "../../../schemas/storage-format";
import type { ServiceContainer } from "../../../services";
import type { AddressKind } from "../../../shared/address-rule";

/** Fields every kind's create refuses: two of them share one name. */
const REFUSED_FIELDS = [
  { name: "price", type: "text" },
  { name: "price", type: "number" },
];

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

function create(kind: AddressKind, address: string): Promise<unknown> {
  return inDevelopment(() => {
    if (kind === "collection") {
      return dispatchCollections(
        {} as ServiceContainer,
        "createCollection",
        {},
        { name: address, label: "Thing", fields: REFUSED_FIELDS }
      );
    }
    if (kind === "single") {
      return dispatchSingles(
        "createSingle",
        {},
        { slug: address, label: "Thing", fields: REFUSED_FIELDS }
      );
    }
    return dispatchComponents(
      "createComponent",
      {},
      { slug: address, label: "Thing", fields: REFUSED_FIELDS }
    );
  });
}

/** The table each kind's create would build for `address`. */
const TABLE: Record<AddressKind, (address: string) => string> = {
  collection: address => `dc_${address}`,
  single: address => `single_${address}`,
  fieldGroup: address => `comp_${address}`,
};

for (const dialect of getConfiguredTestDialects()) {
  describe(`a refused Builder create leaves nothing behind — ${dialect}`, () => {
    let t: TestNextly | undefined;
    let projectRoot: string;

    beforeEach(async () => {
      projectRoot = await mkdtemp(join(tmpdir(), "nextly-refused-create-"));
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

    /** Every address the registries hold, by table. */
    async function registered(): Promise<string[]> {
      const rows = await Promise.all(
        [
          "dynamic_collections",
          "dynamic_singles",
          STORAGE_FORMAT.registryTable,
        ].map(async table =>
          (
            await t!.adapter.select<{ slug: string }>(table, {
              columns: ["slug"],
            })
          ).map(row => `${table}:${row.slug}`)
        )
      );
      return rows.flat().sort();
    }

    it.each(["collection", "single", "fieldGroup"] as const)(
      "a %s whose fields are refused: no table, no registry row",
      async kind => {
        const before = await registered();
        await expect(create(kind, "refused_thing")).rejects.toBeDefined();
        expect(await registered()).toEqual(before);
        expect(await t!.adapter.tableExists(TABLE[kind]("refused_thing"))).toBe(
          false
        );
      },
      120_000
    );
  });
}
