/**
 * A field a config reload adds under `next dev` is still read after the schema follow loads the
 * definitions again, on every configured dialect.
 *
 * A reload of the definitions registers the configuration's own collections and Singles over their
 * registry rows, as the start does. It must take the configuration as it now stands: a reload that
 * took the one the process started with put a Single's start-time fields back over the field the
 * config reload added, and the field was not read again until a restart.
 *
 * The configuration is driven through `reloadNextlyConfig` itself, the loader handed each edit; the
 * follow is caused as another copy causes it, by moving the stored version and letting the read
 * interval pass.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { defineConfig, defineSingle, text } from "../../config";
import { storeSchemaVersion } from "../../domains/schema/schema-version";
import { SCHEMA_VERSION_READ_INTERVAL_MS } from "../../domains/schema/stored-schema-seq";
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

const SLUG = "rcff_banner";

/** The Single as the start knows it, or with the field the edit adds. */
const banner = (edited: boolean) =>
  defineSingle({
    slug: SLUG,
    fields: [
      text({ name: "title" }),
      ...(edited ? [text({ name: "subtitle" })] : []),
    ],
  });

describe.each(getConfiguredTestDialects())(
  "a field a config reload adds, through the schema follow (%s)",
  dialect => {
    let handle: TestNextly | undefined;

    afterEach(async () => {
      await handle?.destroy();
      handle = undefined;
      vi.unstubAllEnvs();
    });

    it("is still read once the definitions load again", async () => {
      handle = await createTestNextly({
        ...(dialect === "sqlite" ? {} : { dialect }),
        singles: [banner(false)],
      });
      // The config reload applies schema changes only under next dev.
      vi.stubEnv("NODE_ENV", "development");

      // The edit: the Single gains a field, applied by the config reload.
      loaded.config = defineConfig({ singles: [banner(true)] });
      await reloadNextlyConfig();
      await handle.nextly.updateSingle({
        slug: SLUG,
        data: { title: "Banner", subtitle: "Added", _overwrite: true },
      } as never);

      // Another copy's registry write moves the stored version; once the read interval has passed
      // this copy follows it, loading the definitions again.
      await storeSchemaVersion(handle.adapter.getDrizzle(), dialect, {
        wrote: true,
      });
      await new Promise(resolve =>
        setTimeout(resolve, SCHEMA_VERSION_READ_INTERVAL_MS + 250)
      );

      const read = (await handle.nextly.findSingle({ slug: SLUG })) as {
        subtitle?: unknown;
      };
      expect(read.subtitle).toBe("Added");
    }, 120_000);
  }
);
