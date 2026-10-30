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

import { spawnSync } from "node:child_process";

import fs from "fs-extra";
import { afterEach, describe, expect, it } from "vitest";

import { compile } from "../../../../scripts/tsc-cli.mjs";

import { generateInstrumentation } from "../generators/instrumentation";

const here = path.dirname(fileURLToPath(import.meta.url));
const blankHook = path.resolve(
  here,
  "../../../../templates/blank/src/instrumentation.ts"
);

/** A Next.js release that runs the hook without opting in. */
const NEXT = "16.0.0";

/**
 * The type errors a hook body has, checked as a program rather than only
 * transpiled, so an `await` outside an async function, a name never declared
 * or a call with the wrong arguments all show. Nextly's own modules are
 * declared by the shape the body uses them in: this package does not depend
 * on nextly, and the real API is compiled against the same body by the
 * scaffold jobs, which build the blank template whose hook shares it.
 *
 * Checked by the compiler's command line, which answers the same on every
 * TypeScript version, with the options in a config written beside the files.
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
        'declare module "nextly" { export function createRegister(config: unknown, host?: { cacheComponents?: string | boolean }): () => Promise<void>; }',
        "declare const process: { env: Record<string, string | undefined> };",
      ].join("\n")
    );
    await writeFile(
      path.join(root, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          strict: true,
          target: "es2022",
          module: "esnext",
          moduleResolution: "bundler",
          types: [],
          skipLibCheck: true,
        },
        files: [hook, declarations],
      })
    );
    return compile(["-p", "tsconfig.json"], root).map(d => d.message);
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
/**
 * Why a module would not parse as JavaScript, as Node itself reports it
 * (`node --check` on an ES module copy), or nothing when it parses. TypeScript
 * syntax in a hook offered under a JavaScript extension fails here.
 */
async function javaScriptSyntaxErrors(source: string): Promise<string[]> {
  const root = await mkdtemp(path.join(tmpdir(), "hook-js-"));
  try {
    const file = path.join(root, "instrumentation.mjs");
    await writeFile(file, source);
    const result = spawnSync(process.execPath, ["--check", file], {
      encoding: "utf8",
    });
    return result.status === 0 ? [] : [result.stderr];
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

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
        "await createRegister(config, {"
      );
      // The setting Next.js inlines here, which Nextly cannot read for itself.
      expect(result.skipped[0].toAdd).toContain(
        "cacheComponents: process.env.__NEXT_CACHE_COMPONENTS"
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
    expect(await javaScriptSyntaxErrors(offered.toAdd ?? "")).toEqual([]);
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
    expect(await javaScriptSyntaxErrors(result.skipped[0].toAdd ?? "")).toEqual(
      []
    );
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
    ["a Next.js version that cannot be read", null],
    ["Next.js 16.4", "16.4.2"],
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
});
