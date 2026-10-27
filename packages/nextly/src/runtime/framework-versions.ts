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
import semver from "semver";

import { NextlyError } from "../errors/nextly-error";
import { installedPackageVersion } from "../shared/lib/installed-package-version";

/**
 * The supported ranges, the ones every package declares as peers. The home of
 * these ranges is `create-nextly-app`'s `supported-versions.ts`, which nextly
 * cannot import; `scripts/supported-peer-ranges.test.mjs` holds this copy equal
 * to it.
 */
export const SUPPORTED_FRAMEWORK_RANGES = {
  next: "^16.4.1",
  react: "^19.3.0",
  "react-dom": "^19.3.0",
} as const;

export type FrameworkPackage = keyof typeof SUPPORTED_FRAMEWORK_RANGES;

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
 * Next.js app is, as the CLI and in tests. A prerelease of a supported major
 * (a canary) counts as in range.
 */
export function frameworkVersionProblems(
  appRoot: string,
  installed: (
    appRoot: string,
    name: FrameworkPackage
  ) => string | null = installedPackageVersion
): FrameworkVersionProblem[] {
  const problems: FrameworkVersionProblem[] = [];
  for (const [name, supported] of Object.entries(SUPPORTED_FRAMEWORK_RANGES)) {
    const version = installed(appRoot, name as FrameworkPackage);
    if (version === null) continue;
    if (!semver.satisfies(version, supported, { includePrerelease: true })) {
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
  throw new NextlyError({
    code: "CONFIGURATION_ERROR",
    statusCode: 500,
    publicMessage: "Server configuration error.",
    logMessage:
      `nextly cannot start: this app installs ${named}. ` +
      "Install versions inside those ranges.",
    logContext: { problems },
  });
}
