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
 * WHAT THIS COVERS, and what it does not.
 *
 * It reads every `.ts`/`.tsx` under the four trees Tailwind compiles for the
 * admin — the admin's own source plus `@nextlyhq/ui` and both plugin admin
 * trees — minus this file, whose fixtures are examples of the thing being
 * forbidden.
 *
 * It does NOT cover stylesheet inputs. A `@source inline(...)` safelist emits
 * utilities whose names it never spells out — `{m,mx}-{8}` contains no class
 * at all — so no text scan of it can answer this question.
 *
 * Nor does it cover MAGNITUDE, which is the larger gap: `--nx-gutter` steps
 * 2rem / 1.5rem / 1rem with the content panel, so a smaller negative cancels
 * the inset at a narrower step while this matches one size. Widening it is not
 * the remedy — measured, that reports nine call sites of which seven are
 * correct, because whether a box sits inside a measured column is not a
 * property of the source either.
 *
 * The BOUNDARY is `e2e/tests/shell/page-measure.spec.ts`, which holds every
 * in-flow child of a rendered measured page to the bounds its own placement
 * gives it. The column, the gutter step in effect and the resolved distance
 * all exist there, and none of them exists here. This scan earns its place by
 * being fast and by naming the FILE, which geometry cannot: it turns "a box
 * left its column" into "this file put it there".
 *
 * That division is why the tree walk is affordable at all: the utility is used
 * nowhere in these trees, so every hit is a finding. A legitimate use would
 * belong in a named exclusion beside `THIS_FILE`, with its reason.
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const ADMIN_SRC = resolve(HERE, "../../../..");
const GLOBALS_CSS = resolve(ADMIN_SRC, "styles/globals.css");

/**
 * The one file allowed to contain these utilities: this one, whose fixtures are
 * examples of the thing being forbidden.
 *
 * A single exclusion, and a self-evident one. Anything else is a finding.
 */
const THIS_FILE =
  "components/features/entries/__tests__/measured-pages-cancel-one-axis.test.ts";

/**
 * Every tree Tailwind reads when it compiles the admin, DERIVED from the
 * stylesheet that declares them.
 *
 * The admin's own source is one of four: `globals.css` also pulls in
 * `@nextlyhq/ui` and both first-party plugin admin trees, because a utility
 * used only there would otherwise be dropped from the build. A class in any of
 * them reaches the same stylesheet, so a scan of one tree answers a narrower
 * question than the one worth asking.
 *
 * Read from the `@source` directives rather than listed here, so a tree added
 * to the build joins this scan in the same edit.
 */
function declaredSources(css: string): string[] {
  // Both quote styles, with the closing one required to MATCH the opening
  // quote. CSS accepts either, so a single-quoted directive is a tree Tailwind
  // compiles and this scan would otherwise never read — and the failure is
  // silent, because the roots already declared keep the membership controls
  // green while the new tree is simply absent.
  return [...css.matchAll(/@source\s+(["'])([^"']+)\1/g)]
    .map(m => m[2])
    .filter(spec => !spec.startsWith("inline("));
}

function scannedRoots(): string[] {
  const declared = declaredSources(readFileSync(GLOBALS_CSS, "utf8"));

  return [
    ADMIN_SRC,
    ...declared.map(spec => resolve(dirname(GLOBALS_CSS), spec)),
  ];
}

/** Every `.ts`/`.tsx` under `root`, as absolute paths. */
function filesUnder(root: string): string[] {
  const found: string[] = [];

  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = `${root}/${entry.name}`;
    if (entry.isDirectory()) found.push(...filesUnder(path));
    else if (/\.tsx?$/.test(entry.name)) found.push(path);
  }

  return found;
}

function sourceFiles(): string[] {
  return scannedRoots().flatMap(filesUnder);
}

/**
 * A negative inset that cancels the page's HORIZONTAL padding, in any variant,
 * any position, and any JSX spelling.
 *
 * Both utilities, because both do it: the two-axis inset cancels the horizontal
 * axis as a side effect, and the horizontal-only one beside a `-my-8`
 * recreates it deliberately.
 *
 * Nothing is anchored on `className="`. Such an anchor checks a SPELLING
 * rather than a class, and a list moved into a `cn(...)` call is an ordinary
 * refactor that would walk straight past it.
 *
 * Comments are not excluded either, because Tailwind does not exclude them: it
 * emits the rule from a sentence that spells the class out exactly as it does
 * from code, and both selectors reach the shipped stylesheet that way. So any
 * complete token anywhere is a finding, and every comment about this utility —
 * in the layouts and in this file — describes it rather than naming it.
 */
/**
 * The two forbidden utilities, ASSEMBLED rather than written.
 *
 * Tailwind scans this file like any other source, so a complete token here —
 * in a fixture or in a sentence — makes it emit the very rule the file exists
 * to forbid. A class assembled at runtime, which no source scan can see, would
 * then find that rule waiting and bleed 64px while this test passed.
 *
 * Split so no scanner sees a whole class. Nothing below writes one either; the
 * prose says "the two-axis inset" and "the horizontal-only inset" for the same
 * reason.
 */
const TWO_AXIS = `-m${"-8"}`;
const HORIZONTAL_ONLY = `-mx${"-8"}`;

/**
 * The one displacement that produced the regression, matched at that size.
 *
 * Deliberately NOT widened to every magnitude, though the gutter's narrowest
 * step is 1rem and a smaller negative cancels it there. Widening was measured:
 * it reports nine call sites, and seven are correct — separators bleeding to
 * the edge of a dropdown, a tab overlapping its neighbour by half a pixel,
 * layout chrome outside any page. An advisory check that fires on correct code
 * gets switched off and takes its true positives with it.
 *
 * The reason it cannot be made both wide and quiet is that the property is not
 * in the source. Whether a negative margin escapes depends on whether the
 * element sits inside a measured page's column and on which gutter step is
 * active, and a file of JSX states neither. So this stays a cheap tripwire for
 * the shape that already regressed once, and the BOUNDARY is
 * `e2e/tests/shell/page-measure.spec.ts`, which asks the rendered geometry —
 * where the column, the gutter and the resolved distance all exist.
 */
const HORIZONTAL_CANCEL = /(?:^|[\s:"'`{(,!])-mx?-8\b/;

describe("a measured entry page", () => {
  it("reads every tree the build reads", () => {
    // Four trees, not one: the admin's own source plus `@nextlyhq/ui` and both
    // plugin admin trees, which `globals.css` pulls in so a utility used only
    // there is not dropped from the build. A class in any of them reaches the
    // same stylesheet.
    const roots = scannedRoots();
    expect(roots).toHaveLength(4);
    expect(roots.some(r => r.endsWith("packages/ui/src"))).toBe(true);

    const files = sourceFiles();
    expect(files.length).toBeGreaterThan(500);
    for (const suffix of [
      "components/features/entries/EntryForm/EntryForm.tsx",
      "components/features/singles/SingleForm.tsx",
      "packages/ui/src/components/page-shell.tsx",
    ]) {
      expect(
        files.some(f => f.endsWith(suffix)),
        `${suffix} is not in the scan`
      ).toBe(true);
    }
  });

  it("reads a source directive in either quote style", () => {
    // The control for the reader itself: a directive it cannot see removes a
    // whole tree from the scan without removing anything from this file's
    // assertions, so every other test here stays green while coverage drops.
    expect(
      declaredSources("@source \"../double\";\n@source '../single';")
    ).toEqual(["../double", "../single"]);
    // A safelist spells out no class, so it is not a tree to walk.
    expect(declaredSources('@source inline("{m,mx}-{8}");')).toEqual([]);
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

    // Both important spellings. Tailwind 4 puts the modifier at the END, and
    // still accepts the leading form; compiled here, `!${HORIZONTAL_ONLY}` and
    // `${HORIZONTAL_ONLY}!` each emit the same declaration with `!important`,
    // so a rule that wins hardest must not be the one that reads as clean. The
    // trailing form was already caught by the quote before it — the leading
    // one was not, because `!` sat outside the boundary class.
    expect(
      HORIZONTAL_CANCEL.test(`<div className="!${HORIZONTAL_ONLY}">`)
    ).toBe(true);
    expect(
      HORIZONTAL_CANCEL.test(`<div className="${HORIZONTAL_ONLY}!">`)
    ).toBe(true);
    expect(
      HORIZONTAL_CANCEL.test(`<div className="@4xl/content:!${TWO_AXIS}">`)
    ).toBe(true);

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

  it("cancels the horizontal inset nowhere but here", () => {
    const offenders = sourceFiles()
      .filter(path => !path.endsWith(THIS_FILE))
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
