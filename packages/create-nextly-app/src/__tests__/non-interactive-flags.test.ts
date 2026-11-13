/**
 * create-nextly-app with no terminal: every answer comes from a flag, and a
 * run that lacks one stops before writing anything, naming the flags. The
 * real program runs in-process against a temporary folder, with fake package
 * managers on PATH (see scaffold-harness).
 */
import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { scriptRunner } from "../utils/package-manager-commands";

import { ui } from "./clack-recorder";
import {
  type FakeRun,
  HERMETIC,
  LOCKFILES,
  type Manager,
  USER_AGENTS,
  captureConsole,
  installFakeManagers,
  makeWorkdir,
  printed,
  runCli,
} from "./scaffold-harness";

vi.mock("@clack/prompts", async () =>
  (await import("./clack-recorder")).clack()
);
vi.mock("@nextlyhq/telemetry", async () =>
  (await import("./clack-recorder")).telemetry()
);

let dir: string;
let fakes: FakeRun;

beforeEach(async () => {
  ui.reset();
  captureConsole();
  dir = await makeWorkdir("nextly-noninteractive-");
  fakes = await installFakeManagers(dir);
});
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await rm(dir, { recursive: true, force: true });
});

const allOutput = () => [...ui.out, ...printed].join("\n");

describe("create-nextly-app without a terminal", () => {
  it("stdin closed and no flags: nothing written, the flag named", async () => {
    vi.stubEnv("npm_config_user_agent", USER_AGENTS.pnpm);
    const work = path.join(dir, "work");
    await mkdir(work);

    const code = await runCli([], { cwd: work });

    expect(code).toBe(1);
    expect(ui.asked).toEqual([]);
    expect(await readdir(work)).toEqual([]);
    expect(await fakes.calls()).toEqual([]);
    const said = allOutput();
    expect(said).toContain("no terminal");
    for (const flag of [
      "a project folder",
      "--template",
      "--approach",
      "--database <",
      "--database-url",
      "--no-skills",
    ]) {
      expect(said).toContain(flag);
    }
  });

  it("names only what is missing: the connection string for postgresql", async () => {
    const work = path.join(dir, "work");
    await mkdir(work);

    const code = await runCli(
      ["my-app", "-t", "blank", "-d", "postgresql", "--no-skills"],
      { cwd: work }
    );

    expect(code).toBe(1);
    expect(await readdir(work)).toEqual([]);
    const said = allOutput();
    expect(said).toContain("--database-url");
    expect(said).not.toContain("--template <");
    expect(said).not.toContain("--database <");
  });

  it("a folder that already holds files is refused, even with --yes", async () => {
    const work = path.join(dir, "work");
    await mkdir(path.join(work, "my-app"), { recursive: true });
    await writeFile(path.join(work, "my-app", "notes.txt"), "mine");

    const code = await runCli(["my-app", "--yes", ...HERMETIC], { cwd: work });

    expect(code).toBe(1);
    expect(ui.asked).toEqual([]);
    expect(await readdir(path.join(work, "my-app"))).toEqual(["notes.txt"]);
    expect(allOutput()).toContain('"my-app" already holds files');
  });

  for (const manager of ["npm", "pnpm", "yarn", "bun"] as Manager[]) {
    it(`stdin closed and every flag given (${manager}): no prompt, installed with ${manager}, its lockfile only`, async () => {
      // Launched through another manager, so the flag is what decides.
      vi.stubEnv(
        "npm_config_user_agent",
        manager === "npm" ? USER_AGENTS.pnpm : USER_AGENTS.npm
      );
      const work = path.join(dir, "work");
      await mkdir(work);

      const code = await runCli(
        [
          "my-app",
          "-t",
          "blank",
          "-d",
          "postgresql",
          "--database-url",
          "postgresql://localhost:5432/app",
          "--package-manager",
          manager,
          "--no-git",
          "--yes",
          ...HERMETIC,
        ],
        { cwd: work }
      );

      expect(allOutput()).not.toContain("unexpected prompt");
      expect(code).toBe(0);
      expect(ui.asked).toEqual([]);
      const project = path.join(work, "my-app");
      const installs = (await fakes.calls()).filter(
        call => call.args[0] === "install" && call.cwd === project
      );
      expect(installs.map(call => call.manager)).toEqual([manager]);
      const files = await readdir(project);
      const lockfiles = Object.values(LOCKFILES).filter(file =>
        files.includes(file)
      );
      expect(lockfiles).toEqual([LOCKFILES[manager]]);
      // Every command it prints names that manager too.
      expect(allOutput()).toContain(`${scriptRunner(manager)} dev`);
    });
  }

  it("an app installed with pnpm is refused --package-manager npm, untouched", async () => {
    const app = path.join(dir, "app");
    await mkdir(path.join(app, "src", "app"), { recursive: true });
    const manifest = JSON.stringify({
      name: "app",
      dependencies: { next: "16.0.0", react: "19.2.0", "react-dom": "19.2.0" },
    });
    await writeFile(path.join(app, "package.json"), manifest);
    await writeFile(
      path.join(app, "pnpm-lock.yaml"),
      "lockfileVersion: '9.0'\n"
    );
    await writeFile(path.join(app, "next.config.ts"), "export default {};\n");
    const before = (await readdir(app)).sort();

    const code = await runCli(
      [".", "--package-manager", "npm", "--yes", ...HERMETIC],
      { cwd: app }
    );

    expect(code).toBe(1);
    expect((await readdir(app)).sort()).toEqual(before);
    expect(await fakes.calls()).toEqual([]);
    expect(allOutput()).toContain("set up for pnpm");
    expect(allOutput()).toContain("--package-manager pnpm");
  });

  it("a stale lockfile beside another declared manager is refused either flag, untouched", async () => {
    const app = path.join(dir, "app");
    await mkdir(path.join(app, "src", "app"), { recursive: true });
    const manifest = JSON.stringify({
      name: "app",
      packageManager: "yarn@4.9.2",
      dependencies: { next: "16.0.0", react: "19.2.0", "react-dom": "19.2.0" },
    });
    await writeFile(path.join(app, "package.json"), manifest);
    await writeFile(
      path.join(app, "pnpm-lock.yaml"),
      "lockfileVersion: '9.0'\n"
    );
    await writeFile(path.join(app, "next.config.ts"), "export default {};\n");
    const before = (await readdir(app)).sort();

    const code = await runCli(
      [".", "--package-manager", "pnpm", "--yes", ...HERMETIC],
      { cwd: app }
    );

    expect(code).toBe(1);
    expect((await readdir(app)).sort()).toEqual(before);
    expect(await fakes.calls()).toEqual([]);
    expect(allOutput()).toContain(
      "pnpm (its lockfile) and yarn (its package.json)"
    );
  });

  it("an app whose package.json declares pnpm is refused --package-manager yarn, untouched", async () => {
    const app = path.join(dir, "app");
    await mkdir(path.join(app, "src", "app"), { recursive: true });
    const manifest = JSON.stringify({
      name: "app",
      packageManager: "pnpm@10.18.0",
      dependencies: { next: "16.0.0", react: "19.2.0", "react-dom": "19.2.0" },
    });
    await writeFile(path.join(app, "package.json"), manifest);
    await writeFile(path.join(app, "next.config.ts"), "export default {};\n");

    const code = await runCli(
      [".", "--package-manager", "yarn", "--yes", ...HERMETIC],
      { cwd: app }
    );

    expect(code).toBe(1);
    expect(await fakes.calls()).toEqual([]);
    expect(allOutput()).toContain("set up for pnpm");
  });
});
