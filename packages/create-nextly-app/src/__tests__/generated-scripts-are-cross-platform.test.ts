/**
 * No script the CLI GENERATES may depend on a POSIX shell.
 *
 * `npm run` executes scripts through `cmd.exe` on Windows. It has no `test`, no `true`, no `[`,
 * no command substitution and no `wait`, so a script reaching for any of them fails there and
 * nowhere else — after the commands before it have already done their work, which is what makes
 * the failure read as unrelated to the script.
 *
 * This repository has already paid for that lesson once, in `packages/ui`'s `dev` script, and
 * `packages/ui/src/__tests__/package-scripts-are-cross-platform.test.ts` now refuses the construct
 * that caused it. That guard reads the workspace manifests — every `package.json` pnpm knows
 * about. A script this CLI writes into somebody else's project is not one of those, so it sits
 * outside that guard's domain entirely, and the generated `build` carried
 *
 *     (test -f scripts/build-search-index.mjs && node scripts/... || true)
 *
 * unnoticed. Same defect, one directory over.
 *
 * The check is therefore on the OUTPUT of the generator rather than on any file, and it runs over
 * every template so a construct reintroduced for one of them cannot hide behind the others.
 */
import { describe, expect, it } from "vitest";

import type { DatabaseConfig, ProjectType } from "../types";
import { generatePackageJson } from "../utils/template";

const sqlite: DatabaseConfig = {
  type: "sqlite",
  adapter: "@nextlyhq/adapter-sqlite",
  databaseDriver: "better-sqlite3",
  connectionUrl: "file:./data/nextly.db",
  envExample: "file:./data/nextly.db",
};

/**
 * Constructs `cmd.exe` cannot run, each with the reason it is here.
 *
 * Matched as whole words where the token is a command name: `true` must not match `truelove`, and
 * `test` must not match a script legitimately named `test`. That is why each pattern anchors on a
 * command position — the start of the script, or just after a separator — rather than searching
 * for the bare word anywhere.
 */
const POSIX_ONLY = [
  {
    name: "the `test` builtin",
    pattern: /(?:^|[;&|(]\s*)test\s/,
    why: "cmd.exe has no `test`; use a generator-side decision instead of a shell conditional",
  },
  {
    name: "the `true` builtin",
    pattern: /(?:^|[;&|(]\s*)true(?![\w-])/,
    why: "cmd.exe has no `true`, and `|| true` also swallows the failure it is hiding",
  },
  {
    name: "the `[` test builtin",
    pattern: /(?:^|[;&|(]\s*)\[\s/,
    why: "cmd.exe has no `[`",
  },
  {
    name: "command substitution",
    pattern: /\$\(|`/,
    why: "cmd.exe expands neither `$(...)` nor backticks",
  },
  {
    name: "backgrounding then waiting",
    pattern: /&[\s\S]*?(?:^|[\s;&])?\bwait(?![\w-])/,
    why: "cmd.exe treats `&` as sequential and has no `wait`",
  },
] as const;

function offences(script: string): string[] {
  return POSIX_ONLY.filter(rule => rule.pattern.test(script)).map(
    rule => `${rule.name} — ${rule.why}`
  );
}

describe("generated package scripts", () => {
  // Every template, because the generator branches on what the template ships: gating a step
  // behind `shipsSearchIndex` means one template's scripts are not the other's, and checking a
  // single project type would leave the branch that differs unexamined.
  it.each(["blank", "blog"] as const)(
    "gives a %s scaffold only scripts cmd.exe can run",
    async (projectType: ProjectType) => {
      const pkg = JSON.parse(
        await generatePackageJson("app", sqlite, false, projectType)
      );

      const found: string[] = [];
      for (const [name, script] of Object.entries(
        pkg.scripts as Record<string, string>
      )) {
        for (const offence of offences(script)) {
          found.push(`${name}: ${script}\n  -> ${offence}`);
        }
      }
      expect(found).toEqual([]);

      // A control on the loop above, not on the scripts. It reports success by finding nothing,
      // which is also what an empty `scripts` object produces — so the set it scanned has to be
      // non-empty, and has to contain the script this guard exists for.
      expect(Object.keys(pkg.scripts).length).toBeGreaterThan(0);
      expect(pkg.scripts.build).toContain("next build");
    },
    30_000
  );

  // A control on the DETECTOR. Without it, a rule whose pattern silently stopped matching would
  // report every script clean and read exactly like a repository with no POSIX-isms in it.
  it("rejects the exact script that shipped before", () => {
    const shipped =
      "nextly migrate && next build && (test -f scripts/build-search-index.mjs && node scripts/build-search-index.mjs || true)";

    const detected = offences(shipped);
    expect(detected).toHaveLength(2);
    expect(detected.join("\n")).toMatch(/`test` builtin/);
    expect(detected.join("\n")).toMatch(/`true` builtin/);
  });

  // The other direction: the replacement must be accepted, or the guard is merely refusing
  // everything and the test above would pass on a detector that always fires.
  it("accepts the portable replacement", () => {
    expect(
      offences(
        "nextly migrate && next build && node scripts/build-search-index.mjs"
      )
    ).toEqual([]);
  });
});
