/**
 * Types for the Node-leg derivation, which is plain ESM so a workflow step and a Vitest suite can
 * both read it without a build step.
 */

/**
 * The exact versions a supported range asks to be tested, given the majors Node has released.
 *
 * A closed clause contributes its FLOOR; an open clause contributes its floor plus every released
 * major above it. Throws on a clause form it does not recognise, rather than returning a shorter
 * list that would pass while covering less.
 */
export function matrixFor(
  range: string,
  releasedMajors: readonly number[]
): string[];

/** The single lowest floor of a range, which is the one leg a pull request runs. */
export function lowestFloor(range: string): string;
