/**
 * `nextly migrate` and a translations-table file carrying a fill or delete, on per-language storage
 * as every installation runs it: the cases shared with the earlier layout's suite
 * (`settle-answer-cases`).
 */
// Set before the harness boots (env validation reads it once).
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { vi } from "vitest";

import { perLanguageStorageSuite } from "../../../__tests__/storage-layout";

import { settleAnswerCases } from "./helpers/settle-answer-cases";

perLanguageStorageSuite();

/** The configuration the commands load, set by each step before it runs them. */
const loaded = vi.hoisted(() => ({ config: undefined as unknown }));
vi.mock("../../utils/config-loader", async importOriginal => ({
  ...(await importOriginal<typeof import("../../utils/config-loader")>()),
  loadConfig: async () => ({
    config: loaded.config,
    appConfig: loaded.config,
    pluginConsent: undefined,
    dependencies: [],
  }),
}));

settleAnswerCases({ layout: "per-language", loaded });
