/**
 * `nextly upgrade [version]`: moves every Nextly package of a project to one
 * release, with the project's own package manager, and leaves the project as
 * it was when it cannot.
 *
 * In order: the project's Nextly packages and its package manager are read;
 * the release is chosen, the one given or the one the installed release's
 * channel names (`chooseRelease`); every package is checked to have that
 * release on the registry, before anything changes; `package.json` is given
 * the one exact version for each and the manager installs; and each package
 * is read back at the release. A failure anywhere after the first write puts
 * `package.json` and the lockfile back, installs from them again, and reads
 * every package back at the version it had.
 *
 * @module cli/commands/upgrade-packages/upgrade-packages
 */

import { readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { CliError } from "../../errors";
import type { DryRunPlan } from "../../dry-run";

import {
  detectPackageManager,
  forgetInstallState,
  installArgs,
  lockfileOf,
  runManager,
  usesPlugAndPlay,
  yarnKindIn,
  type DetectedManager,
} from "./package-manager";
import {
  declaredNextlyPackages,
  declaresNextlyPeer,
  installedVersion,
  readManifest,
  withVersions,
  type DeclaredPackage,
} from "./project-packages";
import { releasesOf } from "./registry-releases";
import {
  chooseRelease,
  type RegistryReleases,
  type ReleaseChoice,
} from "./release-choice";
import {
  cannotStart,
  installFailed,
  notRestored,
  packagesCannotMove,
  releaseUnknown,
} from "./upgrade-refusals";

/** Where each release's notes are published. */
const RELEASE_NOTES = "https://github.com/nextlyhq/nextly/releases/tag/v";

export interface UpgradePackagesArgs {
  /** The project folder: where its `package.json` is. */
  projectDir: string;
  /** The release given, or undefined to follow the installed release's channel. */
  version: string | undefined;
  /** Show what would change, and change nothing. */
  dryRun: boolean;
  log: (line: string) => void;
  /** Reports a dry run's plan, as every command's dry run is reported. */
  report: (plan: DryRunPlan) => void;
}

/** The project as the run found it. */
interface Project {
  dir: string;
  manifestText: string;
  packages: DeclaredPackage[];
  detected: DetectedManager;
}

/** Reads the project, refusing one the command cannot upgrade. */
function readProject(projectDir: string): Project {
  const read = readManifest(projectDir);
  if (read === undefined) {
    throw cannotStart(
      `No \`package.json\` could be read in ${projectDir}.`,
      "Run `nextly upgrade` in the project's folder, or name it with `--cwd`."
    );
  }
  const packages = declaredNextlyPackages(read.manifest);
  if (packages.length === 0 && declaresNextlyPeer(read.manifest)) {
    // A peer range is the author's statement of which releases the package
    // works with, not what is installed, so the command never rewrites one.
    throw cannotStart(
      "This project's `package.json` declares Nextly only as a peer dependency, which `nextly upgrade` does not rewrite.",
      "Set the peer range yourself. To have `nextly upgrade` move the release you develop against, declare the packages under `devDependencies` too."
    );
  }
  if (packages.length === 0) {
    throw cannotStart(
      "This project's `package.json` declares no Nextly package.",
      "Run `nextly upgrade` in the folder whose `package.json` depends on `nextly`."
    );
  }
  const detected = detectPackageManager(projectDir);
  if (detected.manager === "yarn" && usesPlugAndPlay(detected.root)) {
    throw cannotStart(
      "This project is installed with Yarn Plug'n'Play, which `nextly upgrade` does not support yet.",
      "Set each Nextly package to the release in `package.json` and run `yarn install`, or switch the project to `nodeLinker: node-modules`."
    );
  }
  return { dir: projectDir, manifestText: read.text, packages, detected };
}

/** `project` with Yarn asked which it is, where Yarn is its manager. */
async function withYarnKind(project: Project): Promise<Project> {
  if (project.detected.manager !== "yarn") return project;
  return {
    ...project,
    detected: { ...project.detected, yarn: await yarnKindIn(project.dir) },
  };
}

/** What the registry holds for `nextly`, and the choice made from it. */
async function choose(
  project: Project,
  version: string | undefined
): Promise<{ choice: ReleaseChoice; releases: RegistryReleases }> {
  const answer = await releasesOf(
    project.detected.manager,
    project.dir,
    "nextly",
    project.detected.yarn
  );
  if (answer.kind !== "found") {
    throw cannotStart(
      answer.kind === "missing"
        ? "The registry this project uses has no `nextly` package."
        : `The registry could not be asked which releases of \`nextly\` exist: ${answer.why}.`,
      "Check the registry the project's package manager is configured with, then run `nextly upgrade` again."
    );
  }
  return {
    releases: answer.releases,
    choice: chooseRelease({
      argument: version,
      installed: installedVersion(project.dir, "nextly"),
      releases: answer.releases,
    }),
  };
}

/** Why `declared` cannot move to `version`, or undefined when it can. */
async function whyNot(
  project: Project,
  declared: DeclaredPackage,
  version: string,
  /** What the registry holds for `nextly`, already read. */
  nextly: RegistryReleases
): Promise<string | undefined> {
  if (!declared.fromRegistry) {
    return `${declared.name} is declared as \`${declared.spec}\`, which is not a version of the registry.`;
  }
  const answer =
    declared.name === "nextly"
      ? ({ kind: "found", releases: nextly } as const)
      : await releasesOf(
          project.detected.manager,
          project.dir,
          declared.name,
          project.detected.yarn
        );
  if (answer.kind === "unreadable") {
    return `${declared.name}: the registry could not be asked (${answer.why}).`;
  }
  return answer.kind === "found" && answer.releases.versions.includes(version)
    ? undefined
    : `${declared.name} has no release ${version} on the registry.`;
}

/**
 * Refuses before anything changes unless every package has `version`. The
 * packages are asked about together: each is its own question to the
 * registry.
 */
async function assertEveryPackageCanMove(
  project: Project,
  version: string,
  nextly: RegistryReleases
): Promise<void> {
  const reasons = (
    await Promise.all(
      project.packages.map(declared =>
        whyNot(project, declared, version, nextly)
      )
    )
  ).filter(reason => reason !== undefined);
  if (reasons.length > 0) throw packagesCannotMove(version, reasons);
}

/** Each package's installed version, by name; undefined where it is not installed. */
const installedOf = (project: Project) =>
  new Map(
    project.packages.map(({ name }) => [
      name,
      installedVersion(project.dir, name),
    ])
  );

/** `package.json` and the lockfile as they are, to be put back byte for byte. */
interface Saved {
  manifest: string;
  lockfile: { file: string; bytes: Buffer } | undefined;
  installed: Map<string, string | undefined>;
}

function save(project: Project): Saved {
  const file = project.detected.lockfile;
  return {
    manifest: project.manifestText,
    lockfile:
      file === undefined ? undefined : { file, bytes: readFileSync(file) },
    installed: installedOf(project),
  };
}

/** Puts both files back; a lockfile the failed install created is removed. */
function putFilesBack(project: Project, saved: Saved): void {
  replaceFile(join(project.dir, "package.json"), saved.manifest);
  if (saved.lockfile !== undefined) {
    replaceFile(saved.lockfile.file, saved.lockfile.bytes);
    return;
  }
  const created = lockfileOf(project.detected.manager, project.detected.root);
  if (created !== undefined) rmSync(created, { force: true });
}

/** Each package not at the version it had before, as `name: had → has`. */
function differingFrom(project: Project, saved: Saved): string[] {
  const now = installedOf(project);
  return project.packages
    .filter(({ name }) => now.get(name) !== saved.installed.get(name))
    .map(
      ({ name }) =>
        `${name}: ${saved.installed.get(name) ?? "not installed"} → ${now.get(name) ?? "not installed"}`
    );
}

/**
 * Puts the project back after a failed install and ends the run: both files
 * as they were, the packages installed from them again, and each read back.
 * That second install may itself end badly, as where a script of the project
 * fails on every install: what decides is what is installed after it.
 */
async function restoreAndFail(
  project: Project,
  saved: Saved,
  version: string,
  output: string
): Promise<never> {
  const { manager, yarn } = project.detected;
  putFilesBack(project, saved);
  forgetInstallState(manager, project.detected.root);
  forgetInstallState(manager, project.dir);
  const again = await runManager(
    manager,
    installArgs(manager, yarn),
    project.dir
  );
  // A project that had no lockfile has none again.
  if (saved.lockfile === undefined) putFilesBack(project, saved);
  const differing = differingFrom(project, saved);
  // Restored only where that install itself succeeded: one that failed may
  // have left any other package missing, whatever the Nextly ones read as.
  if (again.status === 0 && differing.length === 0) {
    throw installFailed({ manager, version, output });
  }
  throw notRestored({ manager, version, output: again.output, differing });
}

/**
 * Replaces `file` with `content` whole or not at all: written beside it and
 * renamed over it, so a write that fails part-way, as on a full disk, leaves
 * the file as it was.
 */
function replaceFile(file: string, content: string | Buffer): void {
  const beside = `${file}.nextly-upgrade-${String(process.pid)}.tmp`;
  try {
    writeFileSync(beside, content);
    renameSync(beside, file);
  } catch (error) {
    rmSync(beside, { force: true });
    throw error;
  }
}

/** Moves every package to `version`, or puts the project back and fails. */
async function move(
  project: Project,
  version: string,
  log: UpgradePackagesArgs["log"]
): Promise<void> {
  const { manager, yarn } = project.detected;
  const saved = save(project);
  // Interrupted while the manager installs, the manager is stopped and its
  // end waited for, so nothing goes on changing the project; then the two
  // files are put back, and the operator is told the one thing left undone.
  const stop = new AbortController();
  const interrupt = () => stop.abort();
  process.once("SIGINT", interrupt);
  process.once("SIGTERM", interrupt);
  let run: Awaited<ReturnType<typeof runManager>>;
  try {
    replaceFile(
      join(project.dir, "package.json"),
      withVersions(project.manifestText, project.packages, version)
    );
    log(`Installing with ${manager}...`);
    run = await runManager(manager, installArgs(manager, yarn), project.dir, {
      signal: stop.signal,
    });
  } finally {
    process.off("SIGINT", interrupt);
    process.off("SIGTERM", interrupt);
  }
  if (stop.signal.aborted) {
    putFilesBack(project, saved);
    process.stderr.write(
      `\nInterrupted: package.json and the lockfile were put back as they were. Run \`${manager} install\` to put the installed packages back.\n`
    );
    process.exit(130);
  }
  // A package the install leaves out on purpose, as a development one under
  // an omit setting, was not installed before and need not be after.
  const left = project.packages
    .map(({ name }) => name)
    .filter(
      name =>
        saved.installed.get(name) !== undefined &&
        installedVersion(project.dir, name) !== version
    );
  if (run.status === 0 && left.length === 0) return;
  await restoreAndFail(
    project,
    saved,
    version,
    run.status === 0
      ? `${run.output}\nNot installed at ${version} afterwards: ${left.join(", ")}`
      : run.output
  );
}

/** The packages not yet declared and installed at exactly `version`, each with where it is. */
const toMove = (project: Project, version: string) =>
  project.packages
    .map(({ name, spec }) => ({
      name,
      spec,
      from: installedVersion(project.dir, name) ?? spec,
    }))
    .filter(({ spec, from }) => spec !== version || from !== version);

/** What a run that has nothing to move says: the channel, and newer releases elsewhere. */
function currentLines(
  choice: Extract<ReleaseChoice, { kind: "current" }>
): string[] {
  return [
    `This project is on the newest release of its channel (\`${choice.channel}\`). Nothing was changed.`,
    ...choice.newer.map(
      ({ tag, version }) =>
        `The \`${tag}\` tag holds a newer release: run \`nextly upgrade ${version}\` to move to it.`
    ),
  ];
}

/** What a run does once it has read the project and the registry. */
type Plan =
  | { kind: "move"; project: Project; version: string }
  /** Nothing to move, and what to say of it. */
  | { kind: "nothing"; lines: string[] };

/**
 * What the run would do, having changed nothing: the release every package
 * moves to, checked to exist for each, or that there is nothing to move. It
 * throws the refusal where no release can be chosen or a package cannot
 * move.
 *
 * On the newest release of its channel a project still moves any package
 * held at another version, to the release `nextly` is at: the packages are
 * one release or they are not Nextly as released.
 */
async function plan(
  projectDir: string,
  given: string | undefined
): Promise<Plan> {
  const project = await withYarnKind(readProject(projectDir));
  const { choice, releases } = await choose(project, given);
  if (choice.kind === "refused") throw releaseUnknown(choice);
  const version =
    choice.kind === "move"
      ? choice.version
      : installedVersion(project.dir, "nextly");
  if (version === undefined || toMove(project, version).length === 0) {
    return {
      kind: "nothing",
      lines:
        choice.kind === "current"
          ? currentLines(choice)
          : [
              `Every Nextly package is already at ${String(version)}. Nothing was changed.`,
            ],
    };
  }
  await assertEveryPackageCanMove(project, version, releases);
  return { kind: "move", project, version };
}

/**
 * `nextly upgrade --dry-run`: the plan as every dry run reports one, with
 * the refusal a real run would make named rather than ended on.
 */
async function dryRun(args: UpgradePackagesArgs): Promise<void> {
  let planned: Plan;
  try {
    planned = await plan(args.projectDir, args.version);
  } catch (error) {
    if (!(error instanceof CliError)) throw error;
    args.report({
      changes: [],
      refusals: [`${error.what} ${error.next}`],
    });
    return;
  }
  if (planned.kind === "nothing") {
    args.report({ changes: [], notes: planned.lines });
    return;
  }
  const { project, version } = planned;
  args.report({
    changes: toMove(project, version).map(({ name, from }) => ({
      action: "move",
      target: `${name} from ${from} to ${version}`,
    })),
  });
}

/**
 * Runs the upgrade. Returns having moved the packages, or having found
 * nothing to move; throws the refusal otherwise, with the project as it was.
 */
export async function upgradePackages(
  args: UpgradePackagesArgs
): Promise<void> {
  if (args.dryRun) {
    await dryRun(args);
    return;
  }
  const { log } = args;
  const planned = await plan(args.projectDir, args.version);
  if (planned.kind === "nothing") {
    for (const line of planned.lines) log(line);
    return;
  }
  const { project, version } = planned;

  log(`Moving every Nextly package to ${version}:`);
  for (const { name, from } of toMove(project, version)) {
    log(`  ${name}: ${from} → ${version}`);
  }
  await move(project, version, log);

  log(`Every Nextly package is at ${version}.`);
  log(`Release notes: ${RELEASE_NOTES}${version}`);
  log(
    "Next: run `nextly migrate:create`, which captures a migration if this release changes your schema and says so if it does not, then `nextly migrate`."
  );
}
