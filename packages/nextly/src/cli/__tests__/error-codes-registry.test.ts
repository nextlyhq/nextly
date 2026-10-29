/**
 * The CLI's error codes are a published surface: each has one cause, keeps it once released, and
 * has a docs page; and every error a command can end with reaches one of them.
 *
 * `released-codes.json` is the checked-in list of released codes with the cause each stands for.
 * Removing or renaming a code, or giving it another cause, fails here; so does adding one without
 * listing it, so the list is never behind what ships.
 *
 * @module cli/__tests__/error-codes-registry.test
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { NEXTLY_ERROR_STATUS } from "../../errors/error-codes";
import {
  CLI_ERROR_CODES,
  cliErrorSlug,
  formatCliError,
  toCliError,
  type CliErrorCode,
} from "../errors";
import { CLI_ERROR_MAPPINGS } from "../errors/from-thrown";
import { CLI_ERROR_AREAS } from "../errors/registry";
import releasedCodes from "../errors/released-codes.json";

import { ERROR_CASES } from "./error-cases";

const here = dirname(fileURLToPath(import.meta.url));
const SRC = join(here, "..", "..");
const REPO = join(SRC, "..", "..", "..");
const DOCS = join(REPO, "docs", "cli", "errors");

const codes = Object.keys(CLI_ERROR_CODES) as CliErrorCode[];
const released = releasedCodes as Record<string, string>;

/** Every non-test TypeScript file under `dir`. */
function sourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (name === "__tests__" || name === "__snapshots__") continue;
      files.push(...sourceFiles(path));
    } else if (name.endsWith(".ts") && !/\.test(-d)?\.ts$/.test(name)) {
      files.push(path);
    }
  }
  return files;
}

describe("the CLI's error codes", () => {
  it("no two causes share a code", () => {
    // Each code is declared once: one declared in two areas would keep only the later cause.
    const declared = CLI_ERROR_AREAS.flatMap(area => Object.keys(area));
    expect(declared.filter((code, i) => declared.indexOf(code) !== i)).toEqual(
      []
    );

    // One code per cause: two codes stating the same cause would be one cause under two names.
    const causes = codes.map(code => CLI_ERROR_CODES[code].cause);
    expect(new Set(causes).size).toBe(causes.length);
    for (const cause of causes) expect(cause).toMatch(/^\S.*\.$/);

    // And one reading per error: two fallback mappings for one code and reason would leave which
    // code the error ends as to the order of the registry.
    const fallbacks = CLI_ERROR_MAPPINGS.filter(
      m => m.when === undefined && m.issue === undefined
    ).map(m => `${m.code}#${m.reason ?? ""}`);
    expect(fallbacks.filter((key, i) => fallbacks.indexOf(key) !== i)).toEqual(
      []
    );
  });

  it("every released code is still present with its meaning", () => {
    // The codes the guides already document keep their spelling.
    expect(released).toHaveProperty("MIGRATION_TAMPERED");
    expect(released).toHaveProperty("MIGRATION_MISSING");

    const now = Object.fromEntries(
      codes.map(code => [code, CLI_ERROR_CODES[code].cause])
    );
    for (const [code, cause] of Object.entries(released)) {
      expect(now[code], `${code} was released and must stay`).toBe(cause);
    }
    // A code not yet listed would ship unprotected.
    expect(codes.filter(code => !(code in released))).toEqual([]);
  });

  it("uses an HTTP error code's name only for the error that code names", () => {
    // The REST API's codes are a surface of their own. A CLI code spelt like one must be the CLI
    // reading of that same error, never another cause under a name scripts already match on.
    const http = new Set(Object.keys(NEXTLY_ERROR_STATUS));
    for (const code of codes.filter(c => http.has(c))) {
      const from = CLI_ERROR_MAPPINGS.filter(m => m.to === code).map(
        m => m.code
      );
      expect(from, code).toContain(code);
    }
  });

  it("every code the CLI can print has a docs page", () => {
    const index = readFileSync(join(DOCS, "index.mdx"), "utf8");
    const meta = JSON.parse(readFileSync(join(DOCS, "meta.json"), "utf8")) as {
      pages: string[];
    };
    for (const code of codes) {
      const slug = cliErrorSlug(code);
      const path = join(DOCS, `${slug}.mdx`);
      expect(existsSync(path), `${relative(REPO, path)} for ${code}`).toBe(
        true
      );
      const page = readFileSync(path, "utf8");
      expect(page, code).toMatch(new RegExp(`^title: ${code}$`, "m"));
      expect(page, code).toContain(CLI_ERROR_CODES[code].cause);
      for (const section of ["## Cause", "## Fix", "## Example"]) {
        expect(page, `${code}: ${section}`).toContain(section);
      }
      expect(index, `the index lists ${code}`).toContain(
        `(/docs/cli/errors/${slug})`
      );
      expect(meta.pages, `the sidebar lists ${slug}`).toContain(slug);
    }
    // And no page for a code that is not there: a stale page reads as a code that still exists.
    const pages = readdirSync(DOCS)
      .filter(name => name.endsWith(".mdx") && name !== "index.mdx")
      .map(name => name.replace(/\.mdx$/, ""));
    expect(pages.sort()).toEqual(codes.map(cliErrorSlug).sort());
  });

  it("each docs page's example is what the terminal prints for that code", async () => {
    // Written by hand, an example drifts from the code the day the wording changes.
    for (const code of codes) {
      const page = readFileSync(
        join(DOCS, `${cliErrorSlug(code)}.mdx`),
        "utf8"
      );
      const example = /## Example[\s\S]*?```text\n([\s\S]*?)\n```/.exec(
        page
      )?.[1];
      const printed = formatCliError(toCliError(await ERROR_CASES[code]()));
      expect(example, code).toBe(printed);
    }
  });
});

/**
 * Codes the HTTP layer's factories use for many causes at once. An error carrying one is told
 * apart by its `logContext.reason`, or prints as `UNEXPECTED_ERROR`, rather than mapped by code.
 */
const SHARED_CODES = new Set([
  "VALIDATION_ERROR",
  "INVALID_INPUT",
  "INVALID",
  "NOT_FOUND",
  "CONFLICT",
  "DUPLICATE",
  "FORBIDDEN",
  "INTERNAL_ERROR",
  "SERVICE_UNAVAILABLE",
  "DATABASE_ERROR",
  "DATABASE_BUSY",
  "CONFIGURATION_ERROR",
  "BUSINESS_RULE_VIOLATION",
]);

/** The folders whose code a command runs: the CLI, the schema and migration domain, plugins. */
const COMMAND_PATHS = ["cli", join("domains", "schema"), "plugins"];

/** Each code a `new NextlyError({ code: "…" })` under the command paths throws, with its file. */
function thrownCodes(): Map<string, string> {
  const found = new Map<string, string>();
  const construction =
    /new NextlyError\(\{\s*(?:\/\/[^\n]*\n\s*)*code:\s*"([A-Z][A-Z0-9_]*)"/g;
  for (const dir of COMMAND_PATHS) {
    for (const file of sourceFiles(join(SRC, dir))) {
      for (const match of readFileSync(file, "utf8").matchAll(construction)) {
        if (!found.has(match[1])) found.set(match[1], relative(SRC, file));
      }
    }
  }
  return found;
}

describe("the errors a command can end with", () => {
  it("every error code thrown where commands run reads as a CLI code of its own", () => {
    const thrown = thrownCodes();
    // The scan reaches the throws it exists to read: the lock's refusal and a migration drift.
    expect(thrown.get("NEXTLY_MIGRATE_LOCK_BUSY")).toBe(
      join("domains", "schema", "pipeline", "schema-lock.ts")
    );
    expect(thrown.has("NEXTLY_MIGRATION_DRIFT")).toBe(true);

    const mapped = new Set(CLI_ERROR_MAPPINGS.map(m => m.code));
    const unmapped = [...thrown]
      .filter(([code]) => !SHARED_CODES.has(code) && !mapped.has(code))
      .map(([code, file]) => `${code} (${file})`);
    expect(unmapped).toEqual([]);
  });

  it("no command ends with exit 1 except through the error shape", () => {
    // `exitWithError` prints the shape and exits; the entry point exits after `reportCliError`,
    // and its last handler covers the CLI failing to load before any command exists.
    const allowed = new Set([
      join("cli", "errors", "report.ts"),
      join("cli", "nextly.ts"),
    ]);
    const literal = /process\.exit\(\s*1\s*\)|process\.exitCode\s*=\s*1\b/;
    // A status worked out at run time ends a command too. Each is a command's own verdict, and
    // allowed only where the file named beside it prints the shape before the status is set.
    const computed =
      /process\.exit\(\s*(?![0-9]+\s*\))[^)\s]|process\.exitCode\s*=\s*(?![0-9]+\b)\S/;
    const verdicts = new Map([
      [
        join("cli", "commands", "generate-types.ts"),
        join("cli", "commands", "component-map-check-command.ts"),
      ],
      [join("cli", "commands", "add.ts"), join("cli", "commands", "add.ts")],
      [
        join("cli", "commands", "media.ts"),
        join("cli", "commands", "media.ts"),
      ],
      [
        join("cli", "commands", "create-admin.ts"),
        join("cli", "commands", "create-admin.ts"),
      ],
    ]);
    const found: string[] = [];
    for (const file of sourceFiles(join(SRC, "cli"))) {
      const path = relative(SRC, file);
      if (allowed.has(path)) continue;
      readFileSync(file, "utf8")
        .split("\n")
        .forEach((line, i) => {
          if (literal.test(line)) found.push(`${path}:${i + 1}`);
          else if (computed.test(line) && !verdicts.has(path)) {
            found.push(`${path}:${i + 1} (a computed status)`);
          }
        });
    }
    expect(found).toEqual([]);
    for (const printer of new Set(verdicts.values())) {
      expect(readFileSync(join(SRC, printer), "utf8"), printer).toMatch(
        /\bprintCliError\(/
      );
    }
  });
});

/** The code each `NextlyError` factory gives what it builds. */
const FACTORY_CODES: Record<string, string> = {
  invalidInput: "INVALID_INPUT",
  conflict: "CONFLICT",
  validation: "VALIDATION_ERROR",
  serviceUnavailable: "SERVICE_UNAVAILABLE",
  internal: "INTERNAL_ERROR",
};

/** The text of the call opening at `from`: up to the parenthesis that closes it. */
function callAt(text: string, from: number): string {
  let depth = 0;
  for (let end = text.indexOf("(", from); end < text.length; end += 1) {
    if (text[end] === "(") depth += 1;
    else if (text[end] === ")" && --depth === 0)
      return text.slice(from, end + 1);
  }
  return text.slice(from);
}

/** The `logContext.reason` a call gives: a literal, or the fixed start of a template. */
function reasonOf(call: string): { reason?: string; prefix?: string } {
  const at = call.indexOf("logContext");
  if (at === -1) return {};
  const context = call.slice(at);
  return {
    reason: /\breason:\s*"([^"]+)"/.exec(context)?.[1],
    prefix: /\breason:\s*`([^`$]*)\$\{/.exec(context)?.[1],
  };
}

/** Each `NextlyError` built in `text`, with its code and the reason it is given. */
function constructions(
  text: string
): Array<{ code: string; reason?: string; prefix?: string; at: number }> {
  return [...text.matchAll(/new NextlyError\(|NextlyError\.(\w+)\(/g)].flatMap(
    match => {
      const call = callAt(text, match.index);
      const code =
        match[1] === undefined
          ? /code:\s*"([A-Z][A-Z0-9_]*)"/.exec(call)?.[1]
          : FACTORY_CODES[match[1]];
      return code === undefined
        ? []
        : [{ code, ...reasonOf(call), at: match.index }];
    }
  );
}

describe("the reasons a mapping reads", () => {
  it("every INVALID_INPUT or CONFLICT a command throws carries a reason a mapping reads", () => {
    // These codes stand for many causes at once, so one without a reason, or with one nothing
    // maps, ends as UNEXPECTED_ERROR: an ordinary refusal told it was not expected.
    const unread: string[] = [];
    let seen = 0;
    for (const file of sourceFiles(join(SRC, "cli"))) {
      const path = relative(SRC, file);
      if (path.startsWith(join("cli", "errors"))) continue;
      const text = readFileSync(file, "utf8");
      for (const built of constructions(text)) {
        if (built.code !== "INVALID_INPUT" && built.code !== "CONFLICT")
          continue;
        seen += 1;
        const read = CLI_ERROR_MAPPINGS.some(
          m =>
            m.code === built.code &&
            m.reason !== undefined &&
            (m.reason === built.reason ||
              (built.prefix !== undefined && m.reason.startsWith(built.prefix)))
        );
        if (!read) {
          const line = text.slice(0, built.at).split("\n").length;
          unread.push(
            `${path}:${line} ${built.code} reason=${built.reason ?? built.prefix ?? "none"}`
          );
        }
      }
    }
    // The scan reaches the throws it reads: the commands throw dozens of these.
    expect(seen).toBeGreaterThan(10);
    expect(unread).toEqual([]);
  });

  it("every reason a mapping reads is one a throw site writes", () => {
    // A throw site that drops or misspells its reason leaves its mapping reading nothing, and the
    // error ends as another code; the cases cannot see that, since they build the error themselves.
    const product = [
      ...sourceFiles(SRC).filter(
        file => !file.startsWith(join(SRC, "cli", "errors"))
      ),
    ]
      .map(file => readFileSync(file, "utf8"))
      .join("\n");
    const unwritten = [
      ...new Set(
        CLI_ERROR_MAPPINGS.flatMap(m =>
          m.reason === undefined ? [] : [m.reason]
        )
      ),
    ].filter(
      reason =>
        !product.includes(`"${reason}"`) &&
        !product.includes(`\`${reason}\``) &&
        // A reason made from a template, such as data-loss-${verdict.reason}.
        !(/^data-loss-/.test(reason) && product.includes("`data-loss-${"))
    );
    expect(unwritten).toEqual([]);
  });
});
