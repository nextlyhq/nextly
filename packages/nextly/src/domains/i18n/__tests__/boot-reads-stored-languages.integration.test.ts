/**
 * Boot reads the stored language list before any plugin starts: a plugin's `init` that writes
 * through the services must already see a site with languages as localized, or its translated
 * values would go to the main table. The order is the same on every dialect, so SQLite shows it.
 */
import { afterEach, expect, it } from "vitest";

import { clearServices } from "../../../di/register";
import type { PluginDefinition } from "../../../plugins/plugin-context";
import {
  createTestNextly,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { appLocalization } from "../configured-locales";
import type { LanguageRegistry } from "../language-registry";
import { LanguageSettingsService } from "../services/language-settings-service";

let handle: TestNextly | undefined;

afterEach(async () => {
  await handle?.destroy();
  handle = undefined;
});

it("has read the stored languages by the time a plugin's init runs", async () => {
  // A first boot stores the languages, as Settings would; the second boots over the same database.
  const first = await createTestNextly({});
  const adapter = first.adapter;
  await new LanguageSettingsService(
    adapter,
    first.getService("languageRegistry") as LanguageRegistry
  ).change({ kind: "add", code: "fr", label: "French" });
  clearServices();

  let seenAtInit: string[] | undefined;
  const plugin: PluginDefinition = {
    name: "@t/reads-languages-at-init",
    version: "1.0.0",
    nextly: ">=0.0.0",
    init() {
      seenAtInit = appLocalization()?.locales.map(locale => locale.code);
    },
  };
  handle = await createTestNextly({ adapter, plugins: [plugin] });

  expect(seenAtInit).toEqual(["en", "fr"]);
});
