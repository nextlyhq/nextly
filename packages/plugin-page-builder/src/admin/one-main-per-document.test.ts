/**
 * The editor contributes no `<main>`, because the page it mounts into already has one.
 *
 * HTML allows a single non-hidden `main` per document. A second one is invalid markup, gives
 * assistive technology two competing primary landmarks, and makes every strict `main` locator
 * ambiguous — which is how this surfaced: `e2e/tests/support/admin.ts` waits on
 * `page.locator("main")`, and Playwright's strict mode fails a locator that resolves to two
 * elements, so whole canvas specs died before reaching their own assertions.
 *
 * Asserted over the SOURCE of every admin component rather than by rendering one of them. The
 * editor mounts a live drag-and-drop provider and an iframe canvas, so rendering the tree here
 * would test the harness as much as the markup; and a render-based check only covers the
 * components that particular fixture happens to reach, while a new pane added tomorrow is
 * exactly the regression this exists to catch.
 *
 * **KNOWN BLIND SPOT, stated rather than left to be discovered.** The scan reads THIS package's
 * admin directory. The editor's chrome now comes from `@nextlyhq/builder`, which is outside that
 * population — so a `<main>` added there passes this check silently. That is not hypothetical:
 * the shell DID render one, and this file did not catch it. What went red was the canvas-landmark
 * assertion below, for an adjacent reason, which happened to land on the real defect.
 *
 * Widening the population to cover `packages/builder/src` is the actual repair and is tracked
 * separately. Until then, read a green result here as "this package adds no second landmark",
 * never as "the document has one `main`".
 */
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const ADMIN_DIR = dirname(fileURLToPath(import.meta.url));

/** Every component source under the admin surface. */
function componentSources(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...componentSources(full));
    else if (/\.tsx$/.test(entry.name) && !/\.test\.tsx$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

/**
 * A `<main>` opening tag, whether bare or carrying attributes.
 *
 * `<main>` and `<main className=...>` both count; `<mainstay>` does not, which is what the
 * boundary character rules out.
 */
const OPENS_A_MAIN = /<main[\s/>]/;

describe("the editor adds no second landmark", () => {
  const sources = componentSources(ADMIN_DIR);

  it("reads the admin components, so the assertion is not vacuous", () => {
    // Positive control. An empty list would satisfy the check below while proving nothing.
    expect(sources.length).toBeGreaterThan(0);
    expect(sources.some(f => f.endsWith("EditorSurface.tsx"))).toBe(true);
  });

  it("renders no <main> anywhere in the editor", () => {
    const offenders = sources.filter(file =>
      OPENS_A_MAIN.test(readFileSync(file, "utf8"))
    );

    expect(offenders).toEqual([]);
  });

  it("delegates the canvas landmark to the shell rather than dropping it", () => {
    // The labelled canvas region used to be markup in this file. It now comes from
    // `BuilderShell`, which renders `<section aria-label="Canvas">` for the same reason
    // this test exists. Asserting the delegation keeps the landmark's ABSENCE from
    // reading as a pass: a surface that stopped rendering the shell would lose the
    // region entirely, and nothing else here would notice.
    const surface = readFileSync(join(ADMIN_DIR, "EditorSurface.tsx"), "utf8");

    expect(surface).toContain("<BuilderShell");
    expect(surface).toContain("<Canvas />");
  });
});
