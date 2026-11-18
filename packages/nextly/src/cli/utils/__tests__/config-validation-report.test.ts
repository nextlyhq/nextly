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

  // A value under a name no rule recognises, on the line after its key: nothing in the line says
  // it is a credential, so every string on a shown line is masked, whatever it holds.
  it("is shown with every string on it masked, so a credential no rule recognises is not printed", async () => {
    const report = await reportFor(
      [
        "export default {",
        "  db: {",
        "    password:",
        "      'Xq9-not-a-real-one' broken,",
        "  },",
        "};",
        "",
      ].join("\n")
    );

    expect(report, report).toContain("nextly.config.ts:4:");
    expect(report, report).toContain("broken");
    expect(report, report).not.toContain("Xq9-not-a-real-one");
  });

  // A string longer than the excerpt reaches, before the error: cut first, its opening quote would
  // fall outside the excerpt and its tail would no longer read as a string. No part of it shows.
  it("masks a string the excerpt cuts into, so no part of a long credential is printed", async () => {
    const secret = "Zk7" + "q".repeat(40) + "Wm4" + "r".repeat(40) + "Tx2";
    const report = await reportFor(
      [
        `export const value = "${secret}" broken;`,
        "export default {};",
        "",
      ].join("\n")
    );

    expect(report, report).toContain("broken");
    for (const part of ["Zk7", "Wm4", "Tx2", "q".repeat(10), "r".repeat(10)]) {
      expect(report, report).not.toContain(part);
    }
  });

  // The error is the credential itself: a string the line opens and never closes, on the line
  // after its key. It is masked to the line's end.
  it("masks a string the line never closes", async () => {
    const report = await reportFor(
      [
        "export default {",
        "  db: {",
        "    password:",
        '      "Pv8-not-a-real-one',
        "  },",
        "};",
        "",
      ].join("\n")
    );

    expect(report, report).toContain("nextly.config.ts:4:");
    expect(report, report).not.toContain("Pv8-not-a-real-one");
  });

  // The unfinished string ends with an escaped quote, which does not close it: it is masked
  // from the quote that opened it, not from the escaped one.
  it("masks an unfinished string from its opening quote, past an escaped one", async () => {
    const report = await reportFor(
      [
        "export default {",
        "  db: {",
        "    password:",
        '      "Rt6-not-a-real-one\\"',
        "  },",
        "};",
        "",
      ].join("\n")
    );

    expect(report, report).toContain("nextly.config.ts:");
    expect(report, report).not.toContain("Rt6-not-a-real-one");
  });

  // A control character on the line would act on the terminal or the CI log it is written to
  // (an escape sequence can clear the screen); it is shown escaped, as text.
  it("shows a control character on the line escaped, never raw", async () => {
    const report = await reportFor(
      ["export default { a: 1 b: 2 }; // \u001b[2J\u0007", ""].join("\n")
    );

    expect(report, report).toContain("nextly.config.ts:1:");
    // No control character reaches the report raw: C0 and C1 controls, and DEL.
    const raw = Array.from(report).filter(character => {
      const code = character.codePointAt(0) ?? 0;
      return (
        code <= 0x08 ||
        (code >= 0x0b && code <= 0x1f) ||
        (code >= 0x7f && code <= 0x9f)
      );
    });
    expect(raw, report).toEqual([]);
    expect(report, report).toContain("\\x1b[2J");
  });

  // A generated file can hold one very long line; the report shows a bounded excerpt around the
  // place, marked where it was cut, rather than the whole line.
  it("is shown as a bounded excerpt around the place on a very long line", async () => {
    const padding = "a".repeat(5000);
    const report = await reportFor(
      [
        `export const long = [${padding
          .split("")
          .map(() => "1")
          .join(",")}] broken;`,
        "export default {};",
        "",
      ].join("\n")
    );

    expect(report, report).toContain("broken");
    expect(report, report).toContain("…");
    expect(report.length, report.slice(0, 400)).toBeLessThan(1500);
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
