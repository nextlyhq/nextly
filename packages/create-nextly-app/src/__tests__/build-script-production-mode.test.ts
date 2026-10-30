/**
 * A scaffold's build script runs in production: `next build` evaluates the
 * config with `NODE_ENV=production` and reads the production environment
 * files, so each CLI step before it runs with `--mode production` and migrates
 * the schema, and installs the plugins, of the app that is about to be built.
 *
 * Every other step the script has stays: `next build`, and the search-index
 * step last where the template ships its builder. And the script is run, not
 * only read, under the shell `npm run` uses: `cmd.exe` on Windows, `sh`
 * elsewhere, with each command replaced by a stub that records its arguments.
 */
import { execSync } from "node:child_process";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  importedPlugins,
  relative,
  removeScaffolds,
  scaffoldBuild,
  SEARCH_INDEX_SCRIPT,
  templateConfigs,
  TEMPLATES,
} from "./helpers/scaffolded-build";

afterEach(removeScaffolds);

const PRODUCTION = "--mode production";
const SEARCH_INDEX_STEP = `node ${SEARCH_INDEX_SCRIPT}`;

/** The blog's code-first config, which registers the form builder. */
const blogCodeFirst = () =>
  readFile(path.join(TEMPLATES, "blog/configs/codefirst.config.ts"), "utf8");

describe("a scaffold's build script", () => {
  it("runs every CLI step of every template config with --mode production, each plugin's install included", async () => {
    const configs = await templateConfigs();
    expect(configs.length).toBeGreaterThan(1);

    for (const { template, file } of configs) {
      const text = await readFile(file, "utf8");
      const steps = (await scaffoldBuild(template, text)).script.split(" && ");
      expect(
        steps.filter(step => step.startsWith("nextly ")),
        relative(file)
      ).toEqual([
        `nextly migrate ${PRODUCTION}`,
        ...importedPlugins(text).map(
          pkg => `nextly plugins install ${pkg} ${PRODUCTION}`
        ),
      ]);
      expect(steps, relative(file)).toContain("next build");
    }
  });

  it("keeps the blog's search-index step, unchanged and last", async () => {
    const { script } = await scaffoldBuild("blog", await blogCodeFirst());
    expect(script).toBe(
      [
        `nextly migrate ${PRODUCTION}`,
        `nextly plugins install @nextlyhq/plugin-form-builder ${PRODUCTION}`,
        "next build",
        SEARCH_INDEX_STEP,
      ].join(" && ")
    );
  });

  it("has no search-index step for a template that does not ship the builder", async () => {
    const blank = await readFile(
      path.join(TEMPLATES, "blank/nextly.config.ts"),
      "utf8"
    );
    expect((await scaffoldBuild("blank", blank)).script).toBe(
      `nextly migrate ${PRODUCTION} && next build`
    );
  });
});

const onWindows = process.platform === "win32";

/**
 * Runs the blog's generated build script in its project under `shell`, with
 * `nextly` and `next` as stubs on the PATH and the project's search-index
 * builder replaced by one, each recording the command it was run as. With
 * `failMigrate`, the `nextly` stub fails, and nothing after it may run.
 */
async function runBuild(
  shell: string,
  failMigrate = false
): Promise<{ steps: string[]; failed: boolean }> {
  const { dir, script } = await scaffoldBuild("blog", await blogCodeFirst());
  const bin = path.join(dir, "stub-bin");
  mkdirSync(bin);
  const log = path.join(dir, "steps.log");
  for (const name of ["nextly", "next"]) {
    if (onWindows) {
      writeFileSync(
        path.join(bin, `${name}.cmd`),
        `@echo ${name} %*>>"%STEP_LOG%"\r\n@if defined STEP_FAIL if "${name}"=="nextly" exit /b 1\r\n`
      );
    } else {
      const stub = path.join(bin, name);
      writeFileSync(
        stub,
        `#!/bin/sh\necho "${name} $*" >> "$STEP_LOG"\nif [ -n "$STEP_FAIL" ] && [ "${name}" = nextly ]; then exit 1; fi\n`
      );
      chmodSync(stub, 0o755);
    }
  }
  writeFileSync(
    path.join(dir, SEARCH_INDEX_SCRIPT),
    `import { appendFileSync } from "node:fs";\nappendFileSync(process.env.STEP_LOG, ${JSON.stringify(`${SEARCH_INDEX_STEP}\n`)});\n`
  );
  writeFileSync(log, "");

  const env: NodeJS.ProcessEnv = { ...process.env, STEP_LOG: log };
  // Windows spells the variable `Path`, and a second spelling beside it is
  // not the one the shell reads.
  const pathKey =
    Object.keys(env).find(key => key.toUpperCase() === "PATH") ?? "PATH";
  env[pathKey] = `${bin}${path.delimiter}${env[pathKey] ?? ""}`;
  if (failMigrate) env.STEP_FAIL = "1";
  else delete env.STEP_FAIL;

  let failed = false;
  try {
    // Node runs `cmd.exe /d /s /c "<script>"` for this shell, as npm does.
    execSync(script, { cwd: dir, env, shell, stdio: "ignore" });
  } catch {
    failed = true;
  }
  const steps = readFileSync(log, "utf8")
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);
  return { steps, failed };
}

const everyStep = [
  `nextly migrate ${PRODUCTION}`,
  `nextly plugins install @nextlyhq/plugin-form-builder ${PRODUCTION}`,
  "next build",
  SEARCH_INDEX_STEP,
];

describe("the generated build script, run by the shell npm uses", () => {
  it.runIf(onWindows)(
    "runs every step in order under cmd.exe, and stops at the first that fails",
    async () => {
      expect(await runBuild("cmd.exe")).toEqual({
        steps: everyStep,
        failed: false,
      });
      expect(await runBuild("cmd.exe", true)).toEqual({
        steps: [everyStep[0]],
        failed: true,
      });
    },
    30_000
  );

  it.skipIf(onWindows)(
    "runs every step in order under sh, and stops at the first that fails",
    async () => {
      expect(await runBuild("/bin/sh")).toEqual({
        steps: everyStep,
        failed: false,
      });
      expect(await runBuild("/bin/sh", true)).toEqual({
        steps: [everyStep[0]],
        failed: true,
      });
    },
    30_000
  );
});
