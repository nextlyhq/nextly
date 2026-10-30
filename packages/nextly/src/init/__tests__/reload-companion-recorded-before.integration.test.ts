// A config reload under `next dev` judges a field it newly translates against the registry as it
// was before the reload rewrote it, driving `reloadNextlyConfig` itself against SQLite.
//
// The reload's companion pass takes a translations column already there as the field's own. For a
// field the reload newly translates, that column may be another field's leftover, and one that
// cannot hold the field is reported and left alone. A reload only warns: a running dev server
// keeps serving. Read after the reload rewrote the registry, the field would look translated
// already and be taken without a word, so the warning naming the column is what separates the two.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { defineCollection, defineConfig } from "../../config";
import { createTestNextly, type TestNextly } from "../../plugins/test-nextly";
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

const SLUG = "rlbefore";
const COMPANION = `dc_${SLUG}_locales`;

const configWith = (code: "absent" | "shared" | "translated") =>
  defineConfig({
    localization: { locales: ["en", "es"], defaultLocale: "en" },
    collections: [
      defineCollection({
        slug: SLUG,
        localized: true,
        fields: [
          { name: "title", type: "text", localized: true },
          ...(code === "absent"
            ? []
            : [
                {
                  name: "code",
                  type: "text",
                  localized: code === "translated",
                },
              ]),
        ] as never,
      }),
    ],
  });

describe("a config reload that newly translates a field over a leftover column", () => {
  let handle: TestNextly;

  beforeEach(async () => {
    handle = await createTestNextly({});
    // The reload runs its schema work only under next dev.
    vi.stubEnv("NODE_ENV", "development");
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    await handle?.destroy();
  });

  async function codeColumnType(): Promise<string | undefined> {
    const rows = (await handle.adapter.executeQuery(
      `PRAGMA table_info("${COMPANION}")`
    )) as Array<{ name: string; type: string }>;
    return rows.find(row => row.name === "code")?.type;
  }

  it("warns naming the column, and leaves it as it is", async () => {
    loaded.config = configWith("absent");
    await reloadNextlyConfig();
    expect(await codeColumnType()).toBeUndefined();
    await handle.adapter.executeQuery(
      `ALTER TABLE "${COMPANION}" ADD COLUMN "code" INTEGER`
    );
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    loaded.config = configWith("translated");
    await reloadNextlyConfig();

    expect(warn.mock.calls.flat().join(" ")).toMatch(
      /column "code" \((?:INTEGER|integer)\) that cannot hold every value code allows/
    );
    expect(await codeColumnType()).toBe("INTEGER");
  });

  async function mainHasCode(): Promise<boolean> {
    const rows = (await handle.adapter.executeQuery(
      `PRAGMA table_info("dc_${SLUG}")`
    )) as Array<{ name: string }>;
    return rows.some(row => row.name === "code");
  }

  // A reload's apply moves a shared field's values into the translations table before it drops the
  // field's main column, and the move takes a column already there as the field's.
  it("refuses a shared field joining translation over it before the apply drops its column", async () => {
    loaded.config = configWith("shared");
    await reloadNextlyConfig();
    expect(await mainHasCode()).toBe(true);
    await handle.adapter.executeQuery(
      `ALTER TABLE "${COMPANION}" ADD COLUMN "code" INTEGER`
    );
    const said = [
      vi.spyOn(console, "warn").mockImplementation(() => {}),
      vi.spyOn(console, "error").mockImplementation(() => {}),
    ];

    loaded.config = configWith("translated");
    await reloadNextlyConfig();

    expect(said.flatMap(spy => spy.mock.calls.flat()).join(" ")).toMatch(
      /column \\?"code\\?" \((?:INTEGER|integer)\) that cannot hold every value code allows/
    );
    expect(await codeColumnType()).toBe("INTEGER");
    expect(await mainHasCode()).toBe(true);
  });
});
