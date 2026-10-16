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
import { fileURLToPath } from "node:url";

import fs from "fs-extra";
import ts from "typescript";
import { afterEach, describe, expect, it } from "vitest";

import { generateInstrumentation } from "../generators/instrumentation";

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

async function app(): Promise<string> {
  project = await mkdtemp(path.join(tmpdir(), "nextly-hook-"));
  return project;
}

describe("generateInstrumentation", () => {
  it("writes the blank template's own hook into src/ when the app lives there", async () => {
    const cwd = await app();

    const result = await generateInstrumentation(cwd, {
      srcDir: true,
      nextVersion: NEXT,
    });

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

    const result = await generateInstrumentation(cwd, {
      srcDir: false,
      nextVersion: NEXT,
    });

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

      const result = await generateInstrumentation(cwd, {
        srcDir: true,
        nextVersion: NEXT,
      });

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

  it("says what to add as code that compiles, so pasting it into a synchronous hook cannot break the build", async () => {
    const cwd = await app();
    await mkdir(path.join(cwd, "src"), { recursive: true });
    await writeFile(
      path.join(cwd, "src/instrumentation.ts"),
      "export function register() {}\n"
    );

    const { skipped } = await generateInstrumentation(cwd, {
      srcDir: true,
      nextVersion: NEXT,
    });

    const code = skipped[0].toAdd?.slice(
      skipped[0].toAdd.indexOf("export async function")
    );
    expect(code).toMatch(/^export async function register\(\)/);
    expect(syntaxErrors(code ?? "")).toEqual([]);
  });

  it("writes no hook when the app sets pageExtensions, and gives the whole hook to add under the right name", async () => {
    const cwd = await app();
    await writeFile(
      path.join(cwd, "next.config.mjs"),
      'export default { pageExtensions: ["page.tsx", "page.ts"] };\n'
    );

    const result = await generateInstrumentation(cwd, {
      srcDir: true,
      nextVersion: NEXT,
    });

    expect(result.written).toEqual([]);
    expect(await fs.pathExists(path.join(cwd, "src/instrumentation.ts"))).toBe(
      false
    );
    expect(result.skipped[0].why).toContain("pageExtensions");
    expect(result.skipped[0].toAdd).toBe(await readFile(blankHook, "utf-8"));
  });

  it("on Next.js 14 writes the hook and says how to opt in, leaving the config as it was", async () => {
    const cwd = await app();
    const config = "module.exports = {};\n";
    await writeFile(path.join(cwd, "next.config.js"), config);

    const result = await generateInstrumentation(cwd, {
      srcDir: true,
      nextVersion: "^14.2.3",
    });

    expect(result.written).toEqual(["src/instrumentation.ts"]);
    expect(result.skipped).toEqual([
      expect.objectContaining({
        path: "next.config.js",
        toAdd: "experimental: { instrumentationHook: true },",
      }),
    ]);
    expect(await readFile(path.join(cwd, "next.config.js"), "utf-8")).toBe(
      config
    );
  });

  it.each(["15.0.0", "16.1.0"])(
    "asks for no opt-in on Next.js %s",
    async nextVersion => {
      const result = await generateInstrumentation(await app(), {
        srcDir: true,
        nextVersion,
      });
      expect(result.skipped).toEqual([]);
    }
  );

  it("does not mistake a file Next.js never loads as the hook for one it does", async () => {
    // `.mjs` is not one of Next's default page extensions, so such a file is
    // not a hook and the app still needs one.
    const cwd = await app();
    await mkdir(path.join(cwd, "src"), { recursive: true });
    await writeFile(path.join(cwd, "src/instrumentation.mjs"), "export {};\n");

    const result = await generateInstrumentation(cwd, {
      srcDir: true,
      nextVersion: NEXT,
    });

    expect(result.written).toEqual(["src/instrumentation.ts"]);
  });
});
