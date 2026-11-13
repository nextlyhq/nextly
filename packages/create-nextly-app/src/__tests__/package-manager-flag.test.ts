/**
 * `--package-manager` decides both the install and the pin: the project's
 * `packageManager` field names the selected manager at the version that ran
 * the install, whichever manager launched the scaffold; npm and Bun get no
 * field. Fake managers on PATH report fixed versions (see scaffold-harness).
 */
import { execFileSync } from "node:child_process";
import { mkdir, readFile, readdir, rm } from "node:fs/promises";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ui } from "./clack-recorder";
import {
  FAKE_VERSIONS,
  type FakeRun,
  HERMETIC,
  LOCKFILES,
  type Manager,
  USER_AGENTS,
  captureConsole,
  installFakeManagers,
  makeWorkdir,
  runCli,
} from "./scaffold-harness";

vi.mock("@clack/prompts", async () =>
  (await import("./clack-recorder")).clack()
);
vi.mock("@nextlyhq/telemetry", async () =>
  (await import("./clack-recorder")).telemetry()
);

let dir: string;
let work: string;
let fakes: FakeRun;

beforeEach(async () => {
  ui.reset();
  captureConsole();
  dir = await makeWorkdir("nextly-pm-flag-");
  work = path.join(dir, "work");
  await mkdir(work);
  fakes = await installFakeManagers(dir);
});
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await rm(dir, { recursive: true, force: true });
});

async function scaffold(launcher: Manager, selected: Manager) {
  vi.stubEnv("npm_config_user_agent", USER_AGENTS[launcher]);
  const code = await runCli(
    ["my-app", "--yes", "--package-manager", selected, ...HERMETIC],
    { cwd: work }
  );
  const project = path.join(work, "my-app");
  const manifest = JSON.parse(
    await readFile(path.join(project, "package.json"), "utf-8")
  ) as { packageManager?: string };
  const files = await readdir(project);
  return {
    code,
    project,
    field: manifest.packageManager,
    lockfiles: Object.values(LOCKFILES).filter(file => files.includes(file)),
    installers: (await fakes.calls())
      .filter(call => call.args[0] === "install")
      .map(call => call.manager),
  };
}

/**
 * Whether Corepack can run `spec` here without the network: it needs that
 * exact version in its cache. Checked so the second-install test runs where
 * it can and says why where it cannot, rather than downloading in a unit run.
 */
function corepackRuns(spec: string, cwd: string): string | undefined {
  try {
    return execFileSync("corepack", [spec, "--version"], {
      cwd,
      encoding: "utf-8",
      env: { ...process.env, COREPACK_ENABLE_NETWORK: "0" },
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return undefined;
  }
}

describe("--package-manager decides the install and the pin", () => {
  it("launched through pnpm with --package-manager yarn: yarn at its version, yarn.lock only", async () => {
    const run = await scaffold("pnpm", "yarn");

    expect(run.code).toBe(0);
    expect(run.field).toBe(`yarn@${FAKE_VERSIONS.yarn}`);
    expect(run.lockfiles).toEqual([LOCKFILES.yarn]);
    expect(run.installers).toEqual(["yarn"]);
  });

  it("launched through Yarn with --package-manager pnpm: pnpm at its version, its lockfile only", async () => {
    const run = await scaffold("yarn", "pnpm");

    expect(run.code).toBe(0);
    expect(run.field).toBe(`pnpm@${FAKE_VERSIONS.pnpm}`);
    expect(run.lockfiles).toEqual([LOCKFILES.pnpm]);
    expect(run.installers).toEqual(["pnpm"]);
  });

  it("launched through pnpm with --package-manager npm: no field, npm's lockfile only", async () => {
    const run = await scaffold("pnpm", "npm");

    expect(run.code).toBe(0);
    expect(run.field).toBeUndefined();
    expect(run.lockfiles).toEqual([LOCKFILES.npm]);
    expect(run.installers).toEqual(["npm"]);
  });

  it("a second install through Corepack accepts the pinned field", async ({
    skip,
  }) => {
    const run = await scaffold("pnpm", "yarn");
    expect(run.field).toBe(`yarn@${FAKE_VERSIONS.yarn}`);
    // The fakes are first on PATH; Corepack is asked directly.
    vi.unstubAllEnvs();
    const ran = corepackRuns(run.field as string, run.project);
    if (ran === undefined) {
      skip(`Corepack cannot run ${run.field} offline here (not in its cache)`);
    }
    expect(ran).toBe(FAKE_VERSIONS.yarn);
  });
});
