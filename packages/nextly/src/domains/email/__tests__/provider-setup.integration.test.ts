/**
 * Setting a provider up, on every configured dialect: settings checked before
 * they are saved, a test of a provider that is off explained by what to check,
 * and a provider made the default only once it is on, without changing a
 * default an install already has or what an API create asks for.
 */
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { afterEach, describe, expect, it } from "vitest";

import { definePlugin } from "../../../plugins/plugin-context";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { httpFailure, withEmailFailure } from "../failure";
import { defineEmailProvider } from "../provider-definition";
import type { EmailProviderService } from "../services/email-provider-service";
import { withSetupCategory } from "../setup-category";

const sent: Array<{ to: string; provider: string }> = [];
let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
  sent.length = 0;
});

/** The one key both fakes accept. */
const RIGHT_KEY = "right-key";

const keyField = {
  name: "apiKey",
  label: "API Key",
  kind: "password" as const,
  required: true,
  secret: true,
};
const parseKey = (input: unknown) => ({
  apiKey: String((input as { apiKey?: unknown }).apiKey ?? ""),
});

/** An optional setting the accepting fake cannot connect with. */
const CLOSED_REGION = "closed";
const regionField = {
  name: "region",
  label: "Region",
  kind: "text" as const,
  required: false,
};
const parseKeyAndRegion = (input: unknown) => {
  const region = (input as { region?: unknown }).region;
  return {
    ...parseKey(input),
    ...(typeof region === "string" ? { region } : {}),
  };
};

/**
 * Providers that check a key without sending: one sends with the right key
 * (and cannot connect in the closed region), one refuses every send as a
 * provider refusing the sign-in, and one whose transport package is missing.
 */
const fakes = definePlugin({
  name: "setup-fakes",
  version: "1.0.0",
  nextly: ">=0.0.0",
  contributes: {
    emailProviders: [
      defineEmailProvider<{ apiKey: string; region?: string }>({
        type: "fake-accepting",
        label: "Accepting",
        capabilities: { connectionTest: true },
        configFields: [keyField, regionField],
        parseConfig: parseKeyAndRegion,
        testConnection: async config =>
          config.region === CLOSED_REGION
            ? { ok: false, detail: "closed", setup: "connect" }
            : config.apiKey === RIGHT_KEY
              ? { ok: true }
              : { ok: false, detail: "bad key", setup: "credentials" },
        createAdapter: () => ({
          send: async (opts: { to: string }) => {
            sent.push({ to: opts.to, provider: "fake-accepting" });
            return { success: true, messageId: `m-${sent.length}` };
          },
        }),
      }),
      defineEmailProvider<{ apiKey: string }>({
        type: "fake-refusing",
        label: "Refusing",
        capabilities: { connectionTest: true },
        configFields: [keyField],
        parseConfig: parseKey,
        testConnection: async () => ({
          ok: false,
          detail: "no",
          setup: "credentials",
        }),
        createAdapter: () => ({
          send: async () => {
            throw withSetupCategory(
              withEmailFailure(new Error("HTTP 401"), httpFailure(401)),
              "credentials"
            );
          },
        }),
      }),
      defineEmailProvider<{ apiKey: string }>({
        type: "fake-uninstalled",
        label: "Uninstalled",
        capabilities: { connectionTest: true },
        configFields: [keyField],
        parseConfig: parseKey,
        checkAvailability: () => ({
          status: "needs-dependency",
          packageName: "fake-transport",
          installCommand: "npm install fake-transport",
        }),
        testConnection: async () => ({ ok: false, detail: "no transport" }),
        createAdapter: () => ({
          send: async () => ({ success: false }),
        }),
      }),
    ],
  },
} as never);

const providers = (t: TestNextly) =>
  t.getService("emailProviderService") as unknown as EmailProviderService;

async function add(
  t: TestNextly,
  type: string,
  over: { isActive?: boolean; isDefault?: boolean } = {}
) {
  return providers(t).createProvider({
    name: `${type} provider`,
    type,
    fromEmail: "from@example.com",
    fromName: null,
    configuration: { apiKey: RIGHT_KEY },
    isActive: over.isActive ?? false,
    isDefault: over.isDefault ?? false,
  });
}

for (const dialect of getConfiguredTestDialects()) {
  describe(`provider setup — ${dialect}`, () => {
    it("checks settings before they are saved, and says what to check when refused", async () => {
      const t = (current = await createTestNextly({
        dialect,
        plugins: [fakes],
      }));
      const service = providers(t);

      expect(
        await service.checkConfiguration({
          type: "fake-accepting",
          configuration: { apiKey: RIGHT_KEY },
        })
      ).toEqual({ checked: true, success: true });

      const refused = await service.checkConfiguration({
        type: "fake-accepting",
        configuration: { apiKey: "wrong" },
      });
      expect(refused).toMatchObject({
        checked: true,
        success: false,
        setup: "credentials",
      });
      // The provider's own words stay in the log.
      expect(JSON.stringify(refused)).not.toContain("bad key");

      // Nothing was saved by either check.
      expect(await service.listProviders()).toEqual([]);
    }, 120_000);

    it("checks a saved provider's changed settings with its stored secret", async () => {
      const t = (current = await createTestNextly({
        dialect,
        plugins: [fakes],
      }));
      const service = providers(t);
      const saved = await add(t, "fake-accepting");

      // The form sends the masked secret back for a key nobody changed.
      expect(
        await service.checkConfiguration({
          type: "fake-accepting",
          configuration: { apiKey: "••••••••" },
          providerId: saved.id,
        })
      ).toEqual({ checked: true, success: true });
    }, 120_000);

    it("checks what saving would store, with the fields an edit clears cleared", async () => {
      const t = (current = await createTestNextly({
        dialect,
        plugins: [fakes],
      }));
      const service = providers(t);
      const saved = await service.createProvider({
        name: "regional",
        type: "fake-accepting",
        fromEmail: "from@example.com",
        fromName: null,
        configuration: { apiKey: RIGHT_KEY, region: CLOSED_REGION },
        isActive: false,
        isDefault: false,
      });

      // Kept, the stored region is checked, and refused.
      expect(
        await service.checkConfiguration({
          type: "fake-accepting",
          configuration: { apiKey: "••••••••" },
          providerId: saved.id,
        })
      ).toMatchObject({ checked: true, success: false, setup: "connect" });

      // Cleared by the edit, it is not.
      expect(
        await service.checkConfiguration({
          type: "fake-accepting",
          configuration: { apiKey: "••••••••" },
          unsetConfiguration: ["region"],
          providerId: saved.id,
        })
      ).toEqual({ checked: true, success: true });
    }, 120_000);

    it("leaves a provider whose transport isn't installed unchecked, so it can be saved", async () => {
      const t = (current = await createTestNextly({
        dialect,
        plugins: [fakes],
      }));
      expect(
        await providers(t).checkConfiguration({
          type: "fake-uninstalled",
          configuration: { apiKey: RIGHT_KEY },
        })
      ).toEqual({ checked: false, success: true });
    }, 120_000);

    it("says a provider with no check can't be checked, rather than passing it", async () => {
      const t = (current = await createTestNextly({
        dialect,
        plugins: [fakes],
      }));
      expect(
        await providers(t).checkConfiguration({
          type: "log",
          configuration: {},
        })
      ).toEqual({ checked: false, success: true });
    }, 120_000);

    it("tests a provider that is off, and explains a refusal by what to check", async () => {
      const t = (current = await createTestNextly({
        dialect,
        plugins: [fakes],
      }));
      const service = providers(t);

      const accepting = await add(t, "fake-accepting");
      expect(
        await service.testProvider(accepting.id, "me@example.com")
      ).toEqual({ success: true });
      expect(sent).toEqual([
        { to: "me@example.com", provider: "fake-accepting" },
      ]);

      const refusing = await add(t, "fake-refusing");
      expect(
        await service.testProvider(refusing.id, "me@example.com")
      ).toMatchObject({
        success: false,
        setup: "credentials",
        retryable: false,
      });
    }, 120_000);

    it("makes a provider the default only once it is on", async () => {
      const t = (current = await createTestNextly({
        dialect,
        plugins: [fakes],
      }));
      const service = providers(t);
      const off = await add(t, "fake-accepting");

      await expect(service.setDefault(off.id)).rejects.toMatchObject({
        code: "BUSINESS_RULE_VIOLATION",
      });
      await expect(
        service.updateProvider(off.id, { isDefault: true })
      ).rejects.toMatchObject({ code: "BUSINESS_RULE_VIOLATION" });
      await expect(
        service.createProvider({
          name: "new default",
          type: "fake-accepting",
          fromEmail: "from@example.com",
          fromName: null,
          configuration: { apiKey: RIGHT_KEY },
          isActive: false,
          isDefault: true,
        })
      ).rejects.toMatchObject({ code: "BUSINESS_RULE_VIOLATION" });

      // Turned on, it can be.
      await service.updateProvider(off.id, { isActive: true });
      await expect(service.setDefault(off.id)).resolves.toMatchObject({
        isDefault: true,
      });
    }, 120_000);

    it("creates through the API what the API asks for, as before", async () => {
      const t = (current = await createTestNextly({
        dialect,
        plugins: [fakes],
      }));
      const data = {
        type: "fake-accepting",
        fromEmail: "from@example.com",
        configuration: { apiKey: RIGHT_KEY },
      };

      // Saved off until tested is the admin's guided setup, not the API's:
      // a create that asks for an active default gets one.
      const { item: activeDefault } = await t.nextly.emailProviders.create({
        data: {
          ...data,
          name: "active default",
          isActive: true,
          isDefault: true,
        },
      });
      expect(activeDefault).toMatchObject({ isActive: true, isDefault: true });

      // And one that names neither is on, as it always was.
      const { item: plain } = await t.nextly.emailProviders.create({
        data: { ...data, name: "plain" },
      });
      expect(plain).toMatchObject({ isActive: true, isDefault: false });

      // A default asked for alone is on, and the default.
      const { item: defaultOnly } = await t.nextly.emailProviders.create({
        data: { ...data, name: "default only", isDefault: true },
      });
      expect(defaultOnly).toMatchObject({ isActive: true, isDefault: true });
    }, 120_000);

    it("leaves an install's existing default as it is, and it still sends", async () => {
      const t = (current = await createTestNextly({
        dialect,
        plugins: [fakes],
      }));
      const service = providers(t);
      // As every install made its default before the rule: on, and default.
      const existing = await add(t, "fake-accepting", {
        isActive: true,
        isDefault: true,
      });

      // An edit that sends the default flag back, as the admin's form does,
      // saves as it always did.
      await expect(
        service.updateProvider(existing.id, {
          name: "Renamed",
          isDefault: true,
        })
      ).resolves.toMatchObject({ name: "Renamed", isDefault: true });

      // And email goes out through it.
      await t.nextly.email.send({
        to: "reader@example.com",
        subject: "Hello",
        html: "<p>Hello</p>",
      });
      expect(sent).toEqual([
        { to: "reader@example.com", provider: "fake-accepting" },
      ]);
    }, 120_000);
  });
}
