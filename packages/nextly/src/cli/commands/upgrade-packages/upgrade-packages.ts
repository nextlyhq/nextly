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

import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  detectPackageManager,
  forgetInstallState,
  installArgs,
  lockfileOf,
  runManager,
  usesPlugAndPlay,
  type DetectedManager,
} from "./package-manager";
import {
  declaredNextlyPackages,
  installedVersion,
  readManifest,
  withVersions,
  type DeclaredPackage,
} from "./project-packages";
import { releasesOf } from "./registry-releases";
import { chooseRelease, type ReleaseChoice } from "./release-choice";
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

/** The release to move to, or the choice that ends the run without a move. */
async function choose(
  project: Project,
  version: string | undefined
): Promise<ReleaseChoice> {
  const answer = await releasesOf(
    project.detected.manager,
    project.dir,
    "nextly"
  );
  if (answer.kind !== "found") {
    throw cannotStart(
      answer.kind === "missing"
        ? "The registry this project uses has no `nextly` package."
        : `The registry could not be asked which releases of \`nextly\` exist: ${answer.why}.`,
      "Check the registry the project's package manager is configured with, then run `nextly upgrade` again."
    );
  }
  return chooseRelease({
    argument: version,
    installed: installedVersion(project.dir, "nextly"),
    releases: answer.releases,
  });
}

/** Why `declared` cannot move to `version`, or undefined when it can. */
async function whyNot(
  project: Project,
  declared: DeclaredPackage,
  version: string
): Promise<string | undefined> {
  if (!declared.fromRegistry) {
    return `${declared.name} is declared as \`${declared.spec}\`, which is not a version of the registry.`;
  }
  const answer = await releasesOf(
    project.detected.manager,
    project.dir,
    declared.name
  );
  if (answer.kind === "unreadable") {
    return `${declared.name}: the registry could not be asked (${answer.why}).`;
  }
  return answer.kind === "found" && answer.releases.versions.includes(version)
    ? undefined
    : `${declared.name} has no release ${version} on the registry.`;
}

/** Refuses before anything changes unless every package has `version`. */
async function assertEveryPackageCanMove(
  project: Project,
  version: string
): Promise<void> {
  const reasons: string[] = [];
  for (const declared of project.packages) {
    const reason = await whyNot(project, declared, version);
    if (reason !== undefined) reasons.push(reason);
  }
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
  writeFileSync(join(project.dir, "package.json"), saved.manifest);
  if (saved.lockfile !== undefined) {
    writeFileSync(saved.lockfile.file, saved.lockfile.bytes);
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
  const { manager } = project.detected;
  putFilesBack(project, saved);
  forgetInstallState(manager, project.detected.root);
  forgetInstallState(manager, project.dir);
  const again = await runManager(manager, installArgs(manager), project.dir);
  // A project that had no lockfile has none again.
  if (saved.lockfile === undefined) putFilesBack(project, saved);
  const differing = differingFrom(project, saved);
  if (differing.length === 0) throw installFailed({ manager, version, output });
  throw notRestored({ manager, version, output: again.output, differing });
}

/** Moves every package to `version`, or puts the project back and fails. */
async function move(
  project: Project,
  version: string,
  log: UpgradePackagesArgs["log"]
): Promise<void> {
  const { manager } = project.detected;
  const saved = save(project);
  writeFileSync(
    join(project.dir, "package.json"),
    withVersions(project.manifestText, project.packages, version)
  );
  log(`Installing with ${manager}...`);
  const run = await runManager(manager, installArgs(manager), project.dir);
  const left = project.packages
    .map(({ name }) => name)
    .filter(name => installedVersion(project.dir, name) !== version);
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

/** Each package's move as a line: `name: from → to`. */
const moves = (project: Project, version: string) =>
  project.packages.map(
    ({ name, spec }) =>
      `  ${name}: ${installedVersion(project.dir, name) ?? spec} → ${version}`
  );

/** What a run that has nothing to move says: the channel, and newer releases elsewhere. */
function reportCurrent(
  choice: Extract<ReleaseChoice, { kind: "current" }>,
  log: UpgradePackagesArgs["log"]
): void {
  log(
    `This project is on the newest release of its channel (\`${choice.channel}\`). Nothing was changed.`
  );
  for (const { tag, version } of choice.newer) {
    log(
      `The \`${tag}\` tag holds a newer release: run \`nextly upgrade ${version}\` to move to it.`
    );
  }
}

/** Whether every package is already declared and installed at exactly `version`. */
const allAt = (project: Project, version: string) =>
  project.packages.every(
    ({ name, spec }) =>
      spec === version && installedVersion(project.dir, name) === version
  );

/**
 * Runs the upgrade. Returns having moved the packages, or having found
 * nothing to move; throws the refusal otherwise, with the project as it was.
 */
export async function upgradePackages(
  args: UpgradePackagesArgs
): Promise<void> {
  const { log } = args;
  const project = readProject(args.projectDir);
  const choice = await choose(project, args.version);
  if (choice.kind === "refused") throw releaseUnknown(choice);
  if (choice.kind === "current") {
    reportCurrent(choice, log);
    return;
  }
  const { version } = choice;
  if (allAt(project, version)) {
    log(`Every Nextly package is already at ${version}. Nothing was changed.`);
    return;
  }
  await assertEveryPackageCanMove(project, version);

  if (args.dryRun) {
    log(`Would move every Nextly package to ${version}:`);
    for (const line of moves(project, version)) log(line);
    log("Dry run: nothing was changed.");
    return;
  }

  log(`Moving every Nextly package to ${version}:`);
  for (const line of moves(project, version)) log(line);
  await move(project, version, log);

  log(`Every Nextly package is at ${version}.`);
  log(`Release notes: ${RELEASE_NOTES}${version}`);
  log(
    "Next: run `nextly migrate:create`, which captures a migration if this release changes your schema and says so if it does not, then `nextly migrate`."
  );
}
