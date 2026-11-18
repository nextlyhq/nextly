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

import {
  NEXTLY_RUN_TIMEOUT,
  runNextly,
} from "../../__tests__/helpers/run-nextly";
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

describe("the offending line of a configuration that does not parse", () => {
  // The line is shown so the reader sees what to fix; a credential written on it must not reach
  // a terminal or a CI log with it. The error is on the line holding them: a missing comma.
  const WITH_SECRETS = [
    "export default {",
    "  db: { password: 'hunter2-not-a-real-one' url: 'postgres://app:s3cr3t-pw@db.example:5432/app' },",
    "};",
    "",
  ].join("\n");

  it("is shown with each credential on it redacted, --verbose included", async () => {
    for (const verbose of [false, true]) {
      const report = await reportFor(WITH_SECRETS, { verbose });

      // The line is still shown: its place and the text around the credentials.
      expect(report, report).toContain("nextly.config.ts:2:");
      expect(report, report).toContain("db: { password:");
      expect(report, report).not.toContain("hunter2-not-a-real-one");
      expect(report, report).not.toContain("s3cr3t-pw");
    }
  });
});

describe("an import the configuration names that cannot be found", () => {
  // esbuild's own message quotes the specifier, which may carry a credential in its query.
  const WITH_TOKEN = [
    "import posts from './collections/posts?token=hunter2-not-a-real-one';",
    "export default { collections: [posts] };",
    "",
  ].join("\n");

  it("is named with the credential in its specifier redacted, --verbose included", async () => {
    for (const verbose of [false, true]) {
      const report = await reportFor(WITH_TOKEN, { verbose });

      expect(report, report).toContain("CONFIG_IMPORT_NOT_FOUND");
      expect(report, report).toContain("./collections/posts?token=");
      expect(report, report).not.toContain("hunter2-not-a-real-one");
    }
  });
});

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

describe("a configuration with several problems", () => {
  // Three problems in two collections: a slug with a space, and a collection whose fields name
  // one column twice and use a field type nothing offers. Each is reported, the first first.
  const THREE_PROBLEMS = [
    "export default {",
    "  collections: [",
    "    { slug: 'Blog Posts', fields: [{ name: 'title', type: 'text' }] },",
    "    {",
    "      slug: 'notes',",
    "      fields: [",
    "        { name: 'body', type: 'text' },",
    "        { name: 'body', type: 'text' },",
    "        { name: 'score', type: 'acme-rating' },",
    "      ],",
    "    },",
    "  ],",
    "};",
    "",
  ].join("\n");

  // Run as a command runs it: a configuration that compiles is imported, which the test runner's
  // own module loader cannot do in-process.
  it(
    "reports every problem with its path, the problem and the fix, then a count",
    async () => {
      writeFileSync(join(dir, "nextly.config.ts"), THREE_PROBLEMS);
      const ran = await runNextly(["generate:types"], dir, {
        DB_DIALECT: "sqlite",
        DATABASE_URL: `file:${join(dir, "unused.db")}`,
        NO_COLOR: "1",
      });
      const report = ran.stderr;

      expect(ran.status, report).toBe(1);

      expect(report, report).toContain("CONFIG_INVALID");
      // Each problem, at its path in the configuration.
      expect(report, report).toContain("collections[0].slug");
      expect(report, report).toContain("collections[1].fields");
      expect(report, report).toContain("collections[1].fields[2].type");
      expect(report, report).toContain("acme-rating");
      // In the order the configuration declares them.
      expect(report.indexOf("collections[0].slug")).toBeLessThan(
        report.indexOf("collections[1].fields")
      );
      // And how many there are.
      expect(report, report).toMatch(/3 problems/);
      expect(report.replaceAll(dir, "<project>")).toMatchSnapshot();
    },
    NEXTLY_RUN_TIMEOUT
  );
});
