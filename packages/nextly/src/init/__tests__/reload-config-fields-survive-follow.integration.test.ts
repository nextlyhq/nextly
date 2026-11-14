/**
 * A field a config reload adds under `next dev` is still read after the schema follow loads the
 * definitions again, on every configured dialect.
 *
 * A reload of the definitions registers the configuration's own collections and Singles over their
 * registry rows, as the start does. It must take the configuration as it now stands: a reload that
 * took the one the process started with put a Single's start-time fields back over the field the
 * config reload added, and the field was not read again until a restart.
 *
 * A reload that lands only in part takes the entities that advanced and no others: a Single whose
 * table and registry row moved is read with its new field after the follow, while a Single whose
 * metadata the registry refused keeps the definition it had before.
 *
 * The configuration is driven through `reloadNextlyConfig` itself, the loader handed each edit; the
 * follow is caused as another copy causes it, by moving the stored version and letting the read
 * interval pass.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { defineConfig, defineSingle, text } from "../../config";
import { storeSchemaVersion } from "../../domains/schema/schema-version";
import { SingleRegistryService } from "../../domains/singles/services/single-registry-service";
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

const NOTICE = "rcff_notice";

/** A second Single, edited in the same save, whose registry write the test refuses. */
const notice = (edited: boolean) =>
  defineSingle({
    slug: NOTICE,
    fields: [
      text({ name: "headline" }),
      ...(edited ? [text({ name: "note" })] : []),
    ],
  });

/** Moves the stored version as another copy's registry write does, and waits for the follow. */
async function followAnotherCopy(
  handle: TestNextly,
  dialect: Parameters<typeof storeSchemaVersion>[1]
) {
  await storeSchemaVersion(handle.adapter.getDrizzle(), dialect, {
    wrote: true,
  });
  await new Promise(resolve =>
    setTimeout(resolve, SCHEMA_VERSION_READ_INTERVAL_MS + 250)
  );
}

describe.each(getConfiguredTestDialects())(
  "a field a config reload adds, through the schema follow (%s)",
  dialect => {
    let handle: TestNextly | undefined;

    afterEach(async () => {
      vi.restoreAllMocks();
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
      await followAnotherCopy(handle, dialect);

      const read = (await handle.nextly.findSingle({ slug: SLUG })) as {
        subtitle?: unknown;
      };
      expect(read.subtitle).toBe("Added");
    }, 120_000);
    it("keeps an advanced Single's field after a reload that another Single held back", async () => {
      handle = await createTestNextly({
        ...(dialect === "sqlite" ? {} : { dialect }),
        singles: [banner(false), notice(false)],
      });
      vi.stubEnv("NODE_ENV", "development");

      // The registry refuses the second Single's metadata, as a failed write reports it: its table
      // moves with the apply, its row keeps the fields it had, and the reload does not land whole.
      const sync = SingleRegistryService.prototype.syncCodeFirstSingles;
      const refused = vi
        .spyOn(SingleRegistryService.prototype, "syncCodeFirstSingles")
        .mockImplementation(async function (
          this: SingleRegistryService,
          configs,
          options
        ) {
          const result = await sync.call(
            this,
            configs.filter(config => config.slug !== NOTICE),
            options
          );
          return {
            ...result,
            errors: [...result.errors, { slug: NOTICE, error: "refused" }],
          };
        });

      // One save edits both: the banner gains a field, and so does the notice.
      loaded.config = defineConfig({ singles: [banner(true), notice(true)] });
      await reloadNextlyConfig();
      expect(refused).toHaveBeenCalled();
      refused.mockRestore();

      await handle.nextly.updateSingle({
        slug: SLUG,
        data: { title: "Banner", subtitle: "Added", _overwrite: true },
      } as never);
      await handle.nextly.updateSingle({
        slug: NOTICE,
        data: { headline: "Notice", _overwrite: true },
      } as never);

      await followAnotherCopy(handle, dialect);

      // The banner advanced in full, table and row, so its field is still read.
      const banner_ = (await handle.nextly.findSingle({ slug: SLUG })) as {
        subtitle?: unknown;
      };
      expect(banner_.subtitle).toBe("Added");
      // The notice did not: it keeps the definition it had before the save, as its row does,
      // rather than the one the registry refused.
      const notice_ = (await handle.nextly.findSingle({ slug: NOTICE })) as {
        headline?: unknown;
        note?: unknown;
      };
      expect(notice_.headline).toBe("Notice");
      // Its table has the column the apply added, so a definition that named the field would read
      // it, empty; the definition it kept does not name it.
      expect(Object.keys(notice_)).not.toContain("note");
    }, 120_000);
  }
);
