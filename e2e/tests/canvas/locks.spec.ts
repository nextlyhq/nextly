import { expect, type Page } from "@playwright/test";

import { CANVAS_FRAME, canvasLayer } from "../support/canvas-frame";
import { includingHidden, test } from "../support/test";

import {
  announcer,
  block,
  boxOf,
  clickBlock,
  selection,
} from "./editor-driver";

/**
 * The editor inside locked areas, as an author meets it.
 *
 * On `/builder-locks`, a harness mounting the shipped editor (its store, shell,
 * canvas, toolbar, keyboard actions, inserter, inspector and repair notice)
 * over a page holding a row locked "all", a row locked "insert" and a card
 * locked "contentOnly". Every refusal below is the editor's own; the harness
 * judges nothing.
 *
 * Each refusal is paired with a control the same gesture is allowed on, so a
 * test cannot pass on a gesture that did nothing at all. "Nothing changed" is
 * asked of the store, through the tree and undo depth the harness reports.
 */

const ROUTE = "/builder-locks";

const FIXED =
  "This area of Fixed row is locked. Its blocks can't be added, removed or moved.";
const SEALED_DESIGN =
  "This area of Sealed card is locked to its content. Heading's design and settings can't change here.";

/** The block tree the store holds, as ids: `[id, [children]]` for a container. */
async function tree(page: Page): Promise<unknown> {
  const raw = await page
    .getByTestId("locks-harness")
    .getAttribute("data-nx-tree");
  return JSON.parse(raw ?? "null");
}

async function undoDepth(page: Page): Promise<number> {
  return Number(
    await page.getByTestId("locks-harness").getAttribute("data-nx-undo-depth")
  );
}

async function open(page: Page, seed?: "broken"): Promise<void> {
  await page.goto(seed === undefined ? ROUTE : `${ROUTE}?seed=${seed}`);
  // The canvas's frame first, one of it, and on screen: the route streams the harness, and until the
  // stream is swapped in its first copy waits in a hidden container, so a
  // frame counted then is not the one the page keeps.
  await expect
    .poll(
      () =>
        page
          .locator(CANVAS_FRAME)
          .evaluateAll(
            frames =>
              frames.length === 1 && (frames[0] as HTMLElement).offsetWidth > 0
          ),
      { timeout: 30_000 }
    )
    .toBe(true);
  // On screen before anything is aimed at it, as the editor suite waits.
  await expect(await block(page, "lk-free-text")).toBeVisible({
    timeout: 30_000,
  });
}

const PLACED = [
  "lk-free-heading",
  ["lk-row", ["lk-row-heading", "lk-row-text"]],
  ["lk-loose", ["lk-loose-heading", "lk-loose-text"]],
  ["lk-card", ["lk-card-heading"]],
  "lk-free-text",
];

test.describe("the editor inside locked areas", () => {
  test("opens on the page as placed", async ({ page }) => {
    // The population, before any claim about behaviour.
    await open(page);
    expect(await tree(page)).toEqual(PLACED);
    await expect(
      page.getByRole("region", { name: "Repair this page" })
    ).toHaveCount(0);
  });

  test("refuses a keyboard move inside a slot locked all, and says why", async ({
    page,
  }) => {
    await open(page);
    await clickBlock(page, "lk-row-text");
    expect(await selection(page)).toEqual(["lk-row-text"]);
    await page.keyboard.press("Alt+ArrowUp");

    await expect(announcer(page)).toHaveText(FIXED);
    expect(await tree(page)).toEqual(PLACED);
    expect(await undoDepth(page)).toBe(0);

    // The control: a slot locked "insert" lets its blocks be reordered.
    await clickBlock(page, "lk-loose-text");
    await page.keyboard.press("Alt+ArrowUp");
    await expect
      .poll(() => tree(page))
      .toEqual([
        "lk-free-heading",
        ["lk-row", ["lk-row-heading", "lk-row-text"]],
        ["lk-loose", ["lk-loose-text", "lk-loose-heading"]],
        ["lk-card", ["lk-card-heading"]],
        "lk-free-text",
      ]);
  });

  test("refuses a drop into a slot locked all before the drop, and drops nothing", async ({
    page,
  }) => {
    await open(page);
    const from = await boxOf(page, "lk-free-heading");
    const onto = await boxOf(page, "lk-row-heading");
    await page.mouse.move(from.x + 6, from.y + from.height / 2);
    await page.mouse.down();
    // Past the drag threshold first, so the press is read as a drag.
    await page.mouse.move(from.x + 6, from.y + from.height / 2 + 14, {
      steps: 4,
    });
    // Over the lower part of the row's heading: a place inside the row.
    await page.mouse.move(onto.x + 40, onto.y + onto.height * 0.8, {
      steps: 20,
    });

    // Refused while the pointer is still over it, in the lock's words, drawn
    // over the frame in the editor's document.
    const notice = canvasLayer(page).locator(".nx-drop-refusal");
    await expect(notice).toContainText("This area of Fixed row is locked.");
    // The neutral notice Layers draws too: the editor's surface with a red
    // edge and a warning mark, not a red fill.
    const look = await notice.evaluate(element => {
      const style = getComputedStyle(element);
      return {
        fill: style.backgroundColor,
        edge: style.borderLeftColor,
        edgeWidth: style.borderLeftWidth,
        mark: element.querySelector("svg") !== null,
      };
    });
    expect(look.edgeWidth).toBe("3px");
    expect(look.mark).toBe(true);
    expect(look.fill).not.toBe(look.edge);
    await page.mouse.up();
    expect(await tree(page)).toEqual(PLACED);
    expect(await undoDepth(page)).toBe(0);
  });

  test("dims delete and duplicate inside a slot locked all, with the reason", async ({
    page,
  }) => {
    await open(page);
    await clickBlock(page, "lk-row-heading");
    for (const name of ["Delete", "Duplicate"]) {
      const verb = page.getByRole("button", { name, exact: true });
      await expect(verb).toHaveAttribute("aria-disabled", "true");
      await expect(verb).toHaveAttribute("title", FIXED);
    }
    // Pressing it anyway changes nothing. Forced, because Playwright will not
    // click a control marked aria-disabled, and the bar keeps it reachable on
    // purpose so the reason can be read.
    await page
      .getByRole("button", { name: "Delete", exact: true })
      .click({ force: true });
    expect(await tree(page)).toEqual(PLACED);

    // The control: a free block's verbs are live.
    await clickBlock(page, "lk-free-text");
    await expect(
      page.getByRole("button", { name: "Delete", exact: true })
    ).not.toHaveAttribute("aria-disabled", "true");
  });

  test("adds after a slot locked all rather than into it, and says where", async ({
    page,
  }) => {
    await open(page);
    await clickBlock(page, "lk-row-heading");
    // The rail's button for the panel holding the inserter.
    await page.locator('button[data-panel="add"]').click();
    const heading = page.getByRole("option", { name: "Heading", exact: true });
    // The row refuses every block, so a tile climbs past it and says so.
    await expect(heading).toHaveAccessibleDescription(
      /^Goes after Fixed row\./,
      { timeout: 15_000 }
    );
    await heading.click();

    const placed = (await tree(page)) as unknown[];
    expect(placed).toHaveLength(PLACED.length + 1);
    // The row as it was, and the new block straight after it.
    expect(placed[1]).toEqual(PLACED[1]);
    expect(typeof placed[2]).toBe("string");
    expect(placed.slice(3)).toEqual(PLACED.slice(2));

    // The control: after a free block, a tile goes where the line says, with
    // nothing to add about it.
    await clickBlock(page, "lk-free-text");
    await expect(heading).not.toHaveAccessibleDescription(/Goes/);
  });

  test("shows a block's design read-only inside contentOnly, its content editable", async ({
    page,
  }) => {
    await open(page);
    await clickBlock(page, "lk-card-heading");

    await expect(page.getByText(SEALED_DESIGN)).toBeVisible();
    await expect(page.getByLabel("Text", { exact: true })).toBeEnabled();
    // Level is a row of radio buttons; the held block holds every one.
    await expect(
      page.getByRole("radiogroup", { name: "Level" }).getByRole("radio").first()
    ).toBeDisabled();
    // The block's own lock is held with its design: the card's menu shows
    // Lock disabled, with the reason.
    await page.getByRole("button", { name: "Actions for Heading" }).click();
    await expect(page.getByRole("menuitem", { name: /^Lock/ })).toBeDisabled();
    await page.keyboard.press("Escape");
    // Content still saves through the store.
    const text = page.getByLabel("Text", { exact: true });
    await text.fill("Spring sale");
    await text.blur();
    await expect.poll(() => undoDepth(page)).toBe(1);

    // The Style tab is shown, every control that edits held. A section's
    // toggle, the state switcher and the edit-target chips only choose what
    // is shown; a shared style's chip is held with the design, which the
    // builder's own tests cover, as this harness has no shared styles.
    await page.getByRole("tab", { name: "Style" }).click();
    await expect(
      page.getByRole("button", { name: "This block", exact: true })
    ).toHaveAttribute("aria-pressed", "true");
    const controls = page
      .getByRole("tabpanel")
      .locator(
        'input, button:not([aria-expanded]):not([role="radio"]):not([data-target-chip]), select, textarea'
      );
    expect(await controls.count()).toBeGreaterThan(0);
    for (const control of await controls.all()) {
      await expect(control).toBeDisabled();
    }

    // The control: a free heading's level is editable.
    await clickBlock(page, "lk-free-heading");
    await page.getByRole("tab", { name: "Content" }).click();
    await expect(
      page.getByRole("radiogroup", { name: "Level" }).getByRole("radio").first()
    ).toBeEnabled();
    await expect(includingHidden(page).getByText(SEALED_DESIGN)).toHaveCount(0);
  });
});

test.describe("repairing a page stored before its locks were enforced", () => {
  const BROKEN = [
    ["lk-row", ["lk-row-heading", "lk-row-text", "lk-row-extra"]],
    [
      "lk-shelf",
      [
        [
          "lk-shelf-row",
          ["lk-shelf-heading", "lk-shelf-text", "lk-shelf-extra"],
        ],
      ],
    ],
    "lk-free-text",
  ];

  test("shows what will move, and changes nothing until confirmed", async ({
    page,
  }) => {
    await open(page, "broken");
    expect(await tree(page)).toEqual(BROKEN);
    const notice = page.getByRole("region", { name: "Repair this page" });
    await notice.getByRole("button", { name: "Review the repair" }).click();

    await expect(notice.getByRole("listitem")).toHaveText([
      "Move Text out of Fixed row's locked area, to just after Fixed row.",
      "Move Text out of Fixed row's locked area, to just after Sealed shelf.",
    ]);
    expect(await tree(page)).toEqual(BROKEN);
    expect(await undoDepth(page)).toBe(0);

    await notice.getByRole("button", { name: "Cancel" }).click();
    expect(await tree(page)).toEqual(BROKEN);
  });

  test("keeps every block, leaves the outer area's blocks alone, and is one undo", async ({
    page,
  }) => {
    await open(page, "broken");
    const notice = page.getByRole("region", { name: "Repair this page" });
    await notice.getByRole("button", { name: "Review the repair" }).click();
    await notice.getByRole("button", { name: "Repair" }).click();

    // Each block the author placed is still there, under its own id. The
    // shelf's own block moved out to just after the SHELF, so the shelf still
    // holds only the row it starts with.
    await expect
      .poll(() => tree(page))
      .toEqual([
        ["lk-row", ["lk-row-heading", "lk-row-text"]],
        "lk-row-extra",
        ["lk-shelf", [["lk-shelf-row", ["lk-shelf-heading", "lk-shelf-text"]]]],
        "lk-shelf-extra",
        "lk-free-text",
      ]);
    expect(await undoDepth(page)).toBe(1);
    await expect(
      page.getByRole("region", { name: "Repair this page" })
    ).toHaveCount(0);

    // One undo takes the whole repair back, and the notice with it.
    await clickBlock(page, "lk-free-text");
    // Control, not ControlOrMeta: the editor reads `mod` from the platform the
    // browser reports, and this suite's device reports Windows on every host.
    await page.keyboard.press("Control+z");
    await expect.poll(() => tree(page)).toEqual(BROKEN);
    await expect(
      page.getByRole("region", { name: "Repair this page" })
    ).toBeVisible();
  });
});
