// A config reload under `next dev` holds back a collection whose field type change, keeping its
// column, would clear a value the new type cannot read: the change plans no statement, so only the
// per-value judgement sees it. The reload warns and names it, its registry row keeps the old field,
// and the rest of the reload lands. Driving `reloadNextlyConfig` itself, on each configured dialect.
import { afterEach, describe, expect, it, vi } from "vitest";

import { defineCollection, defineConfig } from "../../config";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestNextly,
} from "../../plugins/test-nextly";
import { reloadNextlyConfig } from "../reload-config";

const loaded = vi.hoisted(() => ({
  config: undefined as unknown,
}));

vi.mock("../../cli/utils/config-loader", async importOriginal => ({
  ...(await importOriginal<typeof import("../../cli/utils/config-loader")>()),
  loadConfig: async () => ({
    config: loaded.config,
    configPath: "",
    dependencies: [],
  }),
}));

const HELD = "rlheld";
const OTHER = "rlother";

/**
 * Two collections: `rlheld`'s `heading` a text, or after the edit a select of one option; `rlother`
 * with or, after the edit, without a second field.
 */
const configWith = (edited: boolean) =>
  defineConfig({
    collections: [
      defineCollection({
        slug: HELD,
        fields: [
          edited
            ? {
                name: "heading",
                type: "select",
                options: [{ label: "A", value: "a" }],
              }
            : { name: "heading", type: "text" },
        ] as never,
      }),
      defineCollection({
        slug: OTHER,
        fields: [
          { name: "title", type: "text" },
          ...(edited ? [{ name: "extra", type: "text" }] : []),
        ] as never,
      }),
    ],
  });

describe.each(getConfiguredTestDialects())(
  "a config reload over a type change that would clear a value (%s)",
  dialect => {
    let handle: TestNextly | undefined;

    afterEach(async () => {
      vi.unstubAllEnvs();
      vi.restoreAllMocks();
      await handle?.destroy();
      handle = undefined;
    });

    /** The type `rlheld`'s registry row records for `heading`. */
    async function recordedHeadingType(): Promise<unknown> {
      const [row] = (await handle!.adapter.executeQuery(
        `SELECT fields FROM dynamic_collections WHERE slug = '${HELD}'`
      )) as Array<{ fields: unknown }>;
      const fields = (
        typeof row?.fields === "string" ? JSON.parse(row.fields) : row?.fields
      ) as Array<{ name: string; type: string }> | undefined;
      return fields?.find(field => field.name === "heading")?.type;
    }

    it("holds that collection back, keeps its value and registry row, and lands the rest", async () => {
      handle = await createTestNextly({ dialect });
      // The reload runs its schema work only under next dev.
      vi.stubEnv("NODE_ENV", "development");
      loaded.config = configWith(false);
      await reloadNextlyConfig();
      await handle.adapter.executeQuery(
        `INSERT INTO dc_${HELD} (id, title, slug, heading) VALUES ('r1', 'T', 'r1', 'Hello')`
      );
      expect(await recordedHeadingType()).toBe("text");
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      loaded.config = configWith(true);

      await reloadNextlyConfig();

      // Held back, and said so, naming the collection and the field.
      const warned = warn.mock.calls.flat().map(String).join(" ");
      expect(warned).toContain(HELD);
      expect(warned).toMatch(/heading/);
      // Its registry row still records the old field, and its value is untouched.
      expect(await recordedHeadingType()).toBe("text");
      const [held] = (await handle.adapter.executeQuery(
        `SELECT heading FROM dc_${HELD} WHERE id = 'r1'`
      )) as Array<{ heading: string }>;
      expect(held?.heading).toBe("Hello");
      // The other collection's change landed: its new column is there.
      await expect(
        handle.adapter.executeQuery(`SELECT extra FROM dc_${OTHER}`)
      ).resolves.toBeDefined();
    });
  }
);
