import { describe, expect, it } from "vitest";

import { NextlyError } from "../../../errors";
import {
  applyPluginSchemaContributions,
  applyPluginSchemaContributionsDeferred,
} from "../../../plugins/schema/apply-contributions";
import { buildServiceConfig } from "../../../init/build-service-config";
import { defineConfig } from "../define-config";

const field = { type: "text" as const, name: "title" };

const group = (slug: string) => ({
  slug,
  label: { singular: slug },
  fields: [field],
});

// The config loader supports `.js` and `.mjs` as well as `.ts`, so excess-property
// checking does not protect every supported config format. Under the old key a
// JavaScript config would read as having no field groups at all, and every
// definition would go unregistered without a word.
describe("legacy top-level config key", () => {
  it("fails instead of silently ignoring the old key", () => {
    expect(() =>
      defineConfig({ collections: [], components: [group("seo")] } as never)
    ).toThrow(NextlyError);
  });

  it("names both spellings so the required edit is obvious", () => {
    try {
      defineConfig({ collections: [], components: [group("seo")] } as never);
      expect.unreachable("expected a renamed-key failure");
    } catch (error) {
      const detail = JSON.stringify(error);
      expect(detail).toContain("CONFIG_KEY_RENAMED");
      expect(detail).toContain("fieldGroups");
    }
  });

  it("rejects the old key even when it is empty", () => {
    // An empty array is still a config written against the old vocabulary; a
    // silent pass here would let the mistake survive until a group is added.
    expect(() =>
      defineConfig({ collections: [], components: [] } as never)
    ).toThrow(NextlyError);
  });

  it("accepts the current key", () => {
    expect(() =>
      defineConfig({ collections: [], fieldGroups: [group("seo")] } as never)
    ).not.toThrow();
  });

  it("accepts a config that declares no field groups at all", () => {
    expect(() => defineConfig({ collections: [] } as never)).not.toThrow();
  });
});

// A plugin's setup() transformer returns a NEW config object, so a boundary that
// only checks its input leaves that path unguarded. The check therefore lives on
// the FOLD — the one function every runtime and CLI path calls — rather than on
// any single caller, which is how the previous placement came to sit in a helper
// only tests invoked.
describe("legacy key at the plugin fold", () => {
  const svc = (partial: Record<string, unknown>) =>
    ({ imageProcessor: {}, ...partial }) as never;

  it("rejects a folded config carrying the old key", () => {
    expect(() =>
      applyPluginSchemaContributions(
        svc({ collections: [], singles: [], components: [group("seo")] }),
        []
      )
    ).toThrow(NextlyError);
  });

  it("rejects it on the deferring fold used by the CLI loader", () => {
    expect(() =>
      applyPluginSchemaContributionsDeferred(
        svc({ collections: [], singles: [], components: [group("seo")] }),
        []
      )
    ).toThrow(NextlyError);
  });

  it("accepts a folded config using the current key", () => {
    expect(() =>
      applyPluginSchemaContributionsDeferred(
        svc({ collections: [], singles: [], fieldGroups: [group("seo")] }),
        []
      )
    ).not.toThrow();
  });
});

// `buildServiceConfig()` destructures the nested config away before boot, so a
// legacy key on it would never reach the boot-time guard.
describe("legacy key on the nested config", () => {
  it("rejects a nextly config carrying the old key", () => {
    expect(() =>
      buildServiceConfig({ config: { components: [group("seo")] } } as never)
    ).toThrow(NextlyError);
  });

  it("accepts a nextly config using the current key", () => {
    expect(() =>
      buildServiceConfig({ config: { fieldGroups: [group("seo")] } } as never)
    ).not.toThrow();
  });
});
