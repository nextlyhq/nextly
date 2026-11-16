/**
 * The Next.js and React this release of Nextly supports, in one place.
 *
 * Two facts, deliberately kept apart:
 *
 * - `REVIEWED_VERSIONS` is the newest release of each package this Nextly
 *   release was reviewed against. A new app declares it as a `~` range
 *   ({@link scaffoldRange}): patch releases of that minor, never a newer minor
 *   or major that nobody has checked, and never whatever npm's `latest` names
 *   on the day of the scaffold.
 * - `SUPPORTED_RANGES` is every release Nextly works with: the `nextly`
 *   package's own peer ranges, inlined at build, so they are declared once.
 *   Every other package declares the same as its peers. Adding Nextly to an
 *   existing app refuses one whose Next.js, React or React DOM falls outside
 *   them, and a scaffolded plugin declares them as its own peers.
 *
 * Only a release review moves either: a newer Next.js or React is supported
 * once a Nextly release has been checked against it, not before.
 */
export const REVIEWED_VERSIONS = {
  next: "16.4.2",
  "eslint-config-next": "16.4.2",
  react: "19.3.1",
  "react-dom": "19.3.1",
} as const;

/** Inlined at build from the nextly package's peer ranges. */
declare const __NEXTLY_FRAMEWORK_RANGES__: {
  readonly next: string;
  readonly react: string;
  readonly "react-dom": string;
};

export const SUPPORTED_RANGES: {
  readonly next: string;
  readonly react: string;
  readonly "react-dom": string;
} = __NEXTLY_FRAMEWORK_RANGES__;

export type ReviewedPackage = keyof typeof REVIEWED_VERSIONS;
export type SupportedPackage = keyof typeof SUPPORTED_RANGES;

/**
 * The range a new project declares for `pkg`: patch releases of the reviewed
 * minor only. Derived here rather than written out, so the reviewed version is
 * the one thing a release review edits.
 */
export function scaffoldRange(pkg: ReviewedPackage): string {
  return `~${REVIEWED_VERSIONS[pkg]}`;
}
