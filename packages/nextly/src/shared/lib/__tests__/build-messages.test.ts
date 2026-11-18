/**
 * A build failure carried with the editor's places (`withEditorPlaces`) keeps what esbuild said
 * about it: each message's notes, which carry a resolver's explanation or a suggested remedy,
 * reach the message `--verbose` prints, redacted as the messages are.
 */
import { describe, expect, it } from "vitest";

import { withEditorPlaces } from "../build-messages";

/** esbuild's failure for an import it could not resolve, with the notes it attaches. */
function unresolved(notes: { text: string }[]): Error {
  return Object.assign(new Error("Build failed with 1 error"), {
    errors: [
      {
        text: 'Could not resolve "./collections/posts"',
        location: {
          file: "nextly.config.ts",
          line: 2,
          column: 22,
          lineText: 'import { posts } from "./collections/posts";',
        },
        notes,
      },
    ],
  });
}

describe("withEditorPlaces", () => {
  it("keeps each note esbuild attached, after the message it belongs to", () => {
    const carried = withEditorPlaces(
      unresolved([
        {
          text: 'The path "./collections/posts" is not exported by package "app".',
        },
      ])
    );

    expect(carried?.message).toContain(
      'Could not resolve "./collections/posts"'
    );
    expect(carried?.message).toContain(
      'The path "./collections/posts" is not exported by package "app".'
    );
    const message = carried?.message ?? "";
    expect(message.indexOf("Could not resolve")).toBeLessThan(
      message.indexOf("is not exported")
    );
  });

  it("redacts a credential in a note, as it redacts the message", () => {
    const carried = withEditorPlaces(
      unresolved([
        { text: "Tried ./collections/posts?token=hunter2-not-a-real-one" },
      ])
    );

    expect(carried?.message).toContain("Tried ./collections/posts?token=");
    expect(carried?.message).not.toContain("hunter2-not-a-real-one");
  });
});
