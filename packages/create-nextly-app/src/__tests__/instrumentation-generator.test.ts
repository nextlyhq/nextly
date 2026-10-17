/**
 * Adding Nextly to an existing app gives it the hook that starts Nextly when
 * the server starts, and never rewrites a hook the app already has.
 *
 * Run against real directories: the point of the skip case is that the file on
 * disk keeps its bytes, which a mocked filesystem cannot show.
 */
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import fs from "fs-extra";
import ts from "typescript";
import { afterEach, describe, expect, it } from "vitest";

import { generateInstrumentation } from "../generators/instrumentation";
import { nextConfigFiles, patchNextConfig } from "../generators/next-config";
import type { DatabaseConfig } from "../types";

const here = path.dirname(fileURLToPath(import.meta.url));
const blankHook = path.resolve(
  here,
  "../../../../templates/blank/src/instrumentation.ts"
);

/** A Next.js release that runs the hook without opting in. */
const NEXT = "16.0.0";

/** Syntax errors in a TypeScript module, as the compiler reports them. */
function syntaxErrors(source: string): string[] {
  const { diagnostics = [] } = ts.transpileModule(source, {
    reportDiagnostics: true,
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  });
  return diagnostics.map(d =>
    ts.flattenDiagnosticMessageText(d.messageText, "\n")
  );
}

let project: string | undefined;

afterEach(async () => {
  if (project) await rm(project, { recursive: true, force: true });
  project = undefined;
});

/**
 * An app directory with Next.js installed at this version, as its own
 * node_modules reports it, or none installed when null.
 */
async function app(nextVersion: string | null = NEXT): Promise<string> {
  project = await mkdtemp(path.join(tmpdir(), "nextly-hook-"));
  if (nextVersion) {
    await mkdir(path.join(project, "node_modules", "next"), {
      recursive: true,
    });
    await writeFile(
      path.join(project, "node_modules", "next", "package.json"),
      JSON.stringify({ name: "next", version: nextVersion })
    );
  }
  return project;
}

describe("generateInstrumentation", () => {
  it("writes the blank template's own hook into src/ when the app lives there", async () => {
    const cwd = await app();

    const result = await generateInstrumentation(cwd, { srcDir: true });

    expect(result).toEqual({
      written: ["src/instrumentation.ts"],
      changed: [],
      skipped: [],
    });
    // One hook for both ways of starting a project: a new one from the template
    // and an existing one from this generator.
    expect(
      await readFile(path.join(cwd, "src/instrumentation.ts"), "utf-8")
    ).toBe(await readFile(blankHook, "utf-8"));
  });

  it("writes it at the root, importing the config beside it, when there is no src/", async () => {
    const cwd = await app();

    const result = await generateInstrumentation(cwd, { srcDir: false });

    expect(result.written).toEqual(["instrumentation.ts"]);
    const hook = await readFile(path.join(cwd, "instrumentation.ts"), "utf-8");
    expect(hook).toContain('await import("./nextly.config")');
    expect(hook).not.toContain('"../nextly.config"');
  });

  it.each([
    "instrumentation.ts",
    "instrumentation.tsx",
    "instrumentation.js",
    "instrumentation.jsx",
  ])(
    "leaves an existing %s exactly as it was, and says what to add",
    async name => {
      const cwd = await app();
      await mkdir(path.join(cwd, "src"), { recursive: true });
      const own =
        "export function register() {\n  // the app's own monitoring\n}\n";
      await writeFile(path.join(cwd, "src", name), own);

      const result = await generateInstrumentation(cwd, { srcDir: true });

      expect(await readFile(path.join(cwd, "src", name), "utf-8")).toBe(own);
      expect(result.written).toEqual([]);
      expect(result.skipped).toHaveLength(1);
      expect(result.skipped[0].path).toBe(`src/${name}`);
      expect(result.skipped[0].toAdd).toContain(
        "await createRegister(config)();"
      );
      expect(result.skipped[0].toAdd).toContain(
        'await import("../nextly.config")'
      );
      expect(result.skipped[0].toAdd).toContain('NEXT_RUNTIME === "nodejs"');
    }
  );

  it("does not mistake a file Next.js never loads as the hook for one it does", async () => {
    // `.mjs` is not one of Next's default page extensions, so such a file is
    // not a hook and the app still needs one.
    const cwd = await app();
    await mkdir(path.join(cwd, "src"), { recursive: true });
    await writeFile(path.join(cwd, "src/instrumentation.mjs"), "export {};\n");

    const result = await generateInstrumentation(cwd, { srcDir: true });

    expect(result.written).toEqual(["src/instrumentation.ts"]);
  });

  it.each([
    ["an installed Next.js 14", "14.2.3"],
    ["a Next.js version that cannot be read", null],
    ["Next.js 15", "15.0.3"],
  ] as const)(
    "on %s writes the hook and says nothing about the Next config, which the Next config step owns",
    async (_, version) => {
      const cwd = await app(version);
      const config = "module.exports = {};\n";
      await writeFile(path.join(cwd, "next.config.js"), config);

      const result = await generateInstrumentation(cwd, { srcDir: true });

      expect(result.written).toEqual(["src/instrumentation.ts"]);
      expect(result.skipped).toEqual([]);
      expect(await readFile(path.join(cwd, "next.config.js"), "utf-8")).toBe(
        config
      );
    }
  );

  it.each(["commonjs", "module"])(
    "on a Next.js 14 app with no config, following the advice makes one config that opts in and lists the packages, in a %s project",
    async type => {
      const cwd = await app("14.2.3");
      await writeFile(path.join(cwd, "package.json"), JSON.stringify({ type }));
      const sqlite: DatabaseConfig = {
        type: "sqlite",
        adapter: "@nextlyhq/adapter-sqlite",
        databaseDriver: "better-sqlite3",
        connectionUrl: "file:./data/nextly.db",
        envExample: "file:./data/nextly.db",
      };

      // The order the scaffolder runs them in.
      const hook = await generateInstrumentation(cwd, { srcDir: true });
      const patch = await patchNextConfig(cwd, sqlite);

      // One piece of advice about the config, from one step.
      expect(hook.skipped).toEqual([]);
      expect(patch).toMatchObject({
        kind: "manual",
        file: "next.config.mjs",
        create: true,
      });
      // The whole file the run says to create, as it prints it to add.
      const message = nextConfigFiles(patch).skipped[0]?.toAdd ?? "";
      const created = path.join(cwd, "next.config.mjs");
      await writeFile(created, message.slice(message.indexOf("/** @type")));
      // Loaded the way Node loads it: both keys survive, in one object.
      const loaded = (await import(pathToFileURL(created).href)) as {
        default: {
          experimental?: {
            instrumentationHook?: boolean;
            serverComponentsExternalPackages?: string[];
          };
        };
      };
      expect(loaded.default.experimental?.instrumentationHook).toBe(true);
      expect(
        loaded.default.experimental?.serverComponentsExternalPackages
      ).toEqual(expect.arrayContaining(["@nextlyhq/adapter-sqlite"]));
    }
  );
});
