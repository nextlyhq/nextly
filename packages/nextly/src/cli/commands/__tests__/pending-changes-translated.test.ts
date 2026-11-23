/**
 * A translated collection's changes not yet in a migration, on the earlier storage layout, which most suites run on
 * (`translatedPendingCases`).
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, vi } from "vitest";

import { _resetEnvCache } from "../../../shared/lib/env";

import { translatedPendingCases } from "./helpers/translated-pending-cases";

const loaded = vi.hoisted(() => ({ config: undefined as unknown }));

// `../program` imports every command; the commands under test are handed their context.
vi.mock("../../program", () => ({
  createContext: () => ({ logger: {} }),
}));

vi.mock("../../utils/config-loader", async importOriginal => ({
  ...(await importOriginal<typeof import("../../utils/config-loader")>()),
  loadConfig: async () => ({ config: loaded.config, dependencies: [] }),
}));

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nextly-pending-translated-"));
  vi.stubEnv("CI", "");
  // Neither command connects; each needs only the dialect.
  vi.stubEnv("DB_DIALECT", "sqlite");
  vi.stubEnv("DATABASE_URL", "");
  _resetEnvCache();
});

afterEach(() => {
  vi.unstubAllEnvs();
  _resetEnvCache();
  rmSync(dir, { recursive: true, force: true });
});

describe("a translated collection's pending changes", () => {
  translatedPendingCases(loaded, () => dir);
});
