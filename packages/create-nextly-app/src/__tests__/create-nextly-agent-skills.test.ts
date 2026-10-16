/**
 * Whether createNextly adds the skills for coding agents, where, and when it
 * asks. The flow runs for real with the prompts, the template copy and the
 * install replaced; the skills are read from a bundle folder the test writes
 * and land in a real project folder, so what a developer would find is what
 * is asserted.
 */
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ bundle: "" }));
const prompts = vi.hoisted(() => ({
  confirm: vi.fn(),
  info: vi.fn(),
  cancel: vi.fn(),
}));
const copyTemplate = vi.hoisted(() => vi.fn(async () => {}));

vi.mock("@clack/prompts", () => ({
  intro: vi.fn(),
  outro: vi.fn(),
  note: vi.fn(),
  cancel: prompts.cancel,
  isCancel: () => false,
  spinner: () => ({ start: vi.fn(), stop: vi.fn(), message: vi.fn() }),
  log: {
    success: vi.fn(),
    warn: vi.fn(),
    info: prompts.info,
    error: vi.fn(),
    message: vi.fn(),
    step: vi.fn(),
  },
  select: vi.fn(),
  text: vi.fn(),
  confirm: prompts.confirm,
}));
vi.mock("@nextlyhq/telemetry", () => ({
  capture: vi.fn(),
  classifyError: () => "unknown",
}));
vi.mock("../utils/template", () => ({ copyTemplate }));
vi.mock("../installers/dependencies", () => ({
  installDependencies: vi.fn(async () => []),
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
// The existing-app generators write files the skills do not depend on.
vi.mock("../generators/env", () => ({ generateEnv: vi.fn(async () => {}) }));
vi.mock("../generators/config", () => ({ generateConfig: vi.fn() }));
vi.mock("../generators/routes", () => ({ generateRoutes: vi.fn() }));
vi.mock("../generators/admin", () => ({ generateAdminPage: vi.fn() }));
vi.mock("../generators/media-routes", () => ({
  generateMediaRoutes: vi.fn(),
}));
vi.mock("../generators/types", () => ({ generateTypesDirectory: vi.fn() }));
vi.mock("../generators/instrumentation", () => ({
  generateInstrumentation: vi.fn(async () => ({
    written: [],
    changed: [],
    skipped: [],
  })),
}));
vi.mock("../generators/next-config", () => ({
  patchNextConfig: vi.fn(async () => null),
  nextConfigReport: vi.fn(() => []),
}));
// The real reader, pointed at the test's bundle in place of the CLI's.
vi.mock("../generators/agent-skills", async importOriginal => {
  const actual =
    await importOriginal<typeof import("../generators/agent-skills")>();
  return {
    ...actual,
    readBundledSkills: vi.fn(() => actual.readBundledSkills(state.bundle)),
  };
});

import { createNextly } from "../create-nextly";

const SKILL_TEXT = "---\nname: nextly-install\n---\nInstall Nextly.\n";

let dir: string;

beforeEach(async () => {
  vi.clearAllMocks();
  vi.spyOn(process, "exit").mockImplementation(code => {
    throw new Error(`process.exit(${String(code)})`);
  });
  dir = await mkdtemp(path.join(tmpdir(), "nextly-create-skills-"));
  state.bundle = path.join(dir, "bundle");
  await mkdir(path.join(state.bundle, "nextly-install"), { recursive: true });
  await writeFile(
    path.join(state.bundle, "nextly-install/SKILL.md"),
    SKILL_TEXT
  );
});
afterEach(async () => {
  vi.restoreAllMocks();
  await rm(dir, { recursive: true, force: true });
});

const skillsAsked = () =>
  prompts.confirm.mock.calls.filter(([options]) =>
    String((options as { message: string }).message).includes("skills")
  ).length;

/** The skills under each home of `project`, with their SKILL.md text. */
async function skillsIn(project: string) {
  const found: Record<string, string> = {};
  for (const home of [".agents/skills", ".claude/skills"]) {
    const names = await readdir(path.join(project, home)).catch(() => []);
    for (const name of names) {
      found[`${home}/${name}`] = await readFile(
        path.join(project, home, name, "SKILL.md"),
        "utf8"
      );
    }
  }
  return found;
}

const both = {
  ".agents/skills/nextly-install": SKILL_TEXT,
  ".claude/skills/nextly-install": SKILL_TEXT,
};

describe("createNextly and the skills for coding agents", () => {
  it("adds them to a new app without asking under defaults, and says so", async () => {
    await createNextly({
      cwd: dir,
      defaults: true,
      projectNameFromArg: "my-app",
      skipInstall: true,
    });

    expect(skillsAsked()).toBe(0);
    expect(await skillsIn(path.join(dir, "my-app"))).toEqual(both);
    expect(prompts.info).toHaveBeenCalledWith(
      "Added skills for coding agents to .agents/skills and .claude/skills: nextly-install"
    );
  });

  it("asks, and adds nothing when the answer is no", async () => {
    prompts.confirm.mockResolvedValue(false);

    await createNextly({
      cwd: dir,
      projectType: "blank",
      database: "sqlite",
      projectNameFromArg: "my-app",
      skipInstall: true,
    });

    expect(skillsAsked()).toBe(1);
    expect(await skillsIn(path.join(dir, "my-app"))).toEqual({});
  });

  it("adds them when the answer is yes", async () => {
    prompts.confirm.mockResolvedValue(true);

    await createNextly({
      cwd: dir,
      projectType: "blank",
      database: "sqlite",
      projectNameFromArg: "my-app",
      skipInstall: true,
    });

    expect(skillsAsked()).toBe(1);
    expect(await skillsIn(path.join(dir, "my-app"))).toEqual(both);
  });

  it("neither asks nor adds them with --no-skills", async () => {
    await createNextly({
      cwd: dir,
      projectType: "blank",
      database: "sqlite",
      projectNameFromArg: "my-app",
      skipInstall: true,
      skills: false,
    });

    expect(skillsAsked()).toBe(0);
    expect(await skillsIn(path.join(dir, "my-app"))).toEqual({});
  });

  it("gives a plugin none, without asking", async () => {
    await createNextly({
      cwd: dir,
      projectType: "plugin",
      projectNameFromArg: "my-plugin",
      skipInstall: true,
    });

    expect(skillsAsked()).toBe(0);
    expect(await skillsIn(path.join(dir, "my-plugin"))).toEqual({});
  });

  it("adds them to an existing app, keeping a skill it already has", async () => {
    const app = path.join(dir, "existing");
    await mkdir(path.join(app, ".claude/skills/nextly-install"), {
      recursive: true,
    });
    await writeFile(
      path.join(app, ".claude/skills/nextly-install/SKILL.md"),
      "edited by the developer"
    );
    await writeFile(
      path.join(app, "package.json"),
      JSON.stringify({ dependencies: { next: "16.0.0" } })
    );

    await createNextly({ cwd: app, defaults: true, skipInstall: true });

    expect(await skillsIn(app)).toEqual({
      ".agents/skills/nextly-install": SKILL_TEXT,
      ".claude/skills/nextly-install": "edited by the developer",
    });
  });

  it("stops before anything is scaffolded when the bundle is broken", async () => {
    await rm(path.join(state.bundle, "nextly-install/SKILL.md"));

    await expect(
      createNextly({
        cwd: dir,
        defaults: true,
        projectNameFromArg: "my-app",
        skipInstall: true,
      })
    ).rejects.toThrow("process.exit(1)");

    expect(copyTemplate).not.toHaveBeenCalled();
    expect(String(prompts.cancel.mock.calls[0]?.[0])).toMatch(/--no-skills/);
  });
});
