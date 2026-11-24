/**
 * A field group whose storage a project has not migrated yet fails as it always did, and only
 * storage the field-group migration moved is refused as moving.
 *
 * Both are the same database error, a table or a column that is missing. Refused as moving, a save
 * of a group that was never created would be told to retry, and refused again on every retry.
 * The site's database is put in each state directly, under a server that keeps running, and the
 * server then reads and saves through its ordinary entry points, so a save runs on its own
 * transaction, as a real one does.
 *
 * @module domains/field-groups/__tests__/field-group-storage-not-migrated-yet.integration.test
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const loaded = vi.hoisted(() => ({ config: undefined as unknown }));
vi.mock("../../../cli/utils/config-loader", async importOriginal => ({
  ...(await importOriginal<
    typeof import("../../../cli/utils/config-loader")
  >()),
  loadConfig: async () => ({
    config: loaded.config,
    configPath: "/virtual/nextly.config.ts",
    dependencies: [],
  }),
}));

import {
  defineCollection,
  defineFieldGroup,
  fieldGroup,
  text,
} from "../../../config";
import { getConfiguredTestDialects } from "../../../plugins/test-nextly";

import {
  openStorageGenerationSite,
  type StorageGenerationSite,
} from "./helpers/storage-generation-site";

const TABLE = "comp_fgnm_card";
const MOVING = "FIELD_GROUP_STORAGE_MOVING";

const declared = {
  collections: [
    defineCollection({
      slug: "fgnm_posts",
      versions: true,
      fields: [
        text({ name: "title" }),
        fieldGroup({ name: "card", component: "fgnm_card" }),
      ],
    }),
  ],
  fieldGroups: [
    defineFieldGroup({
      slug: "fgnm_card",
      fields: [text({ name: "heading" })],
    }),
  ],
};

let site: StorageGenerationSite | undefined;

afterEach(async () => {
  await site?.close();
  site = undefined;
  vi.unstubAllEnvs();
});

/** An error's code, as a caller acts on it, or `ok`. */
async function outcome(work: Promise<unknown>): Promise<string> {
  try {
    await work;
    return "ok";
  } catch (error) {
    const e = error as {
      code?: unknown;
      publicData?: { errors?: { code?: unknown }[] };
    };
    return String(e.publicData?.errors?.[0]?.code ?? e.code);
  }
}

describe.each(getConfiguredTestDialects())(
  "field-group storage that is missing (%s)",
  dialect => {
    const quoted = (name: string): string =>
      dialect === "mysql" ? `\`${name}\`` : `"${name}"`;

    /** A running site with one entry holding the group, and what a read and two saves come to. */
    const openSite = async () => {
      site = await openStorageGenerationSite({ dialect, loaded, legacy: true });
      const { nextly } = await site.developmentStart(declared);
      const created = await nextly.create({
        collection: "fgnm_posts" as never,
        data: { title: "P", card: { heading: "Kept" } } as never,
      });
      const id = (created.item as { id: string }).id;
      const save = () =>
        outcome(
          nextly.update({
            collection: "fgnm_posts" as never,
            id,
            data: { card: { heading: "New" }, _overwrite: true } as never,
          })
        );
      const read = () =>
        outcome(nextly.findByID({ collection: "fgnm_posts" as never, id }));
      return { save, read };
    };

    it("keeps a save's own error, on every try, when the group's table is not there yet", async () => {
      const { save, read } = await openSite();
      await site!.adapter.executeQuery(`DROP TABLE ${quoted(TABLE)}`);

      const tries = [await save(), await save()];
      expect(tries).toEqual(["INTERNAL_ERROR", "INTERNAL_ERROR"]);
      // Read as empty, as a group whose migration has not run.
      expect(await read()).toBe("ok");
    });

    it("keeps a save's own error, on every try, when a column of the project's is not there yet", async () => {
      const { save } = await openSite();
      await site!.adapter.executeQuery(
        `ALTER TABLE ${quoted(TABLE)} DROP COLUMN ${quoted("heading")}`
      );

      const tries = [await save(), await save()];
      expect(tries).toEqual(["INTERNAL_ERROR", "INTERNAL_ERROR"]);
    });

    it("refuses a save to be retried when the migration moved the group's table", async () => {
      const { save } = await openSite();
      await site!.adapter.executeQuery(
        `ALTER TABLE ${quoted(TABLE)} RENAME TO ${quoted("fg_fgnm_card")}`
      );

      expect(await save()).toBe(MOVING);
    });
  }
);
