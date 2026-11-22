/**
 * The forms plugin reaches the page builder only through its cross-plugin
 * `forms` service and the plugin SDK's contract: no file of this plugin
 * imports the page builder or its block library, so each can be installed
 * without the other.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Every source file under `dir`, tests included. */
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

/** The page builder's packages, which this plugin must not import. */
const PAGE_BUILDER =
  /from\s+["'](@nextlyhq\/plugin-page-builder|@nextlyhq\/blocks-react|@nextlyhq\/builder)(\/[^"']*)?["']|import\(\s*["'](@nextlyhq\/plugin-page-builder|@nextlyhq\/blocks-react|@nextlyhq\/builder)/;

describe("the forms plugin's import boundary", () => {
  it("imports nothing of the page builder's", () => {
    const files = sources(SRC);
    // Must-be-found: the walk read the plugin, its provider among it.
    expect(files.some(file => file.endsWith("form-provider/provider.ts"))).toBe(
      true
    );
    const self = fileURLToPath(import.meta.url);
    const crossing = files.filter(
      file => file !== self && PAGE_BUILDER.test(readFileSync(file, "utf8"))
    );
    expect(crossing).toEqual([]);
  });

  it("would see such an import", () => {
    // The control: the pattern catches the forms it is meant to.
    for (const line of [
      'import { x } from "@nextlyhq/plugin-page-builder";',
      'import type { y } from "@nextlyhq/blocks-react/blocks";',
      'await import("@nextlyhq/builder")',
    ]) {
      expect(PAGE_BUILDER.test(line), line).toBe(true);
    }
  });
});
