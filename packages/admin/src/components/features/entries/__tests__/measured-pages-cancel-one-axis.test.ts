/**
 * A measured page may cancel the page's VERTICAL inset and nothing else.
 *
 * `PageContainer` pads vertically and spends its horizontal inset as GRID
 * COLUMNS, so a `-m-8` inside a measured page has nothing to pull back from
 * horizontally: it pulls the content PAST its own column instead. Measured at a
 * 1600px viewport before this was fixed, the entry editor rendered 960px wide
 * inside an 896px column, and its loading skeleton did the same — so the editor
 * appeared to jump 64px narrower the moment it replaced the skeleton.
 *
 * The class cannot be shared from one constant: Tailwind generates a utility
 * only for a literal it has SEEN, so a class assembled from a variable produces
 * no rule at all. The single source is therefore this check rather than a
 * value, which is why it reads the files instead of importing from them.
 *
 * WHAT THIS COVERS: the five files below and nothing else — the two editors
 * and the three skeletons that stand in for them.
 *
 * Singles is in the list because it had to be. `TranslationPanes` is shared by
 * both editors, and it stops padding where they go edge-to-edge; a Single
 * rendering into an unmeasured page would have been the one consumer still
 * expecting that padding, 64px wider than the pane holding it. Two editors
 * sharing a container cannot answer this differently.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const ADMIN_SRC = resolve(HERE, "../../../..");

/** The editor and both skeletons — the same layout at two moments. */
const MEASURED = [
  "components/features/entries/EntryForm/EntryForm.tsx",
  "components/features/singles/SingleForm.tsx",
  "pages/dashboard/entries/[slug]/create.tsx",
  "pages/dashboard/entries/[slug]/[id]/index.tsx",
  "pages/dashboard/singles/[slug]/index.tsx",
];

/**
 * A two-axis negative inset, in any variant and any position.
 *
 * `-m-8` and `lg:-m-8` are the same mistake at different breakpoints; so is
 * `-m-8` written FIRST, where a `^` anchor is useless because the pattern has
 * already consumed `className="`. The opening quote is therefore a boundary
 * alongside whitespace and the variant colon, or a class reorder restores the
 * bleed while this stays green.
 *
 * Prose about it is not a mistake — the comment explaining why the horizontal
 * half is gone necessarily names it, which is why this reads a `className`
 * rather than the file.
 */
const BOTH_AXES = /className="(?:[^"]*[\s:])?-m-8\b/;

describe("a measured entry page", () => {
  it("reads the files it names", () => {
    // Every assertion below is about file CONTENT, and an unreadable path has
    // none — so it would pass by silence.
    for (const path of MEASURED) {
      expect(
        readFileSync(resolve(ADMIN_SRC, path), "utf8").length,
        `${path} is empty or unreadable`
      ).toBeGreaterThan(0);
    }
  });

  it("sees a two-axis inset when there is one", () => {
    // The control for the check itself: a pattern that matched nothing would
    // report every file clean, including one that had regressed.
    expect(BOTH_AXES.test('<div className="flex lg:-m-8">')).toBe(true);
    expect(BOTH_AXES.test('<div className="@4xl/content:-m-8">')).toBe(true);
    // First token, where a `^` anchor cannot help: the pattern has already
    // consumed `className="`, so the opening quote has to be a boundary too.
    // A class reorder would otherwise restore the bleed unseen.
    expect(BOTH_AXES.test('<div className="-m-8 flex">')).toBe(true);
    // And what it must not catch.
    expect(BOTH_AXES.test('<div className="flex lg:-my-8">')).toBe(false);
    expect(BOTH_AXES.test('<div className="-my-8 flex">')).toBe(false);
    // `-mx-8` is a different utility; the boundary must not swallow it.
    expect(BOTH_AXES.test('<div className="-mx-8">')).toBe(false);
    expect(BOTH_AXES.test("{/* `-my-8`, not `-m-8`, because … */}")).toBe(
      false
    );
  });

  it("cancels the vertical inset only", () => {
    const offenders = MEASURED.filter(path =>
      BOTH_AXES.test(readFileSync(resolve(ADMIN_SRC, path), "utf8"))
    );

    expect(
      offenders,
      `These cancel the page's horizontal inset, which a measured page does ` +
        `not have — the content lands outside its own column:\n${offenders.join("\n")}`
    ).toEqual([]);
  });
});
