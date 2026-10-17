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
/**
 * The type errors a hook body has, checked as a program rather than only
 * transpiled, so an `await` outside an async function, a name never declared
 * or a call with the wrong arguments all show. Nextly's own modules are
 * declared by the shape the body uses them in: this package does not depend
 * on nextly, and the real API is compiled against the same body by the
 * scaffold jobs, which build the blank template whose hook shares it.
 */
async function typeErrors(source: string): Promise<string[]> {
  const root = await mkdtemp(path.join(tmpdir(), "hook-types-"));
  try {
    await mkdir(path.join(root, "src"), { recursive: true });
    const hook = path.join(root, "src/instrumentation.ts");
    const declarations = path.join(root, "nextly.d.ts");
    await writeFile(hook, source);
    await writeFile(
      path.join(root, "nextly.config.ts"),
      "export default {};\n"
    );
    await writeFile(
      declarations,
      [
        'declare module "nextly/runtime" { export function registerNextCacheRevalidator(): void; }',
        'declare module "nextly" { export function createRegister(config: unknown): () => Promise<void>; }',
        "declare const process: { env: Record<string, string | undefined> };",
      ].join("\n")
    );
    const program = ts.createProgram([hook, declarations], {
      strict: true,
      noEmit: true,
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      types: [],
      skipLibCheck: true,
    });
    return ts
      .getPreEmitDiagnostics(program)
      .map(d => ts.flattenDiagnosticMessageText(d.messageText, "\n"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
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

  it("says what to add as code that compiles, so pasting it into a synchronous hook cannot break the build", async () => {
    const cwd = await app();
    await mkdir(path.join(cwd, "src"), { recursive: true });
    await writeFile(
      path.join(cwd, "src/instrumentation.ts"),
      "export function register() {}\n"
    );

    const { skipped } = await generateInstrumentation(cwd, { srcDir: true });

    const code = skipped[0].toAdd?.slice(
      skipped[0].toAdd.indexOf("export async function")
    );
    expect(code).toMatch(/^export async function register\(\)/);
    expect(await typeErrors(code ?? "")).toEqual([]);
  });

  it("writes no hook when the app sets pageExtensions, and gives the whole hook to add under the right name", async () => {
    const cwd = await app();
    await writeFile(
      path.join(cwd, "next.config.mjs"),
      'export default { pageExtensions: ["page.tsx", "page.ts"] };\n'
    );

    const result = await generateInstrumentation(cwd, { srcDir: true });

    expect(result.written).toEqual([]);
    expect(await fs.pathExists(path.join(cwd, "src/instrumentation.ts"))).toBe(
      false
    );
    // Under a name Next.js reads: one of the app's own page extensions.
    expect(result.skipped[0].path).toBe("src/instrumentation.page.tsx");
    expect(result.skipped[0].why).toContain("pageExtensions");
    expect(result.skipped[0].toAdd).toBe(await readFile(blankHook, "utf-8"));
  });

  it("gives a JavaScript hook when the app's page extensions are JavaScript", async () => {
    const cwd = await app();
    await writeFile(
      path.join(cwd, "next.config.mjs"),
      'export default { pageExtensions: ["page.jsx", "page.js"] };\n'
    );

    const [offered] = (await generateInstrumentation(cwd, { srcDir: true }))
      .skipped;

    expect(offered.path).toBe("src/instrumentation.page.jsx");
    // Parsed as the file it would be saved as: TypeScript syntax fails here.
    const { diagnostics = [] } = ts.transpileModule(offered.toAdd ?? "", {
      reportDiagnostics: true,
      fileName: "instrumentation.page.js",
      compilerOptions: { allowJs: true, module: ts.ModuleKind.ESNext },
    });
    expect(diagnostics.map(d => d.messageText)).toEqual([]);
    expect(offered.toAdd).toContain("export async function register()");
  });

  it("names no file when the pageExtensions list holds anything but plain strings", async () => {
    const cwd = await app();
    await writeFile(
      path.join(cwd, "next.config.mjs"),
      'const useTs = false;\nexport default { pageExtensions: [...(useTs ? ["page.tsx"] : []), "page.js"] };\n'
    );

    const result = await generateInstrumentation(cwd, { srcDir: true });

    expect(result.skipped[0].path).toBe(
      "src/instrumentation.<one of your pageExtensions>"
    );
  });

  it("adds Nextly to a hook the app already has under its page-extension name", async () => {
    const cwd = await app();
    await writeFile(
      path.join(cwd, "next.config.mjs"),
      'export default { pageExtensions: ["page.tsx"] };\n'
    );
    await mkdir(path.join(cwd, "src"), { recursive: true });
    const own = "export function register() {}\n";
    await writeFile(path.join(cwd, "src/instrumentation.page.tsx"), own);

    const [offered] = (await generateInstrumentation(cwd, { srcDir: true }))
      .skipped;

    expect(offered.path).toBe("src/instrumentation.page.tsx");
    expect(offered.why).toContain("already has a server-start hook");
    expect(offered.toAdd).toMatch(/^Make register\(\) async/);
    expect(
      await readFile(path.join(cwd, "src/instrumentation.page.tsx"), "utf-8")
    ).toBe(own);
  });

  it("reads pageExtensions from the config it exports, not from a comment", async () => {
    const cwd = await app();
    await writeFile(
      path.join(cwd, "next.config.mjs"),
      '/* pageExtensions: ["page.js"] */\nexport default { pageExtensions: ["page.ts"] };\n'
    );

    const [offered] = (await generateInstrumentation(cwd, { srcDir: true }))
      .skipped;

    expect(offered.path).toBe("src/instrumentation.page.ts");
  });

  it("writes the default hook when pageExtensions appears only in a comment", async () => {
    const cwd = await app();
    await writeFile(
      path.join(cwd, "next.config.mjs"),
      '// pageExtensions: ["page.tsx"]\nexport default {};\n'
    );

    const result = await generateInstrumentation(cwd, { srcDir: true });

    expect(result.written).toEqual(["src/instrumentation.ts"]);
  });

  it("finds a hook the app has under any of its page extensions", async () => {
    const cwd = await app();
    await writeFile(
      path.join(cwd, "next.config.mjs"),
      'export default { pageExtensions: ["page.tsx", "page.ts"] };\n'
    );
    await mkdir(path.join(cwd, "src"), { recursive: true });
    await writeFile(
      path.join(cwd, "src/instrumentation.page.ts"),
      "export function register() {}\n"
    );

    const [offered] = (await generateInstrumentation(cwd, { srcDir: true }))
      .skipped;

    expect(offered.path).toBe("src/instrumentation.page.ts");
    expect(offered.toAdd).toMatch(/^Make register\(\) async/);
  });

  it("adds Nextly to the hook Next.js loads, not to a default-named one beside it", async () => {
    const cwd = await app();
    await writeFile(
      path.join(cwd, "next.config.mjs"),
      'export default { pageExtensions: ["page.tsx"] };\n'
    );
    await mkdir(path.join(cwd, "src"), { recursive: true });
    // With pageExtensions set, Next.js loads only `instrumentation.page.tsx`.
    await writeFile(
      path.join(cwd, "src/instrumentation.ts"),
      "export function register() {}\n"
    );
    await writeFile(
      path.join(cwd, "src/instrumentation.page.tsx"),
      "export function register() {}\n"
    );

    const [offered] = (await generateInstrumentation(cwd, { srcDir: true }))
      .skipped;

    expect(offered.path).toBe("src/instrumentation.page.tsx");
    expect(offered.toAdd).toMatch(/^Make register\(\) async/);
  });

  it.each([
    [["mdx", "page.js"], "src/instrumentation.page.js"],
    // The hook is an ES module, which a `.cjs` file cannot hold.
    [["cjs", "mjs"], "src/instrumentation.mjs"],
  ])(
    "never names a hook after an extension it cannot be written in (%j)",
    async (extensions, expected) => {
      const cwd = await app();
      await writeFile(
        path.join(cwd, "next.config.mjs"),
        `export default { pageExtensions: ${JSON.stringify(extensions)} };\n`
      );

      const [offered] = (await generateInstrumentation(cwd, { srcDir: true }))
        .skipped;

      expect(offered.path).toBe(expected);
    }
  );

  it.each([[["mdx", "md"]], [["cjs"]]])(
    "says to add an extension the hook can be written in when the list has none (%j)",
    async extensions => {
      const cwd = await app();
      await writeFile(
        path.join(cwd, "next.config.mjs"),
        `export default { pageExtensions: ${JSON.stringify(extensions)} };\n`
      );

      const [offered] = (await generateInstrumentation(cwd, { srcDir: true }))
        .skipped;

      // No configured name can load the hook, so none is offered as one.
      expect(offered.path).toBe(
        "src/instrumentation.<a JavaScript or TypeScript extension added to pageExtensions>"
      );
      expect(offered.why).toContain(
        `none of them (${extensions.join(", ")}) can hold the hook`
      );
      expect(offered.why).toContain(
        "add a JavaScript or TypeScript extension to pageExtensions"
      );
    }
  );

  it("names no file it cannot know when the pageExtensions list is not written out, and offers a hook valid as JavaScript too", async () => {
    const cwd = await app();
    await writeFile(
      path.join(cwd, "next.config.mjs"),
      "const extensions = ['page.js'];\nexport default { pageExtensions: extensions };\n"
    );

    const result = await generateInstrumentation(cwd, { srcDir: true });

    expect(result.written).toEqual([]);
    expect(result.skipped[0].path).toBe(
      "src/instrumentation.<one of your pageExtensions>"
    );
    // The extension may be a JavaScript one, so the content must parse as JS.
    const { diagnostics = [] } = ts.transpileModule(
      result.skipped[0].toAdd ?? "",
      {
        reportDiagnostics: true,
        fileName: "instrumentation.page.js",
        compilerOptions: { allowJs: true, module: ts.ModuleKind.ESNext },
      }
    );
    expect(diagnostics.map(d => d.messageText)).toEqual([]);
  });

  it.each([
    [
      "a getter",
      'export default { get pageExtensions() { return ["page.tsx"]; } };\n',
    ],
    [
      "a computed key",
      'const key = "pageExtensions";\nexport default { [key]: ["page.tsx"] };\n',
    ],
    [
      "a wrapper call",
      'const withPages = c => ({ ...c, pageExtensions: ["page.tsx"] });\nexport default withPages({});\n',
    ],
  ])(
    "writes no default hook when pageExtensions may come from %s",
    async (_, config) => {
      const cwd = await app();
      await writeFile(path.join(cwd, "next.config.mjs"), config);

      const result = await generateInstrumentation(cwd, { srcDir: true });

      expect(result.written).toEqual([]);
      expect(result.skipped[0].path).toBe(
        "src/instrumentation.<one of your pageExtensions>"
      );
    }
  );

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
