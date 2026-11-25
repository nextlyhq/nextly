/**
 * Stopping `nextly upgrade` or `nextly add` stops the package manager it
 * started.
 *
 * Real processes: the command's own code, bundled and run in a process of its
 * own, with a stand-in `npm` first on its PATH. The stand-in starts a child,
 * as a package manager starts scripts and downloads, and writes both process
 * ids down, so what is asked afterwards is whether those two are running.
 *
 * What would separate a command that stops its manager from one that does not:
 * - the manager, or what it started, still running once the command has ended;
 * - one phase of an upgrade stopped and another not;
 * - a signal other than Ctrl+C's not answered;
 * - a manager that ignores the request waited for without end, or left;
 * - package.json or the lockfile left as the stopped run had them, also where
 *   the terminal the command would say so on is gone;
 * - one Ctrl+C taken for two, as npx passes on what the terminal sent already;
 * - a manager that ends at once waited for all the same.
 *
 * POSIX only: Windows has no process groups and no such signals.
 */
import { spawn, type ChildProcess } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";

const CLI = fileURLToPath(new URL("../../", import.meta.url));

const MANIFEST = '{ "name": "x", "dependencies": { "nextly": "1.0.0" } }\n';
const LOCKFILE = '{ "lockfileVersion": 3 }\n';

/**
 * The stand-in `npm`. It hangs in the run `$HANG` names, and answers or fails
 * the others: `view` (the registry is asked), `install` (the first install) or
 * `restore` (the second, after the first failed). With `$IGNORE` it and its
 * child take no notice of being asked to end.
 */
const STAND_IN = `#!/bin/sh
hang() {
  if [ "$IGNORE" = 1 ]; then trap '' TERM INT HUP; fi
  sleep 120 &
  echo "$$ $!" >> "$PIDS"
  wait
  # A shell that traps a signal ends its wait on one; this one goes on.
  while [ "$IGNORE" = 1 ]; do sleep 1; done
  exit 1
}
if [ "$1" = view ]; then
  if [ "$HANG" = view ]; then hang; fi
  echo '{"dist-tags":{"latest":"9.9.9"},"versions":["1.0.0","9.9.9"]}'
  exit 0
fi
runs=$(cat "$COUNT" 2>/dev/null || echo 0); runs=$((runs+1)); echo $runs > "$COUNT"
if [ "$HANG" = install ]; then echo changed > package-lock.json; hang; fi
if [ "$HANG" = restore ] && [ $runs -ge 2 ]; then echo changed > package-lock.json; hang; fi
exit 1
`;

/** What each command's process runs: the command's own code, without the program around it. */
const ENTRIES = {
  upgrade: `
    import { upgradePackages } from "./commands/upgrade-packages/upgrade-packages";
    import { exitWithError } from "./errors";
    try {
      await upgradePackages({ projectDir: process.argv[2], version: "9.9.9", dryRun: false, log: () => {}, report: () => {} });
    } catch (error) { exitWithError({ error: line => console.error(line) }, error); }`,
  add: `
    import { runInstall } from "./commands/plugins-add/run-install";
    process.exit(await runInstall("npm", ["install", "@x/plugin"], process.argv[2]));`,
} as const;

let bundles: string;
let folder: string;
const started: ChildProcess[] = [];

beforeAll(async () => {
  bundles = mkdtempSync(join(tmpdir(), "nextly-stopped-bundles-"));
  for (const [name, contents] of Object.entries(ENTRIES)) {
    await build({
      stdin: { contents, resolveDir: CLI, loader: "ts" },
      bundle: true,
      platform: "node",
      format: "esm",
      outfile: join(bundles, `${name}.mjs`),
      banner: {
        js: 'import { createRequire as __require } from "node:module"; const require = __require(import.meta.url);',
      },
      logLevel: "silent",
    });
  }
}, 60_000);
afterAll(() => {
  rmSync(bundles, { recursive: true, force: true });
});

beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), "nextly-stopped-"));
  mkdirSync(join(folder, "bin"));
  writeFileSync(join(folder, "bin", "npm"), STAND_IN);
  chmodSync(join(folder, "bin", "npm"), 0o755);
  const project = join(folder, "project");
  mkdirSync(join(project, "node_modules", "nextly"), { recursive: true });
  // Where the search for a workspace's own lockfile stops.
  mkdirSync(join(project, ".git"));
  writeFileSync(join(project, "package.json"), MANIFEST);
  writeFileSync(join(project, "package-lock.json"), LOCKFILE);
  writeFileSync(
    join(project, "node_modules", "nextly", "package.json"),
    '{ "name": "nextly", "version": "1.0.0" }'
  );
});
afterEach(() => {
  // Whatever the test found, nothing it started outlives it.
  for (const pid of [...managerPids(), ...started.map(each => each.pid ?? 0)]) {
    if (pid > 0 && isRunning(pid)) process.kill(pid, "SIGKILL");
  }
  started.length = 0;
  rmSync(folder, { recursive: true, force: true });
});

/** The stand-in's process ids, and its child's, as it wrote them. */
function managerPids(): number[] {
  const file = join(folder, "pids");
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8").trim().split(/\s+/).map(Number);
}

/** Whether a process of this id runs; one that has ended and waits to be read does not. */
function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
  } catch {
    return false;
  }
  try {
    const stat = readFileSync(`/proc/${String(pid)}/stat`, "utf8");
    return !/^\d+ \(.*\) Z/s.test(stat);
  } catch {
    // No /proc, as on macOS: the id answering is all there is to go by.
    return true;
  }
}

const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function until(holds: () => boolean, ms: number): Promise<boolean> {
  for (const end = Date.now() + ms; Date.now() < end; await pause(50)) {
    if (holds()) return true;
  }
  return holds();
}

interface Run {
  process: ChildProcess;
  /** Resolves with the exit code, or the signal's name, once the command has ended. */
  ended: Promise<number | string>;
  said: () => string;
}

/** Starts a command whose manager hangs in `hang`, once the manager is there. */
async function start(
  command: keyof typeof ENTRIES,
  hang: "view" | "install" | "restore",
  ignore = false
): Promise<Run> {
  // In a group of its own, as a terminal's foreground job is.
  const child = spawn(
    process.execPath,
    [join(bundles, `${command}.mjs`), join(folder, "project")],
    {
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        PATH: `${join(folder, "bin")}:${process.env.PATH ?? ""}`,
        PIDS: join(folder, "pids"),
        COUNT: join(folder, "count"),
        HANG: hang,
        IGNORE: ignore ? "1" : "0",
      },
    }
  );
  started.push(child);
  let said = "";
  child.stdout.on("data", chunk => (said += String(chunk)));
  child.stderr.on("data", chunk => (said += String(chunk)));
  const ended = new Promise<number | string>(resolve => {
    child.on("exit", (code, signal) => resolve(code ?? signal ?? "none"));
  });
  const there = await until(() => managerPids().length === 2, 20_000);
  expect(there, `the manager never started: ${said}`).toBe(true);
  await pause(300);
  return { process: child, ended, said: () => said };
}

/** Sends a signal as a terminal does (to the command's group) or to the command alone. */
function send(run: Run, signal: NodeJS.Signals, to: "group" | "command") {
  const pid = run.process.pid ?? 0;
  process.kill(to === "group" ? -pid : pid, signal);
}

/** What of the manager still runs once the command has ended. */
async function leftRunning(): Promise<number[]> {
  await until(() => !managerPids().some(isRunning), 1000);
  return managerPids().filter(isRunning);
}

const project = (file: string) =>
  readFileSync(join(folder, "project", file), "utf8");

const SIGNALS = [
  ["SIGINT", "group"],
  ["SIGINT", "command"],
  ["SIGTERM", "command"],
  ["SIGHUP", "group"],
] as const;

describe.skipIf(process.platform === "win32")(
  "a stopped nextly upgrade",
  () => {
    describe.each(["view", "install", "restore"] as const)(
      "while its manager runs (%s)",
      hang => {
        it.each(SIGNALS)(
          "stops it on %s to the %s, exits 130 and leaves the project's files as they were",
          async (signal, to) => {
            const run = await start("upgrade", hang);
            const at = Date.now();

            send(run, signal, to);

            expect(await run.ended, run.said()).toBe(130);
            expect(await leftRunning()).toEqual([]);
            expect(project("package.json")).toBe(MANIFEST);
            expect(project("package-lock.json")).toBe(LOCKFILE);
            expect(run.said()).toContain("Interrupted");
            // One that ends when asked is not waited for any longer.
            expect(Date.now() - at).toBeLessThan(5000);
          },
          40_000
        );
      }
    );

    it("puts the files back where nobody reads what it says any more", async () => {
      const run = await start("upgrade", "install", true);
      // As a closed terminal does: what is written to it fails.
      run.process.stdout?.destroy();
      run.process.stderr?.destroy();

      send(run, "SIGHUP", "group");
      await pause(1500);
      send(run, "SIGHUP", "group");

      expect(await run.ended).toBe(130);
      expect(await leftRunning()).toEqual([]);
      expect(project("package.json")).toBe(MANIFEST);
      expect(project("package-lock.json")).toBe(LOCKFILE);
    }, 40_000);

    it("takes one Ctrl+C for one, however many tell it of it", async () => {
      const run = await start("upgrade", "install", true);
      send(run, "SIGINT", "group");
      // Apart, since two of one signal waiting to be taken are one.
      await pause(150);
      send(run, "SIGINT", "command");

      expect(await until(() => run.said().includes("Ctrl+C"), 3000)).toBe(true);
      expect(run.process.exitCode).toBeNull();
      expect(managerPids().filter(isRunning).length).toBeGreaterThan(0);

      send(run, "SIGINT", "group");
      expect(await run.ended, run.said()).toBe(130);
      expect(await leftRunning()).toEqual([]);
    }, 40_000);

    it("says it is waiting for one that does not end, and ends it on a second Ctrl+C", async () => {
      const run = await start("upgrade", "install", true);
      send(run, "SIGINT", "group");
      expect(await until(() => run.said().includes("Ctrl+C"), 3000)).toBe(true);
      expect(run.process.exitCode).toBeNull();
      const at = Date.now();

      send(run, "SIGINT", "group");

      expect(await run.ended, run.said()).toBe(130);
      expect(Date.now() - at).toBeLessThan(3000);
      expect(await leftRunning()).toEqual([]);
      expect(project("package.json")).toBe(MANIFEST);
      expect(project("package-lock.json")).toBe(LOCKFILE);
    }, 40_000);

    it("ends one that does not end within ten seconds", async () => {
      const run = await start("upgrade", "restore", true);
      const at = Date.now();

      send(run, "SIGTERM", "command");

      expect(await run.ended, run.said()).toBe(130);
      expect(Date.now() - at).toBeGreaterThan(9000);
      expect(Date.now() - at).toBeLessThan(16_000);
      expect(await leftRunning()).toEqual([]);
      expect(project("package.json")).toBe(MANIFEST);
    }, 40_000);
  }
);

describe.skipIf(process.platform === "win32")("a stopped nextly add", () => {
  it.each(SIGNALS)(
    "stops its manager on %s to the %s and exits 130",
    async (signal, to) => {
      const run = await start("add", "install");

      send(run, signal, to);

      expect(await run.ended, run.said()).toBe(130);
      expect(managerPids().slice(0, 1).filter(isRunning)).toEqual([]);
    },
    40_000
  );

  it("ends one that takes no notice on a second Ctrl+C", async () => {
    const run = await start("add", "install", true);
    send(run, "SIGINT", "group");
    expect(await until(() => run.said().includes("Ctrl+C"), 3000)).toBe(true);
    const at = Date.now();

    send(run, "SIGINT", "group");

    expect(await run.ended, run.said()).toBe(130);
    // By the signal, not by the ten seconds it would be given.
    expect(Date.now() - at).toBeLessThan(3000);
    expect(managerPids().slice(0, 1).filter(isRunning)).toEqual([]);
  }, 40_000);
});
