/**
 * A refused drop has to REACH the author, and this is the only check that follows the reason the
 * whole way: from the drop rules, through the drag handlers, into something on screen.
 *
 * The unit suites cover each end of that path and neither covers the middle. `canDrop` returning
 * `wrong-parent` and `dropRefusalMessage` turning it into a sentence both stay green when the
 * handler stops calling `setRefusal`, or when the status element stops rendering it — and the
 * symptom of either is an editor that shows nothing, which is exactly the state this feature
 * replaced.
 *
 * ## The separating property
 *
 * "The tree does not change" is NOT it. A canvas that draws nothing satisfies that perfectly, and
 * that canvas is the one being replaced. What separates a working refusal from a silent one is the
 * REASON arriving where the author reads it, so that is what is asserted — against a control drag
 * that must reach a target and say nothing.
 *
 * ## Why "Column" needs no special fixture
 *
 * `core/column` declares `parent: ["core/columns"]`, so every drop zone in an ordinary
 * `core/container` refuses it with `wrong-parent`. The refusal is the shipped registry's own, not
 * one arranged here — a fixture that manufactured a restricted slot would be testing a document
 * nobody authors.
 */
import { expect, test, type Page } from "@playwright/test";

import { dragUntilTarget } from "./driver";
import type { CanvasFixture, Point } from "./driver";
import { FLAT_LIST_FIXTURE, seedPage } from "./fixtures";
import { createPocDriver } from "./poc-driver";

test.describe.configure({ timeout: 240_000 });
// Below roughly 1280px the editor drops the canvas preview entirely, and `mountTree` then times
// out against a canvas that is working.
test.use({ viewport: { width: 2560, height: 1400 } });

/** The element dnd-kit positions under the cursor; the chip and the refusal are inside it. */
const DRAG_OVERLAY = ".nx-pb-drag-overlay";

/**
 * The sentence `wrong-parent` produces, restated rather than imported.
 *
 * The plugin does not export `dropRefusalMessage` from any entry, and widening a package's public
 * surface to let a test read one string is the wrong trade. Restating it errs in the loud
 * direction: a copy change fails here and is confirmed by whoever made it, whereas the exhaustive
 * mapping over every reason is the unit suite's job and stays there.
 */
const WRONG_PARENT_TEXT = "This block can only go inside certain containers.";

/**
 * The centre of one named library entry.
 *
 * Searched for rather than scrolled to. The library is a long scrolling list, so an entry's box
 * can be off-screen while the locator resolves happily — and the search box remounts each category
 * expanded, which puts the match at the top of the panel where a drag can start from it.
 *
 * Exact text, because "Column" and "Columns" are both registered blocks and only one of them is
 * refused by a container.
 */
async function libraryItemCentre(page: Page, label: string): Promise<Point> {
  await page.getByLabel("Search blocks").fill(label);
  const item = page
    .locator(".nx-pb-lib-item")
    .filter({ has: page.getByText(label, { exact: true }) });
  await expect(
    item,
    `exactly one library entry must be labelled "${label}"`
  ).toHaveCount(1);
  const box = await item.boundingBox();
  if (!box) throw new Error(`library entry "${label}" has no box`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/**
 * Drag a named library entry onto a real drop zone, and refuse to return without one.
 *
 * The canvas centre is over dead space as often as not, so reading the overlay straight after
 * arriving would measure a drag with no target — and "no refusal shown" is then true for a reason
 * that has nothing to do with the feature.
 */
async function dragLibraryBlockOntoZone(
  page: Page,
  fixture: CanvasFixture,
  label: string
): Promise<void> {
  const driver = createPocDriver(page);
  await driver.mountTree(fixture);
  const source = await libraryItemCentre(page, label);
  const target = await driver.canvasCentre();
  await driver.startDragAt(source);
  await driver.moveBy(target.x - source.x, target.y - source.y);
  const active = await dragUntilTarget(driver);
  expect(
    active,
    `the "${label}" drag must reach a drop zone before the overlay is read`
  ).toBeGreaterThanOrEqual(0);
}

test("tells the author which rule refused the drop", async ({
  page,
  request,
}) => {
  await dragLibraryBlockOntoZone(
    page,
    await seedPage(request, FLAT_LIST_FIXTURE),
    "Column"
  );

  const overlay = page.locator(DRAG_OVERLAY);
  await expect(
    overlay,
    "the drag overlay must be on screen for its contents to be read"
  ).toHaveCount(1);
  await expect(
    overlay.locator("[data-refused]"),
    "the overlay must mark itself refused while a rule is stopping the drop"
  ).toHaveCount(1);
  // The sentence, in the live region. Both halves matter and they break independently: the text is
  // what a sighted author reads, and `role="status"` is what carries it to one who is not looking
  // at the cursor.
  //
  // Containment rather than equality, because the region also holds an `aria-hidden` refusal mark.
  // A screen reader does not announce that glyph and `textContent` does see it, so an exact match
  // here would be asserting the decoration rather than the sentence.
  await expect(
    overlay.locator('[role="status"]'),
    "the refusal must name the rule where the author reads it"
  ).toContainText(WRONG_PARENT_TEXT);
});

test("says nothing over a target that accepts the block", async ({
  page,
  request,
}) => {
  await dragLibraryBlockOntoZone(
    page,
    await seedPage(request, FLAT_LIST_FIXTURE),
    "Heading"
  );

  // The population first. Silence is the expected result here, and silence is also what a drag
  // that never started, an overlay that never mounted and a broken selector all produce — so the
  // overlay being present is what makes the emptiness below evidence rather than absence.
  const overlay = page.locator(DRAG_OVERLAY);
  await expect(
    overlay,
    "the drag overlay must be on screen for its contents to be read"
  ).toHaveCount(1);
  await expect(
    overlay.locator("[data-refused]"),
    "a container accepts a heading, so nothing may be marked refused"
  ).toHaveCount(0);
  await expect(
    overlay.locator('[role="status"]'),
    "the live region must stay empty rather than carry a stale reason"
  ).toHaveText("");
});
