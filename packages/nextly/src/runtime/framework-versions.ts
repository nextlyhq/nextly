/**
 * The Next.js, React and React DOM releases nextly runs on, and the check at
 * start that refuses any other.
 *
 * nextly carries no code for older releases: it imports each Next.js and React
 * API it uses directly. So an app outside these ranges is refused once, when
 * nextly starts, naming the installed version and the range, rather than
 * failing later at whichever API it lacks.
 *
 * @module runtime/framework-versions
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import semver from "semver";

import { NextlyError } from "../errors/nextly-error";
import { installedPackageVersion } from "../shared/lib/installed-package-version";

/** The packages whose releases nextly supports, each judged on its own. */
const FRAMEWORK_PACKAGES = ["next", "react", "react-dom"] as const;

export type FrameworkPackage = (typeof FRAMEWORK_PACKAGES)[number];

let ranges: Readonly<Record<FrameworkPackage, string>> | undefined;

/**
 * The supported range of each, read from nextly's own `package.json`: its peer
 * ranges ARE the declaration of what it supports, and the one place a release
 * review moves them. `create-nextly-app` inlines the same peers at its build.
 *
 * Found by walking up from this module to the manifest named `nextly`, so the
 * same read works from source and from the published `dist`.
 */
export function supportedFrameworkRanges(): Readonly<
  Record<FrameworkPackage, string>
> {
  if (ranges) return ranges;
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 20; i++) {
    const path = join(dir, "package.json");
    if (existsSync(path)) {
      const manifest = JSON.parse(readFileSync(path, "utf8")) as {
        name?: string;
        peerDependencies?: Record<string, string>;
      };
      if (manifest.name === "nextly") {
        const peers = manifest.peerDependencies ?? {};
        const missing = FRAMEWORK_PACKAGES.filter(name => !peers[name]);
        if (missing.length > 0) {
          throw NextlyError.internal({
            logContext: {
              reason: `nextly's package.json declares no peer range for ${missing.join(", ")}`,
            },
          });
        }
        ranges = Object.fromEntries(
          FRAMEWORK_PACKAGES.map(name => [name, peers[name]])
        ) as Record<FrameworkPackage, string>;
        return ranges;
      }
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw NextlyError.internal({
    logContext: { reason: "nextly's own package.json was not found" },
  });
}

/** A package installed outside its supported range. */
export interface FrameworkVersionProblem {
  name: FrameworkPackage;
  installed: string;
  supported: string;
}

/**
 * Each of next, react and react-dom the app has installed outside its range,
 * judged independently, so React in range does not vouch for React DOM. A
 * package the app does not have is not judged: nextly also runs where no
 * Next.js app is, as the CLI and in tests. A prerelease (a canary) is outside
 * a range that names none, as semver reads it and as create-nextly-app judges
 * an app it is added to.
 */
export function frameworkVersionProblems(
  appRoot: string,
  installed: (
    appRoot: string,
    name: FrameworkPackage
  ) => string | null = installedPackageVersion
): FrameworkVersionProblem[] {
  const problems: FrameworkVersionProblem[] = [];
  for (const [name, supported] of Object.entries(supportedFrameworkRanges())) {
    const version = installed(appRoot, name as FrameworkPackage);
    if (version === null) continue;
    if (!semver.satisfies(version, supported)) {
      problems.push({
        name: name as FrameworkPackage,
        installed: version,
        supported,
      });
    }
  }
  return problems;
}

/**
 * Refuses to start when any of next, react and react-dom is outside its range.
 * Never continues on a degraded path: the error names each installed version
 * and the range it must be in.
 */
export function assertSupportedFrameworkVersions(
  appRoot: string,
  installed?: (appRoot: string, name: FrameworkPackage) => string | null
): void {
  const problems = frameworkVersionProblems(appRoot, installed);
  if (problems.length === 0) return;
  const named = problems
    .map(p => `${p.name}@${p.installed} (supported: ${p.supported})`)
    .join(", ");
  throw NextlyError.configuration({
    logMessage:
      `nextly cannot start: this app installs ${named}. ` +
      "Install versions inside those ranges.",
    logContext: { problems },
  });
}

/**
 * Whether this process's installed versions passed the check. On `globalThis`
 * so every copy of this module in one process (a server and a rendering layer,
 * a reload in development) shares the answer.
 */
const checked = globalThis as unknown as {
  __nextly_frameworkVersionsChecked?: boolean;
};

/**
 * {@link assertSupportedFrameworkVersions} once per process, at the boot
 * boundary every way of starting nextly shares. Marked as checked only once
 * it passes, so a refused start is refused again on every attempt, and a boot
 * after it pays nothing.
 */
export function ensureSupportedFrameworkVersions(appRoot: string): void {
  if (checked.__nextly_frameworkVersionsChecked) return;
  assertSupportedFrameworkVersions(appRoot);
  checked.__nextly_frameworkVersionsChecked = true;
}
