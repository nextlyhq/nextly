/**
 * Which release `nextly upgrade` moves a project to.
 *
 * With a version given, that release, if the registry has it. With none, the
 * release the installed one's channel names: the npm dist-tag its prerelease
 * identifier spells (`alpha` for `0.0.2-alpha.68`), or `latest` for a release
 * with no prerelease identifier. Never the highest version under another
 * tag, and never a release older than the installed one.
 *
 * Pure: it is handed what the project has installed and what the registry
 * holds, and answers. Reading either is its callers' work.
 *
 * @module cli/commands/upgrade-packages/release-choice
 */

import semver from "semver";

/** What the registry holds for `nextly`: each dist-tag's release, and every release. */
export interface RegistryReleases {
  tags: Readonly<Record<string, string>>;
  versions: readonly string[];
}

/** A dist-tag and the release it names. */
export interface TaggedRelease {
  tag: string;
  version: string;
}

export type ReleaseChoice =
  /** Move every package to `version`. */
  | { kind: "move"; version: string }
  /** The channel's tag names the installed release or an older one: nothing to do. */
  | {
      kind: "current";
      channel: string;
      /** Other tags holding a release newer than the installed one. */
      newer: TaggedRelease[];
    }
  /** No release can be chosen, or the one given is not published. */
  | {
      kind: "refused";
      why:
        | { reason: "not-published"; given: string }
        | { reason: "no-tag"; channel: string }
        | { reason: "not-installed" };
      /** The release a run with no version would move to, where there is one. */
      wouldChoose?: string;
      /** Every tag the registry has, for a refusal that can name no release. */
      tags: TaggedRelease[];
    };

/** The dist-tag a release's channel is: its prerelease identifier, or `latest`. */
export function channelOf(version: string): string {
  const [identifier] = semver.prerelease(version) ?? [];
  return typeof identifier === "string" ? identifier : "latest";
}

/** Every tag with its release, by tag name. */
const tagged = (releases: RegistryReleases): TaggedRelease[] =>
  Object.entries(releases.tags)
    .map(([tag, version]) => ({ tag, version }))
    .sort((a, b) => a.tag.localeCompare(b.tag));

/**
 * The release a run with no version moves to, from the installed release's
 * channel. `installed` is undefined where the installed `nextly` cannot be
 * read.
 */
function channelChoice(
  installed: string | undefined,
  releases: RegistryReleases
): ReleaseChoice {
  const tags = tagged(releases);
  if (installed === undefined || semver.valid(installed) === null) {
    return { kind: "refused", why: { reason: "not-installed" }, tags };
  }
  const channel = channelOf(installed);
  const named = releases.tags[channel];
  if (named === undefined) {
    return { kind: "refused", why: { reason: "no-tag", channel }, tags };
  }
  if (semver.gt(named, installed)) return { kind: "move", version: named };
  return {
    kind: "current",
    channel,
    newer: tags.filter(
      ({ tag, version }) => tag !== channel && semver.gt(version, installed)
    ),
  };
}

/**
 * The choice for a run given `argument` (undefined for none) on a project
 * whose installed `nextly` is `installed` (undefined where it cannot be
 * read).
 *
 * An argument that is not a published release, a well-formed version or not,
 * is refused with the release the run with no argument would move to, from
 * the installed release's channel whatever channel the argument names; where
 * that run could choose none, with every tag the registry has.
 */
export function chooseRelease(args: {
  argument: string | undefined;
  installed: string | undefined;
  releases: RegistryReleases;
}): ReleaseChoice {
  const { argument, installed, releases } = args;
  const fromChannel = channelChoice(installed, releases);
  if (argument === undefined) return fromChannel;
  if (releases.versions.includes(argument)) {
    return { kind: "move", version: argument };
  }
  return {
    kind: "refused",
    why: { reason: "not-published", given: argument },
    ...(fromChannel.kind === "move"
      ? { wouldChoose: fromChannel.version }
      : {}),
    tags: tagged(releases),
  };
}
