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
  warn: vi.fn(),
  cancel: vi.fn(),
}));
// Stands in for the scaffold: a project on the release the test's skills
// say they were checked against, so they are written.
const copyTemplate = vi.hoisted(() =>
  vi.fn(async (options: { targetDir: string }) => {
    const { mkdir, writeFile } = await import("node:fs/promises");
    await mkdir(options.targetDir, { recursive: true });
    await writeFile(
      `${options.targetDir}/package.json`,
      JSON.stringify({ dependencies: { nextly: "9.9.9-skills" } })
    );
  })
);

vi.mock("@clack/prompts", () => ({
  intro: vi.fn(),
  outro: vi.fn(),
  note: vi.fn(),
  cancel: prompts.cancel,
  isCancel: () => false,
  spinner: () => ({ start: vi.fn(), stop: vi.fn(), message: vi.fn() }),
  log: {
    success: vi.fn(),
    warn: prompts.warn,
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
vi.mock("../utils/template", async importOriginal => ({
  ...(await importOriginal<typeof import("../utils/template")>()),
  copyTemplate,
}));
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
vi.mock("../generators/env", () => ({ generateEnv: vi.fn(async () => {}) }));
// The existing-app steps write files the skills do not depend on.
vi.mock("../generators/existing-app", () => ({
  generateIntoExistingApp: vi.fn(async () => []),
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
import { packageVersion } from "../lib/package-version";

/** The release the test's bundle declares, apart from this CLI's own on purpose. */
const SKILLS_VERSION = "9.9.9-skills";
const SKILL_TEXT = `---\nname: nextly-install\nmetadata:\n  nextly-version: ${SKILLS_VERSION}\n---\nInstall Nextly.\n`;

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
    const said = prompts.info.mock.calls.map(([message]) => String(message));
    expect(said).toContain("Wrote .agents/skills/nextly-install");
    expect(said).toContain("Wrote .claude/skills/nextly-install");
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
      JSON.stringify({
        dependencies: { next: "16.0.0", nextly: SKILLS_VERSION },
      })
    );

    await createNextly({ cwd: app, defaults: true, skipInstall: true });

    expect(await skillsIn(app)).toEqual({
      ".agents/skills/nextly-install": SKILL_TEXT,
      ".claude/skills/nextly-install": "edited by the developer",
    });
    // The update command names this CLI's release tag, which publishes this
    // bundle, not the release the skills were checked against, whose tag
    // may carry no user skills at all.
    const kept = prompts.warn.mock.calls
      .map(([message]) => String(message))
      .find(message => message.includes(".claude/skills/nextly-install"));
    expect(kept).toContain(`nextlyhq/nextly#v${packageVersion()}'`);
    expect(kept).not.toContain(`#v${SKILLS_VERSION}`);
    // During a release the package can be installable before its tag is
    // pushed, so the message also names where to look then.
    expect(kept).toContain("nextlyhq.com/docs/guides/coding-agents");
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

  // A project on another release could be handed instructions for APIs it
  // does not have, so it gets none, and the run says why and where to look.
  it("adds none to a project on another Nextly release, and says why", async () => {
    const app = path.join(dir, "older");
    await mkdir(path.join(app, "node_modules/nextly"), { recursive: true });
    await writeFile(
      path.join(app, "package.json"),
      JSON.stringify({ dependencies: { next: "16.0.0", nextly: "latest" } })
    );
    await writeFile(
      path.join(app, "node_modules/nextly/package.json"),
      JSON.stringify({ name: "nextly", version: "0.0.1" })
    );

    await createNextly({ cwd: app, defaults: true, skipInstall: true });

    expect(await skillsIn(app)).toEqual({});
    const warned = prompts.warn.mock.calls.map(([message]) => String(message));
    expect(warned).toContainEqual(
      expect.stringMatching(
        new RegExp(
          `nextly 0\\.0\\.1.*written for ${SKILLS_VERSION.replace(/\./g, "\\.")}.*nextlyhq\\.com/docs/guides/coding-agents`
        )
      )
    );
  });

  // The skills name the release they were checked against; a bundle that does
  // not cannot say which projects they suit, so the run stops before writing.
  it("stops before anything is scaffolded when the skills name no release", async () => {
    await writeFile(
      path.join(state.bundle, "nextly-install/SKILL.md"),
      "---\nname: nextly-install\n---\nInstall Nextly.\n"
    );

    await expect(
      createNextly({
        cwd: dir,
        defaults: true,
        projectNameFromArg: "my-app",
        skipInstall: true,
      })
    ).rejects.toThrow("process.exit(1)");

    expect(copyTemplate).not.toHaveBeenCalled();
    expect(String(prompts.cancel.mock.calls[0]?.[0])).toMatch(
      /metadata\.nextly-version/
    );
  });
});
