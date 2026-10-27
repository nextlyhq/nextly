/**
 * A watcher's readiness line is found however its stream is cut into chunks.
 */
import { describe, expect, it } from "vitest";

import { announcementReader } from "./watch-readiness.mjs";

const PHRASE = "Watching for file changes";

describe("announcementReader", () => {
  it("finds the phrase in a single chunk", () => {
    const read = announcementReader(PHRASE);
    expect(read("Starting compilation in watch mode...\n")).toBe(false);
    expect(read("Found 0 errors. Watching for file changes.\n")).toBe(true);
  });

  it("finds the phrase split at every position between two chunks", () => {
    const line = `12:00:00 - Found 0 errors. ${PHRASE}.\n`;
    for (let cut = 1; cut < line.length; cut += 1) {
      const read = announcementReader(PHRASE);
      const answers = [read(line.slice(0, cut)), read(line.slice(cut))];
      // Whatever the cut, the line has been read by the last chunk. A cut
      // inside the phrase leaves it whole in neither half, which is the case
      // a test of each chunk alone answers false to.
      expect(answers.at(-1), `cut at ${cut}`).toBe(true);
    }
  });

  it("finds the phrase delivered one character at a time", () => {
    const read = announcementReader(PHRASE);
    const answers = [...`noise ${PHRASE} more`].map(read);
    expect(answers.indexOf(true)).toBe(`noise ${PHRASE}`.length - 1);
  });

  it("stays silent on output that never says it, and stays true once it has", () => {
    const read = announcementReader(PHRASE);
    expect(read("Watching for file")).toBe(false);
    expect(read(" edits")).toBe(false);
    expect(read(PHRASE)).toBe(true);
    expect(read("anything else")).toBe(true);
  });
});
