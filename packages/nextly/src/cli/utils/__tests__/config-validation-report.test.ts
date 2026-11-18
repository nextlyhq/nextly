/**
 * What a command prints when the configuration cannot be used: a configuration that does not
 * parse names its file, line and column once, with the line itself.
 *
 * The configuration is a real file on disk, bundled by the loader every command uses, so what is
 * asserted is what esbuild reports for it, not a constructed failure.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { toCliError } from "../../errors";
import { formatCliError } from "../../errors/render";
import { clearConfigCache, loadConfig } from "../config-loader";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nextly-config-report-"));
  clearConfigCache();
});

afterEach(() => {
  clearConfigCache();
  rmSync(dir, { recursive: true, force: true });
});

/** What a command ends with when it loads the project's configuration, as the terminal shows it. */
async function reportFor(
  source: string,
  options: { verbose?: boolean } = {}
): Promise<string> {
  writeFileSync(join(dir, "nextly.config.ts"), source);
  try {
    await loadConfig({ cwd: dir });
  } catch (error) {
    return formatCliError(toCliError(error), { color: false, ...options });
  }
  throw new Error("expected the configuration to be refused");
}

/** How many times `needle` occurs in `text`. */
const occurrences = (text: string, needle: string) =>
  text.split(needle).length - 1;

describe("a configuration that does not parse", () => {
  // A brace left open: esbuild stops at the `]` on line 4. Two characters outside ASCII before
  // it on that line make esbuild's column (bytes, from 0) differ from an editor's (characters,
  // from 1): 11 characters precede the `]`, in 13 bytes.
  const ERROR_LINE = "  /* éé */ ],";
  const MISSING_BRACE = [
    "export default {",
    "  collections: [",
    "    { slug: 'posts', fields: [ { name: 'title', type: 'text' } ]",
    ERROR_LINE,
    "};",
    "",
  ].join("\n");

  it("names the file, line and column once, with the offending line", async () => {
    const report = await reportFor(MISSING_BRACE);

    // Line 4, column 12 as an editor counts it.
    expect(occurrences(report, "nextly.config.ts:4:12"), report).toBe(1);
    // No other spelling of the place: neither esbuild's own column nor a "line 4" sentence.
    expect(occurrences(report, ":4:13"), report).toBe(0);
    expect(report).not.toMatch(/line 4\b/);
    // The line itself, as written, once.
    expect(occurrences(report, ERROR_LINE), report).toBe(1);
    expect(report).toMatchSnapshot();
  });

  it("names no other place under --verbose, its context and stack included", async () => {
    const report = await reportFor(MISSING_BRACE, { verbose: true });

    // The context and the stack name the editor's place too; esbuild's own never appears.
    expect(report).toContain("Context:");
    expect(report).toContain("nextly.config.ts:4:12");
    expect(occurrences(report, ":4:13"), report).toBe(0);
  });
});
