/**
 * A plugin's secret settings, at rest, on every dialect.
 *
 * The encryption itself is unit-tested over an in-memory store. What only a
 * real database shows is what the row holds once each dialect's column has
 * carried it, and what an existing install holds after an upgrade changes
 * which paths the manifest calls secret: the boot that follows is the only
 * moment every install passes through, whether or not anything then reads
 * or writes its settings.
 *
 * An upgrade is a second registration over the SAME database, with the
 * plugin's newer manifest: the harness's boot, then `clearServices()` and
 * `registerServices()` with the adapter it opened.
 */
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";

import { clearServices, registerServices } from "../../di/register";
import { dispatchPluginSettings } from "../../dispatcher/handlers/plugin-settings-dispatcher";
import {
  type PluginSettingRow,
  PluginSettingsService,
  pluginSettingsSecrets,
} from "../../domains/plugins/settings-service";
import { createPluginSettingsStore } from "../../domains/plugins/settings-store";
import type { ServiceContainer } from "../../services";
import { _resetEnvCache } from "../../shared/lib/env";
import { getImageProcessor } from "../../storage/image-processor";
import { definePlugin, type PluginDefinition } from "../plugin-context";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../test-nextly";

const NAME = "@test/secret-settings";
const SECRET = "secret-value-3c9e1a7f52";
const CLIENT_ID = "client-id-value-8b4d2e61";

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

const settingsSchema = z.object({
  apiKey: z.string().default(""),
  port: z.number().default(443),
  providers: z
    .record(
      z.string(),
      z.object({ clientId: z.string(), clientSecret: z.string() })
    )
    .default({}),
});

type Settings = z.infer<typeof settingsSchema>;

interface CapturedSettings {
  get: () => Promise<Settings>;
  set: (patch: Partial<Settings>) => Promise<void>;
}

/**
 * The plugin, declaring `secrets` as the manifest of one version would.
 * `atInit` runs inside `init`, before the plugin has read or written a
 * setting, which is the moment the manifest's promise is about.
 */
function secretSettingsPlugin(
  secrets: string[],
  onInit: (settings: CapturedSettings) => Promise<void> | void = () => {}
): PluginDefinition {
  return definePlugin({
    name: NAME,
    version: "1.0.0",
    nextly: ">=0.0.0",
    capabilities: { secrets },
    contributes: { settings: settingsSchema },
    async init(ctx) {
      await onInit(ctx.settings as never);
    },
  });
}

/** Boot `plugin` on `dialect`, and hand back its `ctx.settings`. */
async function boot(
  dialect: TestDialect,
  plugin: PluginDefinition
): Promise<CapturedSettings> {
  let captured: CapturedSettings | undefined;
  const capturing = {
    ...plugin,
    init: async (ctx: Parameters<NonNullable<PluginDefinition["init"]>>[0]) => {
      captured = ctx.settings as never;
      await plugin.init?.(ctx);
    },
  };
  current = await createTestNextly(
    dialect === "sqlite"
      ? { plugins: [capturing] }
      : { dialect, plugins: [capturing] }
  );
  expect(captured).toBeDefined();
  return captured!;
}

/** Register services again on the same database, with a newer manifest. */
async function upgrade(plugin: PluginDefinition): Promise<void> {
  clearServices();
  await registerServices({
    adapter: current!.adapter,
    imageProcessor: getImageProcessor(),
    plugins: [plugin],
  });
}

/** The plugin's rows as the table holds them, with no decoding. */
function storedRows(): Promise<PluginSettingRow[]> {
  const adapter = current!.adapter;
  return createPluginSettingsStore(adapter.getDrizzle(), adapter.dialect).read(
    NAME
  );
}

/** Every stored value of the plugin, joined, to search for plain text. */
async function storedText(): Promise<string> {
  return (await storedRows()).map(row => row.value).join("\n");
}

describe.each(getConfiguredTestDialects())(
  "a plugin's secret settings on %s",
  dialect => {
    it("stores secrets encrypted, top-level and nested, and reads them back", async () => {
      const settings = await boot(
        dialect,
        secretSettingsPlugin(["apiKey", "providers.*.clientSecret"])
      );

      await settings.set({
        apiKey: SECRET,
        providers: { google: { clientId: CLIENT_ID, clientSecret: SECRET } },
      });

      const text = await storedText();
      expect(text).not.toContain(SECRET);
      // The control: the rows are there, and what is not secret is stored
      // as written, so the absence above is the encryption's doing.
      expect(text).toContain(CLIENT_ID);
      expect(await settings.get()).toMatchObject({
        apiKey: SECRET,
        providers: { google: { clientId: CLIENT_ID, clientSecret: SECRET } },
      });
    });

    it("encrypts a value whose path became secret before the plugin starts", async () => {
      const settings = await boot(dialect, secretSettingsPlugin([]));
      await settings.set({
        apiKey: SECRET,
        providers: { google: { clientId: CLIENT_ID, clientSecret: SECRET } },
      });
      // The premise: the first version stored them as plain text.
      expect(await storedText()).toContain(SECRET);

      let atInit = "";
      let readAtInit: Settings | undefined;
      await upgrade(
        secretSettingsPlugin(
          ["apiKey", "providers.*.clientSecret"],
          async newer => {
            atInit = await storedText();
            readAtInit = await newer.get();
          }
        )
      );

      expect(atInit).not.toContain(SECRET);
      expect(readAtInit).toMatchObject({
        apiKey: SECRET,
        providers: { google: { clientSecret: SECRET } },
      });
    });

    it("encrypts a path newly secret inside a row already encrypted, before the plugin starts", async () => {
      const settings = await boot(
        dialect,
        secretSettingsPlugin(["providers.*.clientSecret"])
      );
      await settings.set({
        providers: { google: { clientId: CLIENT_ID, clientSecret: SECRET } },
      });
      // The premise: the row is stored as secret, and `clientId` is plain
      // text inside it.
      expect(await storedText()).toContain(CLIENT_ID);

      let atInit = "";
      await upgrade(
        secretSettingsPlugin(
          ["providers.*.clientSecret", "providers.*.clientId"],
          async () => {
            atInit = await storedText();
          }
        )
      );

      expect(atInit).not.toContain(CLIENT_ID);
      expect(atInit).not.toContain(SECRET);
    });

    it("keeps a value no longer secret encrypted and unreturned until it is written again", async () => {
      const settings = await boot(dialect, secretSettingsPlugin(["apiKey"]));
      await settings.set({ apiKey: SECRET });

      const newer = secretSettingsPlugin([]);
      let captured: CapturedSettings | undefined;
      await upgrade({
        ...newer,
        init: ctx => {
          captured = ctx.settings as never;
        },
      });
      // Neither the boot nor a write of another key opens it up again.
      await captured!.set({ port: 8443 });

      expect(await storedText()).not.toContain(SECRET);
      const view = (await dispatchPluginSettings(
        { adapter: current!.adapter } as unknown as ServiceContainer,
        { plugins: [newer] } as never,
        "getPluginSettings",
        { plugin: NAME },
        undefined
      )) as Response;
      const body = (await view.json()) as { settings: { apiKey: unknown } };
      expect(body.settings.apiKey).toMatchObject({ set: true });

      // Written again, it is stored as the newer manifest says: in plain text.
      await captured!.set({ apiKey: "now-public-value" });
      expect(await storedText()).toContain("now-public-value");
    });

    it("refuses to boot a plugin whose settings permission is not one it owns", async () => {
      // The check runs where the boot knows every entity, before any route can
      // be gated on the permission; a misspelt name stops the boot there.
      const plugin = definePlugin({
        name: NAME,
        version: "1.0.0",
        nextly: ">=0.0.0",
        contributes: {
          settings: settingsSchema,
          permissions: [{ action: "update", resource: "secret-settings" }],
          settingsPermission: "update-unowned-settings",
        },
      });
      await expect(
        createTestNextly(
          dialect === "sqlite"
            ? { plugins: [plugin] }
            : { dialect, plugins: [plugin] }
        )
      ).rejects.toMatchObject({
        logContext: expect.objectContaining({
          reason: "settings-permission-undeclared",
        }),
      });
    });

    /** The secret a rotation moves the install to. */
    const ROTATED = "nextly-test-rotated-secret-at-least-32-chars";

    /**
     * Upgrade to `plugin` across a rotation: the secret in force becomes the
     * previous one and `ROTATED` the current, for the length of the boot.
     */
    async function upgradeAcrossRotation(
      plugin: PluginDefinition
    ): Promise<void> {
      const original = process.env.NEXTLY_SECRET;
      process.env.NEXTLY_SECRET_PREVIOUS = original;
      process.env.NEXTLY_SECRET = ROTATED;
      _resetEnvCache();
      try {
        await upgrade(plugin);
      } finally {
        process.env.NEXTLY_SECRET = original;
        delete process.env.NEXTLY_SECRET_PREVIOUS;
        _resetEnvCache();
      }
    }

    /**
     * The stored `apiKey` as an install holding only the rotated secret sees
     * it: `{ set: true }` when it opens, `{ set: true, readable: false }` when
     * it is still sealed under the secret the rotation retires.
     */
    async function apiKeyUnderRotatedSecretAlone(): Promise<unknown> {
      const adapter = current!.adapter;
      const view = await new PluginSettingsService({
        owner: NAME,
        schema: settingsSchema,
        secretPaths: [],
        store: createPluginSettingsStore(adapter.getDrizzle(), adapter.dialect),
        secrets: () => pluginSettingsSecrets({ NEXTLY_SECRET: ROTATED }),
      }).view();
      return (view.settings as { apiKey?: unknown }).apiKey;
    }

    it("seals again under a rotated secret a value its manifest no longer calls secret, before the plugin starts", async () => {
      const settings = await boot(dialect, secretSettingsPlugin(["apiKey"]));
      await settings.set({ apiKey: SECRET });

      // The install rotates its secret in the release that also drops the
      // plugin's last secret declaration. The value stays encrypted under the
      // previous secret until something seals it again, and once that secret
      // is retired nothing can. Observed from inside `init`, which is the
      // moment the promise is about: a seal that ran after the plugin started
      // would pass a check made once the boot had finished.
      let atInit: unknown;
      const newer = secretSettingsPlugin([]);
      await upgradeAcrossRotation({
        ...newer,
        init: async () => {
          atInit = await apiKeyUnderRotatedSecretAlone();
        },
      });

      expect(await storedText()).not.toContain(SECRET);
      // Exact: a value that cannot be opened is `{ set: true, readable: false }`.
      expect(atInit).toEqual({ set: true });
    });

    it("seals again under a rotated secret the values of a plugin that no longer declares settings", async () => {
      // A version that drops its settings schema in the release that rotates
      // the secret leaves its rows under the secret being retired; a later
      // version reading them again would find them unreadable.
      const settings = await boot(dialect, secretSettingsPlugin(["apiKey"]));
      await settings.set({ apiKey: SECRET });

      await upgradeAcrossRotation(
        definePlugin({ name: NAME, version: "2.0.0", nextly: ">=0.0.0" })
      );

      expect(await apiKeyUnderRotatedSecretAlone()).toEqual({ set: true });
    });

    it("seals again under a rotated secret the values of a plugin disabled at that boot", async () => {
      // A disabled plugin runs no code, but its stored values are still sealed
      // under the secret the rotation retires; left there, they could not be
      // read when the plugin was enabled again after that secret was removed.
      const settings = await boot(dialect, secretSettingsPlugin(["apiKey"]));
      await settings.set({ apiKey: SECRET });

      await upgradeAcrossRotation({
        ...secretSettingsPlugin(["apiKey"]),
        enabled: false,
      });

      expect(await apiKeyUnderRotatedSecretAlone()).toEqual({ set: true });
    });
  }
);
