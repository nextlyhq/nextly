/**
 * The merge that turns one field's live value into a whole-document snapshot.
 *
 * Worth pinning apart from the editor because getting it wrong is silent: a
 * snapshot with the value under the wrong key restores successfully and simply
 * does not contain the author's work.
 */
import { describe, expect, it } from "vitest";

import { withValueAtPath } from "./snapshot-merge";

const DOC = { nodes: [] };

describe("withValueAtPath", () => {
  it("replaces a top-level field and keeps the siblings", () => {
    // The siblings matter: restoring a recovery point replaces the form's
    // values wholesale, so a snapshot missing them blanks the document.
    const result = withValueAtPath(
      { title: "Home", layout: null },
      "layout",
      DOC
    );

    expect(result).toEqual({ title: "Home", layout: DOC });
  });

  it("writes a dotted path INTO the object it names, not as a literal key", () => {
    // The failure this exists to prevent: `{ "hero.layout": doc }` restores
    // cleanly, leaves the real field untouched, and loses the work.
    const result = withValueAtPath(
      { hero: { heading: "Hi", layout: null } },
      "hero.layout",
      DOC
    );

    expect(result).toEqual({ hero: { heading: "Hi", layout: DOC } });
    expect(Object.keys(result)).not.toContain("hero.layout");
  });

  it("writes through an array index", () => {
    const result = withValueAtPath(
      { sections: [{ layout: null }, { layout: "keep" }] },
      "sections.1.layout",
      DOC
    );

    expect(result).toEqual({
      sections: [{ layout: null }, { layout: DOC }],
    });
  });

  it("does not mutate the values it was given", () => {
    // The form owns those objects and is still rendering from them.
    const values = { hero: { layout: null } };
    withValueAtPath(values, "hero.layout", DOC);

    expect(values).toEqual({ hero: { layout: null } });
  });

  it("creates containers a path runs through that do not exist yet", () => {
    // A field can be edited before anything has written its parent, and
    // refusing here would drop the recording for exactly that field.
    const result = withValueAtPath({}, "hero.layout", DOC);

    expect(result).toEqual({ hero: { layout: DOC } });
  });

  it("makes an ARRAY when the next segment is an index", () => {
    // An object with a "0" key serialises differently and restores as an
    // object, so the container's kind is decided by the segment that follows.
    const result = withValueAtPath({}, "sections.0.layout", DOC);

    expect(Array.isArray((result as { sections: unknown }).sections)).toBe(
      true
    );
    expect(result).toEqual({ sections: [{ layout: DOC }] });
  });
});
