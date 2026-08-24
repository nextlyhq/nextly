/**
 * A measured page may cancel the page's VERTICAL inset and nothing else.
 *
 * `PageContainer` pads vertically and spends its horizontal inset as GRID
 * COLUMNS, so a two-axis negative inset in a measured page has nothing to pull
 * back from
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
 * WHAT THIS COVERS: every `.ts` and `.tsx` under the admin's source, minus
 * this file, whose fixtures are examples of the thing being forbidden.
 *
 * It covered five named files until a review pointed out that a class list
 * extracted to a constant in a sixth still compiles — Tailwind scans literals
 * across the whole source set — so the list would have gone green while the
 * bleed came back. A list of files to check is a list someone has to remember
 * to extend; scanning the tree is not.
 *
 * This is only affordable because the utility is used NOWHERE else in the
 * admin: measured, every other occurrence is prose explaining its removal. If a
 * legitimate use ever appears, it belongs in a named exclusion beside
 * `THIS_FILE` with the reason, not in a widened pattern.
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const ADMIN_SRC = resolve(HERE, "../../../..");

/**
 * The one file allowed to contain these utilities: this one, whose fixtures are
 * examples of the thing being forbidden.
 *
 * A single exclusion, and a self-evident one. Anything else is a finding.
 */
const THIS_FILE =
  "components/features/entries/__tests__/measured-pages-cancel-one-axis.test.ts";

/** Every `.ts`/`.tsx` under the admin's source, as paths relative to it. */
function sourceFiles(dir = ""): string[] {
  const here = resolve(ADMIN_SRC, dir);
  const found: string[] = [];

  for (const entry of readdirSync(here, { withFileTypes: true })) {
    const path = dir ? `${dir}/${entry.name}` : entry.name;
    if (entry.isDirectory()) found.push(...sourceFiles(path));
    else if (/\.tsx?$/.test(entry.name)) found.push(path);
  }

  return found;
}

/**
 * A negative inset that cancels the page's HORIZONTAL padding, in any variant,
 * any position, and any JSX spelling.
 *
 * Both utilities, because both do it: the two-axis inset cancels the horizontal
 * axis as a side effect, and the horizontal-only one beside a `-my-8`
 * recreates it deliberately. An
 * earlier version matched only the first and carried a control asserting
 * the horizontal-only spelling was fine — which would have let exactly that pairing restore the
 * 64px bleed with this test green.
 *
 * Not anchored on `className="`, which an earlier version was. That anchor
 * makes the check a check on ONE SPELLING rather than on the class: moving the
 * list into a `cn(...)` call is an ordinary refactor and it walked straight
 * past.
 *
 * Comments are NOT excluded, which an earlier version also got wrong. Tailwind
 * scans them like any other text and emits the rule from a sentence that spells
 * the class out. Measured: prose in three files put both selectors into the
 * shipped stylesheet, where a class built at runtime would have found them
 * waiting. So the scan agrees with the scanner — any complete token anywhere is
 * a finding — and the prose in those files, and in this one, describes the
 * utility instead of naming it.
 *
 * This sentence is the demonstration. An earlier draft of it spelled both
 * classes out to explain the hazard, and put them straight back into the
 * stylesheet.
 */
/**
 * The two forbidden utilities, ASSEMBLED rather than written.
 *
 * Tailwind scans this file like any other source, so a complete token here —
 * in a fixture or in a sentence — makes it emit the very rule the file exists
 * to forbid. Measured: an earlier version put both selectors into the shipped
 * stylesheet, which meant a class built at runtime would have found a rule
 * waiting for it and bled 64px while this test passed.
 *
 * Split so no scanner sees a whole class. Nothing below writes one either; the
 * prose says "the two-axis inset" and "the horizontal-only inset" for the same
 * reason.
 */
const TWO_AXIS = `-m${"-8"}`;
const HORIZONTAL_ONLY = `-mx${"-8"}`;

const HORIZONTAL_CANCEL = /(?:^|[\s:"'`{(,])-mx?-8\b/;

describe("a measured entry page", () => {
  it("reads the whole admin, not a list someone maintains", () => {
    // The population was a list of five files until a review pointed out the
    // obvious: a class list extracted to a constant in a SIXTH file still
    // compiles — Tailwind scans literals across the source set — and the list
    // would not have seen it. There is no list now, so there is nothing to
    // forget to update.
    const files = sourceFiles();

    expect(files.length).toBeGreaterThan(500);
    for (const path of [
      "components/features/entries/EntryForm/EntryForm.tsx",
      "components/features/singles/SingleForm.tsx",
      "pages/dashboard/entries/[slug]/create.tsx",
      "pages/dashboard/singles/[slug]/index.tsx",
    ]) {
      expect(files, `${path} is not in the scan`).toContain(path);
    }
  });

  it("sees a two-axis inset when there is one", () => {
    // The control for the check itself: a pattern that matched nothing would
    // report every file clean, including one that had regressed.
    expect(
      HORIZONTAL_CANCEL.test(`<div className="flex lg:${TWO_AXIS}">`)
    ).toBe(true);
    expect(
      HORIZONTAL_CANCEL.test(`<div className="@4xl/content:${TWO_AXIS}">`)
    ).toBe(true);
    // First token, where a class reorder would otherwise hide it.
    expect(HORIZONTAL_CANCEL.test(`<div className="${TWO_AXIS} flex">`)).toBe(
      true
    );
    // And what it must not catch.
    // The pairing that recreates the bleed one utility at a time.
    expect(
      HORIZONTAL_CANCEL.test(`<div className="-my-8 ${HORIZONTAL_ONLY}">`)
    ).toBe(true);
    expect(
      HORIZONTAL_CANCEL.test(
        `<div className="@4xl/content:${HORIZONTAL_ONLY}">`
      )
    ).toBe(true);

    // And what stays allowed: the vertical half alone, and any other size.
    expect(HORIZONTAL_CANCEL.test('<div className="flex lg:-my-8">')).toBe(
      false
    );
    expect(HORIZONTAL_CANCEL.test('<div className="-my-8 flex">')).toBe(false);
    expect(HORIZONTAL_CANCEL.test('<div className="-mx-4">')).toBe(false);

    expect(HORIZONTAL_CANCEL.test(`// cancels ${TWO_AXIS} horizontally`)).toBe(
      true
    );
    // A comment naming the class is NOT an exception. Tailwind scans comments
    // like any other text and emits the rule from one, so prose that spells it
    // out is the same finding as code that does.
    expect(
      HORIZONTAL_CANCEL.test(`{/* \`-my-8\`, not \`${TWO_AXIS}\` */}`)
    ).toBe(true);
  });

  it("cancels the vertical inset nowhere but here", () => {
    const offenders = sourceFiles()
      .filter(path => path !== THIS_FILE)
      .filter(path =>
        HORIZONTAL_CANCEL.test(readFileSync(resolve(ADMIN_SRC, path), "utf8"))
      );

    expect(
      offenders,
      `These cancel a page's horizontal inset. A measured page does not have ` +
        `one — it spends the inset as grid columns — so the content lands ` +
        `outside its own column:\n${offenders.join("\n")}`
    ).toEqual([]);
  });
});
