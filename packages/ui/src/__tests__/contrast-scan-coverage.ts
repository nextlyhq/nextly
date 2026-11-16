/**
 * What the contrast scans read, and which packages they have to read.
 *
 * Each contrast scan in `src/styles/contrast/__tests__/` measures the call
 * sites under a hand-kept list of directories, and a package missing from
 * that list is measured by nothing while the scan stays green: an empty
 * corner of the repository and a clean one look the same from inside it. So
 * each scan also derives, from the whole repository, the packages that use
 * what it measures, and fails when one of them is not in its list.
 *
 * That derivation is the same question for every scan -- which packages'
 * rendering source holds something this scan would measure -- and it lives
 * here once. Only the "would measure" part differs, and each scan answers it
 * with its own reader, so a scan cannot demand coverage for a utility it
 * would then ignore, nor miss one it would have measured.
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** The repository root, which every path here is relative to. */
export const repo = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../.."
);

/**
 * Whether a path is source that RENDERS.
 *
 * Every scan and every coverage check asks this, and they must answer
 * identically. A suite naming `border-input/50` as a fixture paints nothing,
 * so the measuring scans skip tests -- and a coverage check asking a
 * different question of the same corpus would fail the run over a package
 * whose only match is in a test, demanding coverage for a file the
 * measurement then ignores.
 */
export function rendersUi(path: string): boolean {
  return !/\.test\.|\/__tests__\//.test(path);
}

/**
 * Every TRACKED file under `paths`, repository-relative, that is still on disk.
 *
 * The scans read the whole repository rather than one package, so anything
 * that happens to exist under a package's `src` while they run would be part
 * of what they judge: a fixture another suite writes and deletes, a generated
 * file, a build artifact landing in a source tree. Each would become a
 * contrast finding reported against a developer who never wrote it. Tracked
 * files are the set these rules are about: what a component renders is what
 * somebody committed. Asking git excludes everything transient by
 * construction rather than by a list of things to skip.
 *
 * Listed by git directly, each directory as a glob pathspec, so no shell has
 * to expand `packages/*\/src`: `cmd.exe`, which runs `execFileSync` on
 * Windows, leaves it literal, and git then lists nothing.
 *
 * An EMPTY list throws rather than returning nothing. A pathspec that matches
 * no tracked file and a repository with no violations would otherwise produce
 * the same empty result, and every scan reads emptiness as "no violations".
 *
 * A file deleted from the working tree is still in the index until the
 * deletion is staged, and it renders nothing, so it is skipped rather than
 * read; the empty-list guard still catches a pathspec that names nothing.
 */
export function trackedFiles(paths: readonly string[]): string[] {
  const listed = execFileSync(
    "git",
    ["ls-files", "-z", "--", ...paths.map(path => `:(glob)${path}/**`)],
    { cwd: repo, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }
  );
  const tracked = listed.split("\0").filter(Boolean);
  if (tracked.length === 0) {
    throw new Error(`no tracked files under: ${paths.join(", ")}`);
  }
  return tracked.filter(file => existsSync(resolve(repo, file)));
}

/**
 * The package a repository-relative source path belongs to, by its directory
 * under `packages/`: `packages/admin/src/x.tsx` is `admin`.
 *
 * `(?:^|/)` because git reports paths with no leading slash, and a pattern
 * requiring one matches nothing -- which would leave every coverage check
 * with nothing to report.
 */
export function packageOf(path: string): string | undefined {
  return /(?:^|\/)packages\/([^/]+)\/src(?:\/|$)/.exec(path)?.[1];
}

/** The packages a scan's list of directories covers. */
export function packagesIn(dirs: readonly string[]): Set<string> {
  return new Set(
    dirs.map(dir => packageOf(dir)).filter((p): p is string => p !== undefined)
  );
}

/**
 * Every package whose tracked, rendering source holds at least one file the
 * scan would measure, as `measures` decides for that file.
 *
 * Throws when it finds none: the repository uses every utility these scans
 * measure, so an empty answer means the derivation read nothing, and an empty
 * set would satisfy every coverage check against it.
 */
export function packagesMeasuredBy(
  measures: (path: string) => boolean
): Set<string> {
  const found = new Set<string>();
  for (const path of trackedFiles(["packages/*/src"])) {
    if (!rendersUi(path)) continue;
    const pkg = packageOf(path);
    if (pkg === undefined || found.has(pkg)) continue;
    if (measures(path)) found.add(pkg);
  }
  if (found.size === 0) {
    throw new Error("no package uses what this scan measures");
  }
  return found;
}
