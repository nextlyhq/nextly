/**
 * The builder's chrome on the laptops most authors use: the top bar on one
 * row, and the canvas with room for what it opens.
 *
 * What each asserts, and the broken version it rules out:
 *
 * - At 1280, 1366 and 1440 wide, with the rail and both panels at their
 *   default widths, a long page title and the page data meter showing, every
 *   control in the top bar sits on one row inside the bar, none overlaps
 *   another, and no button's words are cut or wrapped. Only the title is
 *   shortened, with the whole of it in its tooltip; "Save" or "✓ Saved",
 *   "Publish" or "Publish changes" and the active width are whole. A bar that
 *   lets a column overflow draws controls over each other; one that shrinks
 *   every item cuts Save's or Publish's words.
 * - Narrowing the window from 1600 to 1280 with a short, a medium and a long
 *   title, Preview's word gives way only once the title has shortened, and
 *   keeps Preview's name; nothing else shortens or overlaps. A Preview that
 *   drops its word at a fixed width drops it while the short title is still
 *   whole.
 * - At 1280×800 on an empty page, the canvas is at least 480px wide and the
 *   start area is wholly inside it; the picker opened from "＋ Add a block"
 *   is wholly inside it too; and the line naming where a highlighted block
 *   goes is inside it. A panel that takes the canvas's room squeezes the
 *   canvas under its minimum, and a picker placed by the button alone runs
 *   past the canvas's edge.
 *
 * Each test makes its own page, named uniquely, so no lock is needed.
 *
 * @module tests/builder-chrome-fit.spec
 */
import { expect, type Locator, type Page } from "@playwright/test";

import {
  createPage,
  longTitle,
  openBuilder,
  openWithMeter,
  readingLists,
  topBar,
} from "./support/builder-chrome";
import { ownSeat, test } from "./support/test";

const HEADING = "00000000-0000-4000-8000-0000001980a1";
const TEXT = "00000000-0000-4000-8000-0000001980a2";

/** A page with a heading, some text and a list, so the meter has a count. */
const CONTENT = [
  {
    id: HEADING,
    type: "core/heading",
    version: 1,
    props: { text: "A heading on the page", level: "h2" },
  },
  {
    id: TEXT,
    type: "core/text",
    version: 1,
    props: { text: "Some text under it." },
  },
  ...readingLists("00000000-0000-4000-8000-0000001980a"),
];

/** The page data meter in the top bar. */
function meter(page: Page): Locator {
  return topBar(page).locator('.nx-read-meter[data-place="bar"]');
}

/** The title's button, which opens the page switcher. */
function titleButton(page: Page): Locator {
  return topBar(page).getByRole("button", { name: /: switch page$/ });
}

/**
 * The top bar, measured: each control's box and its words, and what each
 * control's words lose to the room (cut, or wrapped past its height).
 * Controls inside another (a split button's halves are two) count apart.
 */
async function measureBar(bar: Locator) {
  return bar.evaluate(header => {
    const box = header.getBoundingClientRect();
    const controls = [
      ...header.querySelectorAll<HTMLElement>(
        "button, [role=button], input, a[href]"
      ),
    ].filter(element => {
      const own = element.getBoundingClientRect();
      return own.width > 0 && own.height > 0;
    });
    const nameOf = (element: HTMLElement) =>
      (element.getAttribute("aria-label") ?? element.textContent ?? "").trim();
    /** Words cut short: an element whose text runs past its own box. */
    const cut = (element: HTMLElement): string[] =>
      [element, ...element.querySelectorAll<HTMLElement>("*")]
        .filter(part => {
          const own = part.getBoundingClientRect();
          // Words kept for a screen reader only (1px, clipped) are not cut.
          if (own.width <= 1 || own.height <= 1) return false;
          if ((part.textContent ?? "").trim() === "") return false;
          return (
            part.scrollWidth > part.clientWidth + 1 ||
            part.scrollHeight > part.clientHeight + 1
          );
        })
        .map(part => (part.textContent ?? "").trim());
    return {
      bar: {
        top: box.top,
        bottom: box.bottom,
        left: box.left,
        right: box.right,
      },
      controls: controls.map(element => {
        const own = element.getBoundingClientRect();
        return {
          name: nameOf(element),
          text: (element.textContent ?? "").trim(),
          top: own.top,
          bottom: own.bottom,
          left: own.left,
          right: own.right,
          cut: cut(element),
        };
      }),
    };
  });
}

type Measured = Awaited<ReturnType<typeof measureBar>>;

/** Pairs of controls whose boxes overlap, by name. */
function overlaps(measured: Measured): string[] {
  const found: string[] = [];
  const { controls } = measured;
  controls.forEach((one, index) => {
    for (const other of controls.slice(index + 1)) {
      const wide =
        Math.min(one.right, other.right) - Math.max(one.left, other.left);
      const tall =
        Math.min(one.bottom, other.bottom) - Math.max(one.top, other.top);
      if (wide > 0.5 && tall > 0.5) found.push(`${one.name} × ${other.name}`);
    }
  });
  return found;
}

/** Controls not wholly inside the bar: a second row, or past an edge. */
function outside(measured: Measured): string[] {
  const { bar } = measured;
  return measured.controls
    .filter(
      control =>
        control.top < bar.top - 0.5 ||
        control.bottom > bar.bottom + 0.5 ||
        control.left < bar.left - 0.5 ||
        control.right > bar.right + 0.5
    )
    .map(control => control.name);
}

/** Whether Preview shows its word, or only its icon. */
async function previewWord(page: Page): Promise<boolean> {
  const word = topBar(page)
    .locator("[data-preview-split]")
    .getByText("Preview", { exact: true });
  const box = await word.evaluate(element => {
    const own = element.getBoundingClientRect();
    return { width: own.width, height: own.height };
  });
  return box.width > 1 && box.height > 1;
}

/** Whether the title is drawn shorter than its words. */
async function titleShortened(page: Page): Promise<boolean> {
  return titleButton(page)
    .locator("span")
    .first()
    .evaluate(element => element.scrollWidth > element.clientWidth + 1);
}

/** Set the window's width and let the bar settle at it. */
async function windowWidth(page: Page, width: number): Promise<void> {
  await page.setViewportSize({ width, height: 800 });
  await expect
    .poll(async () =>
      Math.round((await topBar(page).boundingBox())?.width ?? 0)
    )
    .toBeLessThanOrEqual(width);
  // Two frames, so a measurement taken on resize has been applied.
  await page.evaluate(
    () =>
      new Promise(resolve =>
        requestAnimationFrame(() => requestAnimationFrame(resolve))
      )
  );
}

test.describe("the top bar on a laptop", () => {
  test.describe.configure({ timeout: 240_000 });
  ownSeat(1);

  test("fits one row at 1280, 1366 and 1440 with a long title and the page data meter", async ({
    page,
  }) => {
    const { id, title } = await createPage(page.request, {
      title: longTitle(),
      nodes: CONTENT,
    });
    const { count, limit } = await openWithMeter(page, id, { width: 1440 });
    // The meter, the side panels and the bar's ends are all there before
    // anything is measured, so a missing one cannot pass as fitting.
    await expect(meter(page)).toContainText(`Page data: ${count} of ${limit}`);
    await openLeftPanel(page);
    await expect(
      page.getByRole("complementary", { name: "Inspector" })
    ).toBeVisible();
    const save = topBar(page).locator('[data-action="save"]');
    const publish = topBar(page).locator('[data-action="publish"]');

    for (const width of [1440, 1366, 1280]) {
      await windowWidth(page, width);
      const measured = await measureBar(topBar(page));
      expect(measured.controls.length, `controls at ${width}`).toBeGreaterThan(
        10
      );
      expect(outside(measured), `off the row at ${width}`).toEqual([]);
      expect(overlaps(measured), `overlapping at ${width}`).toEqual([]);
      // Only the title's words may be cut, and the whole title is its tooltip.
      const cut = measured.controls
        .filter(control => !control.name.endsWith(": switch page"))
        .flatMap(control =>
          control.cut.map(words => `${control.name}: ${words}`)
        );
      expect(cut, `words cut at ${width}`).toEqual([]);
      expect(await titleShortened(page), `title shortened at ${width}`).toBe(
        true
      );
      await expect(titleButton(page)).toHaveAttribute("title", title);
      // The words that never shorten, whole and on screen.
      // "✓ Saved" is drawn as a tick and "Saved".
      await expect(save).toHaveText(/^(Save|Saved)$/);
      await expect(publish).toHaveText(/^(Publish|Publish changes|Published)$/);
      const active = topBar(page).locator("[data-nx-active-width]");
      await expect(active).toHaveText(/^\d+px$/);
      await expect(meter(page)).toBeVisible();
    }
  });

  test("shortens the title first, then Preview's word, and nothing else", async ({
    page,
  }) => {
    // Titles of three lengths, so a Preview that gives way at a fixed width
    // is caught on one the bar can still hold whole there.
    const titles = [
      "Spring sale",
      "Spring collection launch",
      "Spring collection launch: linen shirts and sandals",
    ];
    const seen: string[] = [];
    let ordered = 0;
    for (const title of titles) {
      const { id } = await createPage(page.request, { title, nodes: CONTENT });
      await openWithMeter(page, id, { width: 1600 });
      await openLeftPanel(page);
      await expect(titleButton(page)).toBeVisible();
      let titleAt: number | undefined;
      let previewAt: number | undefined;
      // Down to 1280, the editor's narrowest: below it the editor asks for
      // a wider window instead.
      for (let width = 1600; width >= 1280; width -= 20) {
        await windowWidth(page, width);
        const shortened = await titleShortened(page);
        const word = await previewWord(page);
        seen.push(
          `${title} at ${width}: title ${shortened ? "short" : "whole"}, Preview ${word ? "word" : "icon"}`
        );
        if (shortened && titleAt === undefined) titleAt = width;
        if (!word && previewAt === undefined) previewAt = width;
        // Nothing but the title shortens, and nothing overlaps.
        const measured = await measureBar(topBar(page));
        const cut = measured.controls
          .filter(control => !control.name.endsWith(": switch page"))
          .flatMap(control =>
            control.cut.map(words => `${control.name}: ${words}`)
          );
        expect(cut, `words cut at ${width}`).toEqual([]);
        expect(overlaps(measured), `overlapping at ${width}`).toEqual([]);
      }
      // Preview's word gave way only once the title had shortened: at the
      // same width or a narrower one. (The room it frees may then let a short
      // title be whole again.)
      if (previewAt !== undefined) {
        expect(titleAt, seen.join("\n")).toBeDefined();
        expect(titleAt ?? 0, seen.join("\n")).toBeGreaterThanOrEqual(previewAt);
        ordered += 1;
      }
      // Preview keeps its name with or without its word.
      await expect(
        topBar(page)
          .locator("[data-preview-split]")
          .getByRole("button", { name: "Preview" })
          .first()
      ).toBeVisible();
    }
    // Both steps happened on at least one title, so the order was seen.
    expect(ordered, seen.join("\n")).toBeGreaterThan(0);
  });
});

/** Open the left panel on Add, as an author working on the page has it. */
async function openLeftPanel(page: Page): Promise<void> {
  const add = page
    .getByRole("navigation", { name: "Editor panels" })
    .getByRole("button", { name: "Add", exact: true });
  if ((await add.getAttribute("aria-pressed")) !== "true") await add.click();
  await expect(add).toHaveAttribute("aria-pressed", "true");
  await expect(
    page.getByRole("button", { name: "Left panel", exact: true })
  ).toHaveAttribute("aria-pressed", "true");
}

/** The canvas region's box. */
async function canvasBox(page: Page) {
  const box = await page.getByRole("region", { name: "Canvas" }).boundingBox();
  if (box === null) throw new Error("the canvas has no box");
  return box;
}

/** Whether `inner` lies wholly inside `outer`. */
function inside(
  inner: { x: number; y: number; width: number; height: number },
  outer: { x: number; y: number; width: number; height: number }
): boolean {
  return (
    inner.x >= outer.x - 0.5 &&
    inner.y >= outer.y - 0.5 &&
    inner.x + inner.width <= outer.x + outer.width + 0.5 &&
    inner.y + inner.height <= outer.y + outer.height + 0.5
  );
}

async function boxOf(target: Locator) {
  const box = await target.boundingBox();
  if (box === null) throw new Error("no box");
  return box;
}

test.describe("the canvas at 1280×800", () => {
  test.describe.configure({ timeout: 240_000 });
  ownSeat(2);

  test("keeps 480px or more, with the start area and the picker inside it", async ({
    page,
  }) => {
    const { id } = await createPage(page.request, { title: longTitle() });
    await openBuilder(page, id, { width: 1280, height: 800 });
    await expect(
      page.getByRole("complementary", { name: "Inspector" })
    ).toBeVisible();
    const start = page.locator(".nx-page-start");
    await expect(start).toBeVisible({ timeout: 60_000 });
    const canvas = await canvasBox(page);
    expect(canvas.width).toBeGreaterThanOrEqual(480);
    expect(inside(await boxOf(start), canvas), "the start area").toBe(true);

    await start.getByRole("button", { name: "Add a block" }).click();
    const picker = page.getByRole("dialog", { name: "Add a block" });
    await expect(picker).toBeVisible();
    expect(
      inside(await boxOf(picker), await canvasBox(page)),
      "the picker"
    ).toBe(true);
  });

  test("keeps the line naming where a block goes inside it", async ({
    page,
  }) => {
    const { id } = await createPage(page.request, { nodes: CONTENT });
    await openBuilder(page, id, { width: 1280, height: 800 });
    await openLeftPanel(page);
    // A tile pointed at draws the line on the canvas, labelled.
    await page.getByRole("option", { name: "Heading", exact: true }).hover();
    const label = page.locator(".nx-insertion-line__label");
    await expect(label).toBeVisible();
    await expect(label).toHaveText(/ goes /);
    const canvas = await canvasBox(page);
    expect(canvas.width).toBeGreaterThanOrEqual(480);
    expect(inside(await boxOf(label), canvas), "the line's label").toBe(true);
  });
});
