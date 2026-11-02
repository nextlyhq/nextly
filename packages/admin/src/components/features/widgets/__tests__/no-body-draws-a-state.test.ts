/**
 * No card body draws a state of its own: the frame draws every one, from the
 * card's `CardState`, and a body that needs one reports it with `FrameState`.
 *
 * A source check, because the failure it guards against renders: a body that
 * imported a state component would draw a second "could not load" inside a
 * card the frame still calls ready, which is how the two state systems this
 * replaced came about.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

/** The folders whose files draw card bodies. */
const BODIES = [
  resolve(__dirname, "../../dashboard"),
  resolve(__dirname, "../archetypes"),
  resolve(__dirname, "../charts"),
];

/** The state components only the frame may draw. */
const STATE_COMPONENTS =
  /\b(CardEmpty|CardError|CardSkeleton|CardUnavailable)\b/;

function sources(dir: string): string[] {
  return readdirSync(dir, { recursive: true })
    .map(String)
    .filter(
      name =>
        /\.tsx?$/.test(name) &&
        !/\.test\.tsx?$/.test(name) &&
        !name.includes("__tests__")
    )
    .map(name => join(dir, name));
}

describe("card bodies", () => {
  it("import no state component: the frame draws every state", () => {
    const files = BODIES.flatMap(sources);
    // The control: the folders were read, so an empty list cannot pass.
    expect(files.length).toBeGreaterThan(20);
    const offenders = files.filter(file =>
      STATE_COMPONENTS.test(readFileSync(file, "utf8"))
    );
    expect(offenders).toEqual([]);
  });
});
