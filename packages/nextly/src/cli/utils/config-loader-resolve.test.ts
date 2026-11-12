import { describe, expect, it } from "vitest";

import type { SanitizedNextlyConfig } from "../../collections/config/define-config";
import type { CollectionConfig } from "../../collections/config/define-collection";
import type { FieldGroupConfig } from "../../field-groups/config/types";
import {
  isSubscribableEventType,
  publishWebhookEventTypes,
} from "../../domains/webhooks/event-type-registry";
import { componentImportMapPaths } from "../../plugins/codegen/component-import-map";
import { NO_PLUGIN_CONSENT } from "../../plugins/plugin-consent";
import type { PluginDefinition } from "../../plugins/plugin-context";
import type { SingleConfig } from "../../singles/config/types";

import {
  mergeSetupResultIntoConfig,
  orderConfigPlugins,
} from "./config-loader";

const plugin = (
  name: string,
  extra: Partial<PluginDefinition> = {}
): PluginDefinition => ({
  name,
  version: "1.0.0",
  nextly: ">=0.0.0",
  ...extra,
});

describe("orderConfigPlugins (CLI resolution — D5/D6/D7)", () => {
  it("publishes the webhook event types a plugin declares, and none once no plugin is left", () => {
    const shop = plugin("@acme/shop", {
      contributes: { webhookEvents: [{ type: "acme-shop.order.paid" }] },
    });

    orderConfigPlugins([shop], NO_PLUGIN_CONSENT);
    expect(isSubscribableEventType("acme-shop.order.paid")).toBe(true);

    // A reload down to no plugins resolves nothing; the last plugin's types
    // must still stop being offered.
    orderConfigPlugins([], NO_PLUGIN_CONSENT);
    expect(isSubscribableEventType("acme-shop.order.paid")).toBe(false);
    publishWebhookEventTypes([]);
  });

  it("returns plugins in dependency (topo) order, not array order", () => {
    const a = plugin("@t/a");
    const b = plugin("@t/b", { dependsOn: { "@t/a": ">=1.0.0" } });

    const ordered = orderConfigPlugins([b, a], NO_PLUGIN_CONSENT).plugins; // declared b-first
    expect(ordered.map(p => p.name)).toEqual(["@t/a", "@t/b"]);
  });

  it("fails fast on an incompatible core version", () => {
    const bad = plugin("@t/bad", { nextly: "^99.0.0" });
    try {
      orderConfigPlugins([bad], NO_PLUGIN_CONSENT);
      throw new Error("expected orderConfigPlugins to throw");
    } catch (err) {
      expect(
        (err as { logContext?: { reason?: string } }).logContext?.reason
      ).toBe("core-incompatible");
    }
  });

  it("fails fast on a missing required dependency", () => {
    const needsMissing = plugin("@t/needs", {
      dependsOn: { "@t/absent": ">=1.0.0" },
    });
    try {
      orderConfigPlugins([needsMissing], NO_PLUGIN_CONSENT);
      throw new Error("expected orderConfigPlugins to throw");
    } catch (err) {
      expect(
        (err as { logContext?: { reason?: string } }).logContext?.reason
      ).toBe("missing-dependency");
    }
  });

  it("returns an empty array unchanged", () => {
    expect(orderConfigPlugins([], NO_PLUGIN_CONSENT).plugins).toEqual([]);
  });
});

describe("mergeSetupResultIntoConfig (CLI fold — D3/D12/D50)", () => {
  const coll = (slug: string) =>
    ({ slug, fields: [] }) as unknown as CollectionConfig;
  const single = (slug: string) =>
    ({ slug, fields: [] }) as unknown as SingleConfig;
  const comp = (slug: string) =>
    ({ slug, fields: [] }) as unknown as FieldGroupConfig;
  const base = (): SanitizedNextlyConfig =>
    ({
      collections: [],
      singles: [],
      fieldGroups: [],
    }) as unknown as SanitizedNextlyConfig;

  it("folds plugin contributes.{collections,singles,fieldGroups} into the config (field groups threaded)", () => {
    const plugins = [
      plugin("@t/p", {
        contributes: {
          collections: [coll("p-coll")],
          singles: [single("p-single")],
          fieldGroups: [comp("p-comp")],
        },
      }),
    ];
    const transformed = { ...base(), plugins } as SanitizedNextlyConfig;

    const result = mergeSetupResultIntoConfig(base(), transformed, plugins);

    expect((result.collections ?? []).map(c => c.slug)).toContain("p-coll");
    expect((result.singles ?? []).map(s => s.slug)).toContain("p-single");
    // field groups were dropped by the old whitelist merge-back — must survive now.
    expect((result.fieldGroups ?? []).map(c => c.slug)).toContain("p-comp");
  });

  it("carries a plugin setup()'s transformed webhookRetention (and audit) over the base value", () => {
    // A plugin that disables retention in setup() must win: the merge previously
    // carried webhookAuditEnabled but dropped webhookRetention back to base.
    const baseCfg = {
      ...base(),
      webhookRetention: { eventsMaxAgeMs: 111 },
      webhookAuditEnabled: false,
    } as unknown as SanitizedNextlyConfig;
    const transformed = {
      ...base(),
      plugins: [],
      webhookRetention: null,
      webhookAuditEnabled: true,
    } as unknown as SanitizedNextlyConfig;

    const result = mergeSetupResultIntoConfig(baseCfg, transformed, []);

    expect(result.webhookRetention).toBeNull();
    expect(result.webhookAuditEnabled).toBe(true);
  });

  // The boot collects the app's permissions from the transformed config, so a setup() that adds
  // or replaces them must reach every command that reads the loaded config, `migrate:create` and
  // the loader's own permission check among them; one that removes them all leaves none.
  it.each([
    [
      "replaced",
      [{ action: "export", resource: "reports" }],
      [{ action: "archive", resource: "reports" }],
    ],
    ["removed", [{ action: "export", resource: "reports" }], undefined],
  ])(
    "carries the app permissions a plugin setup() %s",
    (_how, before, after) => {
      const baseCfg = {
        ...base(),
        permissions: before,
      } as unknown as SanitizedNextlyConfig;
      const transformed = {
        ...base(),
        plugins: [],
        permissions: after,
      } as unknown as SanitizedNextlyConfig;

      const result = mergeSetupResultIntoConfig(baseCfg, transformed, []);

      expect(result.permissions).toEqual(after);
    }
  );

  it("carries the site dashboard a plugin setup() adds, so the component map lists its widget", () => {
    // The boot registers the dashboard of the transformed config; `generate:types` and its
    // `--check` list components from this merge, so a widget a setup() adds must reach it.
    const notes = {
      id: "site/notes",
      title: "Notes",
      description: "The team's notes.",
      size: { default: { w: 6, h: 3 } },
      load: async () => ({ notes: [] }),
      view: { component: "./dashboard/notes#NotesCard" },
      isEmpty: () => true,
    };
    const transformed = {
      ...base(),
      plugins: [],
      admin: { dashboard: { widgets: [notes] } },
    } as unknown as SanitizedNextlyConfig;

    const result = mergeSetupResultIntoConfig(base(), transformed, []);

    expect(
      componentImportMapPaths(result.plugins ?? [], result.admin?.dashboard)
    ).toEqual(["./dashboard/notes#NotesCard"]);
  });
});
