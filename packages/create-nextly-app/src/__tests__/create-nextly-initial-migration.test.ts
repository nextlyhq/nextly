/**
 * A code-first blog's build runs `nextly migrate`, which applies the files in
 * the folder its config reads. The template's hand-written SQL is the visual
 * blog's, so a code-first blog gets its first migration written from its own
 * config, by the installed `nextly migrate:create`, once the install and the
 * `.env` it reads the database from are in place. With `--skip-install` there
 * is no `nextly` to run, so the next steps name the command instead.
 *
 * The flow runs for real with the prompts, the template copy, the install and
 * the migration command replaced.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const prompts = vi.hoisted(() => ({
  note: vi.fn(),
  warn: vi.fn(),
  cancel: vi.fn(),
}));
const writeInitialMigration = vi.hoisted(() =>
  vi.fn(async (): Promise<string | undefined> => undefined)
);
const copyTemplate = vi.hoisted(() =>
  vi.fn(async (options: { targetDir: string }) => {
    const { mkdir, writeFile } = await import("node:fs/promises");
    await mkdir(options.targetDir, { recursive: true });
    await writeFile(`${options.targetDir}/package.json`, "{}");
  })
);

vi.mock("@clack/prompts", () => ({
  intro: vi.fn(),
  outro: vi.fn(),
  note: prompts.note,
  cancel: prompts.cancel,
  isCancel: () => false,
  spinner: () => ({ start: vi.fn(), stop: vi.fn(), message: vi.fn() }),
  log: {
    success: vi.fn(),
    warn: prompts.warn,
    info: vi.fn(),
    error: vi.fn(),
    message: vi.fn(),
    step: vi.fn(),
  },
  select: vi.fn(),
  text: vi.fn(),
  confirm: vi.fn(async () => false),
}));
vi.mock("@nextlyhq/telemetry", () => ({
  capture: vi.fn(),
  classifyError: () => "unknown",
}));
vi.mock("../utils/template", async importOriginal => ({
  ...(await importOriginal<typeof import("../utils/template")>()),
  copyTemplate,
}));
vi.mock("../installers/dependencies", async importOriginal => ({
  ...(await importOriginal<typeof import("../installers/dependencies")>()),
  installDependencies: vi.fn(async () => []),
}));
vi.mock("../installers/initial-migration", async importOriginal => ({
  ...(await importOriginal<typeof import("../installers/initial-migration")>()),
  writeInitialMigration,
}));
vi.mock("../utils/detect", async importOriginal => ({
  ...(await importOriginal<typeof import("../utils/detect")>()),
  detectProject: vi.fn(async () => ({
    isNextJs: true,
    isAppRouter: true,
    hasTypescript: true,
    packageManager: "pnpm",
    nextVersion: "16.0.0",
    srcDir: true,
    appDir: "src/app",
  })),
}));
vi.mock("../generators/env", () => ({ generateEnv: vi.fn(async () => {}) }));

import { createNextly } from "../create-nextly";

const TEMPLATES = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../templates"
);

let dir: string;

beforeEach(async () => {
  vi.clearAllMocks();
  vi.spyOn(process, "exit").mockImplementation(code => {
    throw new Error(`process.exit(${String(code)})`);
  });
  dir = await mkdtemp(path.join(tmpdir(), "nextly-initial-migration-"));
});
afterEach(async () => {
  vi.restoreAllMocks();
  await rm(dir, { recursive: true, force: true });
});

/** What the next-steps note says. */
function nextSteps(): string {
  const call = prompts.note.mock.calls.find(
    ([, title]) => title === "Next steps"
  );
  return String(call?.[0] ?? "");
}

async function scaffold(
  options: Partial<Parameters<typeof createNextly>[0]>
): Promise<void> {
  await createNextly({
    cwd: dir,
    projectType: "blog",
    database: "sqlite",
    projectNameFromArg: "my-blog",
    skills: false,
    localTemplatePath: TEMPLATES,
    ...options,
  });
}

describe("a code-first blog's first migration", () => {
  it("is written from its config once it is installed", async () => {
    await scaffold({ approach: "code-first" });

    expect(writeInitialMigration).toHaveBeenCalledTimes(1);
    expect(writeInitialMigration).toHaveBeenCalledWith(
      path.join(dir, "my-blog"),
      "pnpm"
    );
  });

  it("is named as the next step when nothing was installed", async () => {
    await scaffold({ approach: "code-first", skipInstall: true });

    expect(writeInitialMigration).not.toHaveBeenCalled();
    expect(nextSteps()).toContain("pnpm exec nextly migrate:create initial");
  });

  it("is named, without stopping the run, when the command fails", async () => {
    writeInitialMigration.mockResolvedValueOnce("the config did not load");
    await scaffold({ approach: "code-first" });

    const warned = prompts.warn.mock.calls.map(([m]) => String(m)).join("\n");
    expect(warned).toContain("the config did not load");
    expect(warned).toContain("pnpm exec nextly migrate:create initial");
    expect(process.exit).not.toHaveBeenCalled();
  });

  // A visual blog's build applies the template's own migration, which the
  // scaffold copies; a blank project declares nothing to migrate.
  it("is not written for a visual blog or a blank project", async () => {
    await scaffold({ approach: "visual" });
    await createNextly({
      cwd: dir,
      projectType: "blank",
      database: "sqlite",
      projectNameFromArg: "my-app",
      skills: false,
      localTemplatePath: TEMPLATES,
    });

    expect(writeInitialMigration).not.toHaveBeenCalled();
    expect(nextSteps()).not.toContain("migrate:create");
  });
});
