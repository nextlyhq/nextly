/**
 * A project for the tests of `nextly upgrade`: a folder with a
 * `package.json` naming Nextly's packages, installed by one package manager
 * from the registry inside the test process (`startLocalRegistry`).
 *
 * The packages are stand-ins, a `package.json` each, under versions no real
 * release has, so an install takes a moment and nothing can come from the
 * network. The command under test runs from source, as a process.
 */
import { spawn, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  startLocalRegistry,
  type LocalRegistry,
} from "../../../__tests__/helpers/local-registry";
import { runNextly } from "../../../__tests__/helpers/run-nextly";

export type Manager = "npm" | "pnpm" | "yarn" | "bun";
export const MANAGERS: readonly Manager[] = ["npm", "pnpm", "yarn", "bun"];

/** The releases of the registry, oldest first within the prerelease line. */
export const STABLE = "8.0.0";
export const OLDEST = "9.0.0-alpha.1";
export const MIDDLE = "9.0.0-alpha.2";
export const NEWEST = "9.0.0-beta.1";
/** Published under no tag: a release candidate, whose channel has none. */
export const CANDIDATE = "9.0.0-rc.1";
/** Published, and named only by the tests whose download of it fails. */
export const UNSERVED = "9.0.0-alpha.3";

/** The Nextly packages a project of these tests depends on. */
export const PACKAGES = [
  "nextly",
  "@nextlyhq/admin",
  "@nextlyhq/adapter-sqlite",
] as const;

/** A registry whose tags diverge: `latest` on the oldest, `alpha` on the middle, `beta` on the newest. */
export function startNextlyRegistry(): Promise<LocalRegistry> {
  return startLocalRegistry(
    PACKAGES.map(name => ({
      name,
      versions: [STABLE, OLDEST, MIDDLE, UNSERVED, NEWEST, CANDIDATE],
      tags: { latest: OLDEST, alpha: MIDDLE, beta: NEWEST },
    }))
  );
}

/**
 * The environment a package manager and the CLI run with: none of the
 * settings the test runner's own package manager exports (its registry, its
 * cache, its user agent), so each project is configured by its own files
 * alone.
 */
const ENV: Record<string, string | undefined> = {
  ...Object.fromEntries(
    Object.keys(process.env)
      .filter(name => /^npm_(config|package|lifecycle)_/i.test(name))
      .map(name => [name, undefined])
  ),
  COREPACK_ENABLE_DOWNLOAD_PROMPT: "0",
  // A lockfile changing is the point of these tests.
  CI: undefined,
  YARN_ENABLE_IMMUTABLE_INSTALLS: "false",
};

function scrubbed(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const [name, value] of Object.entries(ENV)) {
    if (value === undefined) delete env[name];
    else env[name] = value;
  }
  return env;
}

/** Whether `manager` can be run on this machine. It asks no registry, so it may block. */
export function hasManager(manager: Manager): boolean {
  return (
    spawnSync(manager, ["--version"], {
      env: scrubbed(),
      encoding: "utf8",
      timeout: 60_000,
    }).status === 0
  );
}

/**
 * Runs `manager <args>` in `cwd` without blocking this process: the
 * registry it downloads from is served by this process, so a synchronous
 * run would wait for an answer that cannot come. Ended after a minute.
 */
function runManager(
  manager: Manager,
  args: string[],
  cwd: string
): Promise<{ status: number | null; output: string }> {
  return new Promise(settle => {
    const child = spawn(manager, args, {
      cwd,
      env: scrubbed(),
      timeout: 60_000,
    });
    let output = "";
    child.stdout.setEncoding("utf8").on("data", chunk => (output += chunk));
    child.stderr.setEncoding("utf8").on("data", chunk => (output += chunk));
    child.on("error", error => (output += `\n${error.message}`));
    child.on("close", status => settle({ status, output }));
  });
}

/** The lockfile each manager keeps, newest spelling first. */
const LOCKFILES: Record<Manager, readonly string[]> = {
  npm: ["package-lock.json"],
  pnpm: ["pnpm-lock.yaml"],
  yarn: ["yarn.lock"],
  bun: ["bun.lock", "bun.lockb"],
};

export interface UpgradeProject {
  dir: string;
  manager: Manager;
  /** `nextly <args>` in the project. */
  nextly: (
    args: string[]
  ) => Promise<{ status: number | null; stdout: string; stderr: string }>;
  /** The version of `name` the project's `package.json` declares. */
  declared: (name: string) => string | undefined;
  /** The version of `name` installed in the project, or undefined when it is not. */
  installed: (name: string) => string | undefined;
  /** `package.json` and the lockfile, as bytes, for a byte-for-byte comparison. */
  files: () => { manifest: string; lockfile: string | null };
  remove: () => void;
}

/**
 * A project depending on every package of `PACKAGES` at `versions` (one
 * version for all, or one per package), with its registry settings written
 * as each manager reads them. Installed unless `install` is false.
 */
export async function createProject(args: {
  manager: Manager;
  registry: LocalRegistry;
  versions: string | Readonly<Record<string, string>>;
  install?: boolean;
  /** Extra `package.json` fields, such as `scripts`. */
  manifest?: Readonly<Record<string, unknown>>;
}): Promise<UpgradeProject> {
  const { manager, registry } = args;
  const dir = mkdtempSync(join(tmpdir(), `nextly-upgrade-${manager}-`));
  const versionOf = (name: string) =>
    typeof args.versions === "string" ? args.versions : args.versions[name];
  writeFileSync(
    join(dir, "package.json"),
    `${JSON.stringify(
      {
        name: "upgrade-project",
        version: "1.0.0",
        private: true,
        ...(manager === "yarn" ? { packageManager: "yarn@4.9.2" } : {}),
        ...args.manifest,
        dependencies: Object.fromEntries(
          PACKAGES.map(name => [name, versionOf(name)])
        ),
      },
      null,
      2
    )}\n`
  );
  // npm, pnpm and bun read the registry from `.npmrc`; Yarn from its own file,
  // where a plain-HTTP registry also has to be allowed by name.
  // npm also keeps its download cache in the project, so a test can tell
  // that an install fetched a release from one that found it cached.
  writeFileSync(
    join(dir, ".npmrc"),
    `registry=${registry.url}/\ncache=${join(dir, ".cache", "npm")}\n`
  );
  if (manager === "yarn") {
    writeFileSync(
      join(dir, ".yarnrc.yml"),
      [
        "nodeLinker: node-modules",
        `npmRegistryServer: "${registry.url}"`,
        "unsafeHttpWhitelist:",
        '  - "127.0.0.1"',
        "enableTelemetry: false",
        "enableGlobalCache: false",
        "",
      ].join("\n")
    );
  }

  const project: UpgradeProject = {
    dir,
    manager,
    nextly: nextlyArgs => runNextly(nextlyArgs, dir, ENV),
    declared: name => {
      const manifest = JSON.parse(
        readFileSync(join(dir, "package.json"), "utf8")
      ) as { dependencies?: Record<string, string> };
      return manifest.dependencies?.[name];
    },
    installed: name => {
      const file = join(dir, "node_modules", name, "package.json");
      if (!existsSync(file)) return undefined;
      return (JSON.parse(readFileSync(file, "utf8")) as { version: string })
        .version;
    },
    files: () => {
      const lockfile = LOCKFILES[manager]
        .map(name => join(dir, name))
        .find(file => existsSync(file));
      return {
        manifest: readFileSync(join(dir, "package.json"), "utf8"),
        lockfile:
          lockfile === undefined ? null : readFileSync(lockfile, "base64"),
      };
    },
    remove: () => rmSync(dir, { recursive: true, force: true }),
  };

  if (args.install !== false) {
    const run = await runManager(manager, ["install"], dir);
    if (run.status !== 0) {
      project.remove();
      throw new Error(
        `${manager} install failed in the fixture (status ${String(run.status)}):\n${run.output}`
      );
    }
  }
  return project;
}
