// What: loads nextly.config.ts from the wrapper's plain-Node context using jiti.
// Why: Turbopack can't reliably resolve drizzle-kit/api or custom tsconfig path
// aliases, which breaks in-bundler config loading. jiti is a standalone
// TypeScript loader that handles ESM, CJS, path aliases, and dynamic imports
// consistently. The wrapper owns schema-change detection so it needs an
// authoritative copy of the parsed config independent of Next's bundler.

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { createJiti } from "jiti";

import type { NextlyConfig } from "../../shared/types/config.js";

// Resolution order matches meta-framework convention (Astro, Nuxt, Sanity).
// Root wins; src/ fallback supports users with src-directory project layouts.
const CONFIG_CANDIDATES = [
  "nextly.config.ts",
  "nextly.config.js",
  "nextly.config.mjs",
  "src/nextly.config.ts",
  "src/nextly.config.js",
];

export interface ConfigLoadResult {
  config: NextlyConfig;
  configPath: string;
  contentHash: string;
}

// Locates the first existing config file according to CONFIG_CANDIDATES order.
// Throws a descriptive error listing every candidate path that was checked so
// users know where to put their config if they're new to Nextly.
export async function resolveConfigPath(projectRoot: string): Promise<string> {
  for (const candidate of CONFIG_CANDIDATES) {
    const full = join(projectRoot, candidate);
    if (existsSync(full)) return resolve(full);
  }
  throw new Error(
    `No nextly config found in ${projectRoot}. ` +
      `Looked for: ${CONFIG_CANDIDATES.join(", ")}.`
  );
}

// Loads the config file, runs it through jiti to get the parsed TypeScript
// value, and also returns a SHA-256 hash of the raw file content so the
// caller can dedupe format-on-save events that produce identical bytes.
export async function loadNextlyConfig(
  projectRoot: string
): Promise<ConfigLoadResult> {
  const configPath = await resolveConfigPath(projectRoot);

  // fsCache and moduleCache are disabled so each load re-reads the file and
  // re-parses it. Without this, jiti would serve a stale module from its
  // in-process cache when the user edits the config between loads.
  const jiti = createJiti(projectRoot, {
    fsCache: false,
    moduleCache: false,
  });

  const imported = (await jiti.import(configPath)) as
    | { default: NextlyConfig }
    | NextlyConfig;
  const config =
    "default" in imported
      ? (imported as { default: NextlyConfig }).default
      : (imported as NextlyConfig);

  const raw = await readFile(configPath, "utf8");
  const contentHash = createHash("sha256").update(raw).digest("hex");

  return { config, configPath, contentHash };
}
