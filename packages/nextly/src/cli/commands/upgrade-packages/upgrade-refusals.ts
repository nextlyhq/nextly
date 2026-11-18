/**
 * How `nextly upgrade` ends when it cannot move the packages: each refusal,
 * in the words the operator reads.
 *
 * @module cli/commands/upgrade-packages/upgrade-refusals
 */

import { CliError } from "../../errors";

import type { ReleaseChoice, TaggedRelease } from "./release-choice";

const UNCHANGED = "Nothing was changed.";

/** Every tag with its release, one per line, and the command that moves to one. */
function everyTag(tags: readonly TaggedRelease[]): string {
  const lines = tags.map(({ tag, version }) => `  ${tag}: ${version}`);
  return [
    tags.length > 0
      ? "The registry has these tags:"
      : "The registry has no tag for `nextly`.",
    ...lines,
    "Move to one with `nextly upgrade <version>`.",
  ].join("\n");
}

/** The project cannot be upgraded as it stands: `what` says why. */
export function cannotStart(what: string, next: string): CliError {
  return new CliError("UPGRADE_CANNOT_START", {
    what,
    why: `\`nextly upgrade\` moves the Nextly packages a project's \`package.json\` declares, with the project's own package manager. ${UNCHANGED}`,
    next,
  });
}

/** No release could be chosen, or the one given is not published. */
export function releaseUnknown(
  refused: Extract<ReleaseChoice, { kind: "refused" }>
): CliError {
  const { why, wouldChoose, tags } = refused;
  const what =
    why.reason === "not-published"
      ? `\`${why.given}\` is not a published release of Nextly.`
      : why.reason === "no-tag"
        ? `The installed release is on the \`${why.channel}\` channel, and the registry has no \`${why.channel}\` tag to follow.`
        : "The release to follow cannot be told: `nextly` is not installed in this project.";
  return new CliError("UPGRADE_RELEASE_UNKNOWN", {
    what,
    why: `With no version given, \`nextly upgrade\` follows the channel of the installed release: the tag its prerelease identifier names, or \`latest\`. ${UNCHANGED}`,
    next:
      wouldChoose !== undefined
        ? `Run \`nextly upgrade ${wouldChoose}\`, the release \`nextly upgrade\` moves to with no version given.`
        : everyTag(tags),
    context: { reason: why.reason },
  });
}

/** Some packages cannot move to the release: each with its reason. */
export function packagesCannotMove(
  version: string,
  reasons: readonly string[]
): CliError {
  return new CliError("UPGRADE_PACKAGE_CANNOT_MOVE", {
    what: `Not every Nextly package of this project can move to ${version}:\n${reasons.map(reason => `  ${reason}`).join("\n")}`,
    why: `Nextly's packages version together, so \`nextly upgrade\` moves all of them or none. ${UNCHANGED}`,
    next: "Name a release every package has (`nextly upgrade <version>`), or declare the package by a version in `package.json`.",
  });
}

/** The last lines a package manager printed, for a failure's report. */
const lastLines = (output: string) =>
  output.trim().split(/\r?\n/).slice(-15).join("\n");

/** The install failed, and the project is as it was before it. */
export function installFailed(args: {
  manager: string;
  version: string;
  output: string;
}): CliError {
  return new CliError("UPGRADE_INSTALL_FAILED", {
    what: `\`${args.manager} install\` failed while moving the Nextly packages to ${args.version}:\n${lastLines(args.output)}`,
    why: "`package.json` and the lockfile were put back as they were, the packages were installed again from them, and every Nextly package is at the version it had.",
    next: "Fix what the package manager reported, then run `nextly upgrade` again.",
  });
}

/** The install failed, and the installed packages could not be put back. */
export function notRestored(args: {
  manager: string;
  version: string;
  output: string;
  /** Each package not at the version it had, as `name: had → has`. */
  differing: readonly string[];
}): CliError {
  return new CliError("UPGRADE_NOT_RESTORED", {
    what: `\`${args.manager} install\` failed while moving the Nextly packages to ${args.version}, and the installed packages could not be put back:\n${args.differing.map(line => `  ${line}`).join("\n")}`,
    why: `\`package.json\` and the lockfile were put back as they were. Installing from them again did not bring every Nextly package back to the version it had:\n${lastLines(args.output)}`,
    next: `Run \`${args.manager} install\` once the cause is fixed: it installs what the restored files record. Until then the installed packages do not match them.`,
  });
}
