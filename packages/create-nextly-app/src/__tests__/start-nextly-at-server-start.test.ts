/**
 * A scaffolded project starts Nextly when its server starts.
 *
 * Next.js runs `instrumentation.register()` once per server instance and
 * finishes it before the instance serves a request. A route that cannot start
 * Nextly on its own, such as `/api/health`, is only right on a fresh server if
 * the project's hook has already started it. So each template is scaffolded
 * for real and its own hook is run, against the recording stub of `nextly`:
 * a scan of the source would stay green with the call unreachable.
 *
 * The blog's code-first config imports a plugin and the template's
 * collections, which this suite does not stub; its hook file is the same one
 * the visual config uses, so the visual config covers it.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { DatabaseConfig } from "../types";
import { copyTemplate } from "../utils/template";

import { bootConfigs, recorded, resetRecord } from "./stubs/nextly";

const here = path.dirname(fileURLToPath(import.meta.url));
const templatesRoot = path.resolve(here, "../../../../templates");

const sqlite: DatabaseConfig = {
  type: "sqlite",
  adapter: "@nextlyhq/adapter-sqlite",
  databaseDriver: "better-sqlite3",
  connectionUrl: "file:./data/nextly.db",
  envExample: "file:./data/nextly.db",
};

let workdir: string | undefined;

afterEach(async () => {
  vi.unstubAllEnvs();
  resetRecord();
  if (workdir) await rm(workdir, { recursive: true, force: true });
  workdir = undefined;
});

/** A project of this template, scaffolded into a fresh directory. */
async function scaffold(
  projectType: "blank" | "blog",
  approach?: "visual"
): Promise<string> {
  workdir = await mkdtemp(path.join(tmpdir(), "nextly-register-"));
  const target = path.join(workdir, "project");
  await copyTemplate({
    projectName: "my-app",
    projectType,
    targetDir: target,
    database: sqlite,
    packageManager: "npm",
    approach,
    templateSource: {
      basePath: path.join(templatesRoot, "base"),
      templatePath: path.join(templatesRoot, projectType),
    },
  });
  return target;
}

/** The scaffolded project's own hook and config, as Next.js would load them. */
async function load(project: string): Promise<{
  register: () => Promise<void>;
  config: unknown;
}> {
  const hook = await import(
    pathToFileURL(path.join(project, "src/instrumentation.ts")).href
  );
  const config = await import(
    pathToFileURL(path.join(project, "nextly.config.ts")).href
  );
  return { register: hook.register, config: config.default };
}

describe.each([
  ["blank", undefined],
  ["blog", "visual"],
] as const)("the %s template's server-start hook", (template, approach) => {
  it("starts Nextly with the project's own config, under the Node.js runtime", async () => {
    const { register, config } = await load(await scaffold(template, approach));
    vi.stubEnv("NEXT_RUNTIME", "nodejs");

    await register();

    expect(recorded).toEqual(["revalidator", "boot"]);
    expect(bootConfigs).toHaveLength(1);
    expect(bootConfigs[0]).toBe(config);
  });

  it("does nothing under the Edge runtime, which cannot load Nextly", async () => {
    const { register } = await load(await scaffold(template, approach));
    vi.stubEnv("NEXT_RUNTIME", "edge");

    await register();

    expect(recorded).toEqual([]);
  });
});
