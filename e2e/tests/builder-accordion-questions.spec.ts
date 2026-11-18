/**
 * An Accordion in the real editor.
 *
 * - Added from the Add panel, it holds three questions, "Question 1" to
 *   "Question 3", each with "Write the answer here.". A question is called
 *   "Question" in the Add panel, Layers and the panel's header.
 * - Its settings: Open (One at a time), First open on, Titles as Heading 3,
 *   and Icon (+ / −) in Content, Icon position in Style. A question's "Open
 *   by default" shows only once the accordion opens Many.
 * - With the accordion or a question selected, "+ Add a question" under the
 *   last question adds "Question 4", opens it on the canvas and puts the
 *   cursor in its title, which is then typed on the canvas.
 * - A question holds any block, and an open question emptied of its answer
 *   draws the empty-container start under its title.
 *
 * Each test makes its own page, named uniquely, so no lock is needed.
 *
 * @module tests/builder-accordion-questions.spec
 */
import { expect, type APIRequestContext, type Page } from "@playwright/test";

import {
  block,
  layerRow,
  openLayers,
  pressSave,
  selection,
  structure,
} from "./canvas/editor-driver";
import { gotoAdmin } from "./support/admin";
import { canvasFrame } from "./support/canvas-frame";
import { storedPageNodes } from "./support/stored-page";
import { test } from "./support/test";

const ENTRIES = "/admin/api/collections/pages/entries";
const HEADING = "00000000-0000-4000-8000-0000000b0a01";
const ACCORDION = "00000000-0000-4000-8000-0000000b0a02";
const question = (n: number) =>
  `00000000-0000-4000-8000-0000000b0b${String(n).padStart(2, "0")}`;

/** A unique suffix for this run's names. */
const stamp = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

/** One Text's stored words. */
function words(text: string) {
  return {
    root: {
      type: "root",
      children: [
        { type: "paragraph", children: [{ type: "text", text, format: 0 }] },
      ],
    },
  };
}

/** A draft page holding these blocks, and its id. */
async function createPage(
  request: APIRequestContext,
  nodes: unknown[]
): Promise<string> {
  const slug = `accordion-questions-${stamp()}`;
  const created = await request.post(ENTRIES, {
    data: {
      title: `Accordion ${slug}`,
      slug,
      status: "draft",
      content: { formatVersion: 1, kind: "page", nodes },
    },
  });
  expect(created.ok(), await created.text()).toBe(true);
  return ((await created.json()) as { item: { id: string } }).item.id;
}

/** An accordion of three questions, the first holding `first` as its answer. */
function accordionNode(first: unknown[] = []) {
  return {
    id: ACCORDION,
    type: "core/accordion",
    version: 1,
    props: { openMode: "one", firstOpen: true, titlesAs: "h3" },
    slots: {
      children: [1, 2, 3].map(n => ({
        id: question(n),
        type: "core/accordion-item",
        version: 1,
        props: { title: `Question ${n}`, open: false },
        slots: {
          children:
            n === 1
              ? first
              : [
                  {
                    id: question(30 + n),
                    type: "core/text",
                    version: 2,
                    props: { text: words(`Answer ${n}`) },
                  },
                ],
        },
      })),
    },
  };
}

async function openBuilder(page: Page, id: string): Promise<void> {
  await page.setViewportSize({ width: 1440, height: 900 });
  await gotoAdmin(page, `/collections/pages/${id}/builder?field=content`);
  await expect(page.getByRole("region", { name: "Canvas" })).toBeVisible({
    timeout: 60_000,
  });
}

/** Select a question by its title on the canvas. */
async function selectQuestion(page: Page, id: string): Promise<void> {
  await (await block(page, id))
    .locator(".nx-pb-disclosure-title")
    .first()
    .click();
  await expect.poll(() => selection(page)).toEqual([id]);
}

/** A section of the shown tab, opened if it is closed. */
async function openSection(page: Page, panel: string, name: string) {
  const tabPanel = page.getByRole("tabpanel", { name: panel });
  const heading = tabPanel.getByRole("button", {
    name: new RegExp(`^${name}`),
  });
  if ((await heading.getAttribute("aria-expanded")) !== "true") {
    await heading.click();
  }
  await expect(heading).toHaveAttribute("aria-expanded", "true");
  return tabPanel;
}

/** The block panel's Content or Style tab. */
async function tab(page: Page, name: "Content" | "Style") {
  await page.getByRole("tab", { name }).click();
  return page.getByRole("tabpanel", { name });
}

test.describe("an Accordion in the editor", () => {
  test.describe.configure({ timeout: 240_000 });

  test("added from the Add panel, it holds three numbered questions, each named Question", async ({
    page,
  }) => {
    const id = await createPage(page.request, [
      {
        id: HEADING,
        type: "core/heading",
        version: 1,
        props: { text: "Questions", level: "h2" },
      },
    ]);
    await openBuilder(page, id);
    await canvasFrame(page)
      .locator(`.nx-canvas [data-nx-node="${HEADING}"]`)
      .click();
    await page
      .getByRole("navigation", { name: "Editor panels" })
      .getByRole("button", { name: "Add", exact: true })
      .click();
    await page.getByRole("option", { name: "Accordion", exact: true }).click();
    await expect.poll(async () => (await selection(page)).length).toBe(1);
    const [added] = await selection(page);
    const questions = (await structure(page))
      .filter(entry => entry.startsWith(`${added}>`))
      .map(entry => entry.slice(String(added).length + 1));
    expect(questions).toHaveLength(3);
    const accordion = await block(page, String(added));
    await expect(accordion.locator("summary h3")).toHaveText([
      "Question 1",
      "Question 2",
      "Question 3",
    ]);
    await expect(
      accordion.locator("details").first().getByText("Write the answer here.")
    ).toBeVisible();

    // Its settings, as a new accordion starts.
    const content = await tab(page, "Content");
    await expect(content.getByRole("combobox", { name: "Open" })).toHaveText(
      "One at a time"
    );
    await expect(
      content.getByRole("switch", { name: "First open" })
    ).toBeChecked();
    await expect(
      content.getByRole("combobox", { name: "Titles as" })
    ).toHaveText("Heading 3");
    const icon = (await openSection(page, "Content", "Icon")).getByRole(
      "radiogroup",
      { name: "Icon" }
    );
    await expect(icon.getByRole("radio", { name: "+ / −" })).toHaveAttribute(
      "aria-checked",
      "true"
    );
    const style = await tab(page, "Style");
    await expect(style.getByRole("radiogroup", { name: "Icon" })).toHaveCount(
      0
    );

    // A question is called Question: in the Add panel, the header and Layers.
    await selectQuestion(page, String(questions[1]));
    await expect(page.locator("[data-block-card]")).toContainText("Question");
    // Not the old name, which "Question 2" alone would not tell apart.
    await expect(page.locator("[data-block-card]")).not.toContainText(
      "Accordion item"
    );
    await expect(
      page.getByRole("option", { name: "Question", exact: true })
    ).toBeVisible();
    await openLayers(page);
    await expect(layerRow(page, String(questions[1]))).toContainText(
      "Question"
    );
    await expect(layerRow(page, String(questions[1]))).not.toContainText(
      "Accordion item"
    );

    // Its Open by default shows only once the accordion opens Many.
    const own = await tab(page, "Content");
    await expect(
      own.getByRole("switch", { name: "Open by default" })
    ).toHaveCount(0);
    // The accordion selected from its own Layers row.
    await page
      .locator(`[data-nx-layer="${String(added)}"]`)
      .first()
      .click();
    await expect.poll(() => selection(page)).toEqual([added]);
    const behaviour = await tab(page, "Content");
    await behaviour.getByRole("combobox", { name: "Open" }).click();
    await page.getByRole("option", { name: "Many" }).click();
    await selectQuestion(page, String(questions[1]));
    await expect(
      (await tab(page, "Content")).getByRole("switch", {
        name: "Open by default",
      })
    ).toBeVisible();
  });

  test("+ Add a question adds Question 4, opens it, and puts the cursor in its title", async ({
    page,
  }) => {
    const id = await createPage(page.request, [
      accordionNode(),
      {
        id: HEADING,
        type: "core/heading",
        version: 1,
        props: { text: "After the questions", level: "h2" },
      },
    ]);
    await openBuilder(page, id);
    await selectQuestion(page, question(2));
    const add = page.getByRole("button", { name: "Add a question" });
    await expect(add).toBeVisible();
    // Under the last question, never over it, nor over the block after.
    const last = await (await block(page, question(3))).boundingBox();
    const after = await (await block(page, HEADING)).boundingBox();
    const button = await add.boundingBox();
    expect(button?.y ?? 0).toBeGreaterThanOrEqual(
      (last?.y ?? 0) + (last?.height ?? 0) - 1
    );
    expect((button?.y ?? 0) + (button?.height ?? 0)).toBeLessThanOrEqual(
      (after?.y ?? 0) + 1
    );
    // Reached and pressed from the keyboard.
    await add.focus();
    await page.keyboard.press("Enter");

    await expect
      .poll(async () =>
        (await structure(page)).filter(entry =>
          entry.startsWith(`${ACCORDION}>`)
        )
      )
      .toHaveLength(4);
    const [fourth] = await selection(page);
    const added = await block(page, String(fourth));
    await expect(added.locator("summary h3")).toHaveText("Question 4");
    // Open on the canvas, its answer shown; with one at a time, the others
    // closed.
    await expect
      .poll(() =>
        added.evaluate(element => (element as HTMLDetailsElement).open)
      )
      .toBe(true);
    await expect(added.getByText("Write the answer here.")).toBeVisible();
    for (const n of [1, 2, 3]) {
      expect(
        await (
          await block(page, question(n))
        ).evaluate(element => (element as HTMLDetailsElement).open)
      ).toBe(false);
    }
    // The cursor in its title.
    await expect
      .poll(() =>
        added.evaluate(element => {
          const active = element.ownerDocument.activeElement;
          return (
            active !== null &&
            element.querySelector("summary")?.contains(active) === true &&
            (active as HTMLElement).isContentEditable
          );
        })
      )
      .toBe(true);
    // A click placing the caret in the title leaves the question open.
    await added.locator("summary h3").click();
    expect(
      await added.evaluate(element => (element as HTMLDetailsElement).open)
    ).toBe(true);
    await page.keyboard.press("ControlOrMeta+a");
    // Three spaces: an odd count, so a toggle on each would leave it closed.
    await page.keyboard.type("Do you ship abroad?");
    await page.keyboard.press("Enter");
    await expect(added.locator("summary h3")).toHaveText("Do you ship abroad?");
    // Typing a space or Enter in the title did not toggle the question.
    expect(
      await added.evaluate(element => (element as HTMLDetailsElement).open)
    ).toBe(true);

    await pressSave(page);
    await expect
      .poll(async () => {
        const nodes = await storedPageNodes(page.request, ENTRIES, id);
        const accordion = nodes.find(node => node.id === ACCORDION) as
          | { slots?: { children?: { props: { title?: string } }[] } }
          | undefined;
        return accordion?.slots?.children?.map(child => child.props.title);
      })
      .toEqual([
        "Question 1",
        "Question 2",
        "Question 3",
        "Do you ship abroad?",
      ]);
  });

  test("a question holds any block, and an emptied one draws the empty start", async ({
    page,
  }) => {
    const id = await createPage(page.request, [accordionNode()]);
    await openBuilder(page, id);
    // The first question is open (First open) and holds nothing.
    const first = await block(page, question(1));
    await expect
      .poll(() =>
        first.evaluate(element => (element as HTMLDetailsElement).open)
      )
      .toBe(true);
    const start = await first.evaluate(element => {
      const after = getComputedStyle(element, "::after");
      return { content: after.content, minHeight: after.minHeight };
    });
    expect(start).toEqual({ content: '""', minHeight: "44px" });
    const append = page.getByRole("button", {
      name: /Add a block, or drop one here, in Question/,
    });
    await expect(append).toBeVisible();
    // Drawn under the title, inside the question.
    const summary = await first.locator("summary").boundingBox();
    const control = await append.boundingBox();
    expect(control?.y ?? 0).toBeGreaterThanOrEqual(
      (summary?.y ?? 0) + (summary?.height ?? 0) - 1
    );

    // A button, a picture and a list go in, as any block does.
    await append.click();
    await page
      .getByRole("dialog", { name: "Add a block" })
      .getByRole("gridcell", { name: "Button", exact: true })
      .click();
    const inAnswer = async () =>
      (await structure(page)).filter(entry =>
        entry.startsWith(`${question(1)}>`)
      );
    await expect.poll(inAnswer).toHaveLength(1);
    // The Add panel puts each after the block just added, in the answer.
    await page
      .getByRole("navigation", { name: "Editor panels" })
      .getByRole("button", { name: "Add", exact: true })
      .click();
    for (const name of ["Image", "List"]) {
      await page.getByRole("option", { name, exact: true }).click();
    }
    await expect.poll(inAnswer).toHaveLength(3);
    await expect(
      page.getByRole("button", {
        name: /Add a block, or drop one here, in Question/,
      })
    ).toHaveCount(0);
    expect(
      await first.evaluate(
        element => getComputedStyle(element, "::after").content
      )
    ).toBe("none");
  });
});
