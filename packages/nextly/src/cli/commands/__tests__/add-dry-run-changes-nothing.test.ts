/**
 * `nextly add --dry-run`, run as a shell runs it, never starts the package
 * manager and leaves the project folder exactly as it was, ending with exit
 * 0, though it plans to edit the config and the build. The package manager
 * here is a stand-in on PATH that records its own run in the project; the
 * same command without the flag does start it.
 */
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { folderSnapshot } from "../../__tests__/helpers/folder-snapshot";
import {
  NEXTLY_RUN_TIMEOUT,
  runNextly,
} from "../../__tests__/helpers/run-nextly";

const made: string[] = [];
afterEach(() => {
  for (const dir of made.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

describe("nextly add --dry-run", () => {
  it(
    "never starts the package manager and changes nothing in the project folder",
    async () => {
      const root = mkdtempSync(join(tmpdir(), "nextly-add-unchanged-"));
      made.push(root);
      const cwd = join(root, "project");
      const bin = join(root, "bin");
      mkdirSync(cwd);
      mkdirSync(bin);
      // The lockfile makes pnpm the package manager; the stand-in writes
      // the arguments it was given into the project, as an install would.
      // It is one Node script, reached as `pnpm` by a POSIX shell and as
      // `pnpm.cmd` by cmd.exe, which finds only the PATHEXT extensions, so
      // the same stand-in runs on every platform.
      writeFileSync(join(cwd, "pnpm-lock.yaml"), "");
      // A project with a config and a build, and the plugin already in its
      // node_modules, so the dry run plans every edit the real run makes.
      writeFileSync(
        join(cwd, "nextly.config.ts"),
        'import { defineConfig } from "nextly/config";\nexport default defineConfig({ collections: [] });\n'
      );
      writeFileSync(
        join(cwd, "package.json"),
        JSON.stringify({ scripts: { build: "nextly migrate && next build" } })
      );
      const plugin = join(cwd, "node_modules", "@acme", "p");
      mkdirSync(plugin, { recursive: true });
      writeFileSync(
        join(plugin, "package.json"),
        JSON.stringify({
          name: "@acme/p",
          type: "module",
          exports: "./index.js",
        })
      );
      writeFileSync(
        join(plugin, "index.js"),
        'export const acmePlugin = { name: "@acme/p", version: "1.0.0", nextly: "*" };\n'
      );
      writeFileSync(
        join(bin, "pnpm-stand-in.cjs"),
        'require("node:fs").writeFileSync(require("node:path").join(process.cwd(), "pnpm-ran.txt"), process.argv.slice(2).join(" ") + "\\n");\n'
      );
      const node = JSON.stringify(process.execPath);
      writeFileSync(
        join(bin, "pnpm"),
        `#!/bin/sh\nexec ${node} "$(dirname "$0")/pnpm-stand-in.cjs" "$@"\n`
      );
      chmodSync(join(bin, "pnpm"), 0o755);
      writeFileSync(
        join(bin, "pnpm.cmd"),
        `@${node} "%~dp0pnpm-stand-in.cjs" %*\r\n`
      );
      const env = { PATH: `${bin}${delimiter}${process.env.PATH ?? ""}` };
      const before = folderSnapshot(cwd);

      const dry = await runNextly(["add", "@acme/p", "--dry-run"], cwd, env);
      expect(dry.status, dry.stderr).toBe(0);
      expect(dry.stdout).toContain("Would run pnpm add @acme/p");
      expect(dry.stdout).toContain("Would edit nextly.config.ts");
      expect(dry.stdout).toContain("Would edit package.json");
      expect(dry.stdout).toContain("Dry run: nothing was changed.");
      expect(folderSnapshot(cwd)).toEqual(before);

      // A package the stand-in does not put in node_modules, so the real run
      // starts the package manager and then stops, changing nothing else.
      const real = await runNextly(["add", "@acme/q"], cwd, env);
      expect(readFileSync(join(cwd, "pnpm-ran.txt"), "utf8")).toBe(
        "add @acme/q\n"
      );
      expect(real.status).toBe(1);
      expect(real.stderr + real.stdout).toContain(
        "(PLUGIN_PACKAGE_NOT_INSTALLED)"
      );
    },
    NEXTLY_RUN_TIMEOUT * 2
  );
});
