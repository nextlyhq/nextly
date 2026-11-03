/**
 * Every surface of the page builder meets WCAG 2.2 AA, in light and dark.
 *
 * `builder-a11y.spec.ts` scans the editor as it opens and with the Add panel
 * open. Each panel, dialog and menu is a different tree with its own roles and
 * colours, and a scan of the closed editor never reaches it, so each is opened
 * here and the whole page scanned with it on screen: Layers, the Design
 * panel's three tabs, the inspector's Style tab, Settings, Help, the command
 * palette, the zoom menu, and a block's context menu, toolbar menu and card
 * menu.
 *
 * Whole-page scans, as the sibling spec explains: a scan rooted at the panel
 * would miss a defect the panel causes outside itself, such as a modal menu
 * hiding focusable controls (`aria-hidden-focus`).
 *
 * Each test makes its own page, named uniquely, so no lock is needed.
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, type APIRequestContext, type Page } from "@playwright/test";

import { gotoAdmin } from "./support/admin";
import { settleTransitions } from "./support/axe-scan.mjs";
import { canvasBlock } from "./support/canvas-frame";
import { ownSeat, test } from "./support/test";

const ENTRIES = "/admin/api/collections/pages/entries";
const AA_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const HEADING = "00000000-0000-4000-8000-00000000c611";

/** A heading inside a section: enough for every menu to have a target. */
function pageDocument(): unknown {
  return {
    formatVersion: 1,
    kind: "page",
    nodes: [
      {
        id: "00000000-0000-4000-8000-00000000c610",
        type: "core/section",
        version: 1,
        props: { as: "section", contained: true },
        slots: {
          children: [
            {
              id: HEADING,
              type: "core/heading",
              version: 1,
              props: { text: "Every panel, scanned", level: "h2" },
            },
          ],
        },
      },
    ],
  };
}

async function createPage(request: APIRequestContext): Promise<string> {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const created = await request.post(ENTRIES, {
    data: {
      title: `Panels ${stamp}`,
      slug: `panels-${stamp}`,
      status: "draft",
      content: pageDocument(),
    },
  });
  if (!created.ok()) {
    throw new Error(
      `creating a page failed: ${created.status()} ${await created.text()}`
    );
  }
  const body = (await created.json()) as { item?: { id?: string } };
  const id = body.item?.id;
  if (typeof id !== "string") throw new Error("the new page has no id");
  return id;
}

async function openEditor(page: Page, scheme: "light" | "dark"): Promise<void> {
  // Without motion, so a scan reads each control's settled colours rather
  // than a frame of the rail's 120ms fade between two of them.
  await page.emulateMedia({ reducedMotion: "reduce" });
  const id = await createPage(page.request);
  // The admin's own theme switch, which also waits for the scheme to apply.
  await gotoAdmin(
    page,
    `/collections/pages/${id}/builder?field=content`,
    scheme
  );
  await expect(page.getByRole("region", { name: "Canvas" })).toBeVisible({
    timeout: 60_000,
  });
}

function railButton(page: Page, name: string) {
  return page
    .getByRole("navigation", { name: "Editor panels" })
    .getByRole("button", { name, exact: true });
}

/** Select the heading on the canvas, and wait for its inspector. */
async function selectHeading(page: Page): Promise<void> {
  await canvasBlock(page, HEADING).first().click();
  await expect(page.locator("[data-block-card]")).toBeVisible();
}

/** Each surface: how to put it on screen, and what proves it is there. */
const SURFACES: ReadonlyArray<{
  name: string;
  open: (page: Page) => Promise<void>;
}> = [
  {
    name: "Layers",
    open: async page => {
      await railButton(page, "Layers").click();
      await expect(page.getByRole("tree", { name: "Layers" })).toBeVisible();
    },
  },
  ...["Variables", "Shared styles", "Fonts"].map(tab => ({
    name: `Design, ${tab}`,
    open: async (page: Page) => {
      await railButton(page, "Design").click();
      await page.getByRole("tab", { name: tab, exact: true }).click();
      await expect(
        page.getByRole("tab", { name: tab, exact: true })
      ).toHaveAttribute("aria-selected", "true");
    },
  })),
  {
    name: "the Variables add menu",
    open: async page => {
      await railButton(page, "Design").click();
      await page.getByRole("tab", { name: "Variables", exact: true }).click();
      await page
        .getByRole("button", { name: "Add spacing, radius or shadow" })
        .click();
      await expect(page.getByRole("menu")).toBeVisible();
    },
  },
  {
    name: "the Style tab's More menu",
    open: async page => {
      await selectHeading(page);
      await page.getByRole("tab", { name: "Style", exact: true }).click();
      // The section's "More" button shows once the section is open.
      const typography = page.locator(
        '.nx-style-inspector [data-section="typography"]'
      );
      if ((await typography.getAttribute("data-state")) !== "open") {
        await typography.locator("button").first().click();
      }
      await page
        .getByRole("button", { name: "More typography properties" })
        .click();
      await expect(page.getByRole("menu")).toBeVisible();
    },
  },
  {
    name: "the inspector's Style tab",
    open: async page => {
      await selectHeading(page);
      await page.getByRole("tab", { name: "Style", exact: true }).click();
      await expect(
        page.getByRole("tab", { name: "Style", exact: true })
      ).toHaveAttribute("aria-selected", "true");
    },
  },
  {
    name: "Settings",
    open: async page => {
      await railButton(page, "Settings").click();
      await expect(page.getByRole("dialog")).toBeVisible();
    },
  },
  {
    name: "Help",
    open: async page => {
      await railButton(page, "Help").click();
      await expect(page.getByRole("dialog", { name: "Help" })).toBeVisible();
    },
  },
  {
    name: "the command palette",
    open: async page => {
      // From the editor's own page: focus inside the canvas's frame would
      // send the keystroke to the frame instead.
      await railButton(page, "Layers").focus();
      // Control, not the platform's modifier: the suite's browser reports a
      // Windows user agent whatever machine runs it, so the editor reads its
      // "mod" key as Control. On a Mac's own browser it is Command.
      await page.keyboard.press("Control+k");
      await expect(page.getByRole("dialog")).toBeVisible();
    },
  },
  {
    name: "the zoom menu",
    open: async page => {
      await page.locator(".nx-zoom-control").click();
      await expect(page.getByRole("menuitemradio").first()).toBeVisible();
    },
  },
  {
    name: "a block's context menu",
    open: async page => {
      await canvasBlock(page, HEADING).first().click({ button: "right" });
      await expect(page.getByRole("menu")).toBeVisible();
    },
  },
  {
    name: "a block's toolbar menu",
    open: async page => {
      await selectHeading(page);
      await page.getByRole("button", { name: "More actions" }).click();
      await expect(page.getByRole("menu")).toBeVisible();
    },
  },
  {
    name: "a block's card menu",
    open: async page => {
      await selectHeading(page);
      await page.getByRole("button", { name: "Actions for Heading" }).click();
      await expect(page.getByRole("menu")).toBeVisible();
    },
  },
];

interface Finding {
  id: string;
  impact: string;
  targets: string[];
}

async function scan(page: Page): Promise<Finding[]> {
  // Every running CSS transition finished first, as the shared scan does, so
  // axe reads settled colours rather than a frame between two of them.
  await settleTransitions(page);
  // And every finite animation, such as a dialog's fade in: one sampled
  // part-way through has colours it never settles on. An endless one, a
  // spinner, is left alone, since it never finishes.
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter(
          animation =>
            animation.effect?.getComputedTiming().endTime !== Infinity
        )
        .map(animation => animation.finished.catch(() => undefined))
    )
  );
  const results = await new AxeBuilder({ page }).withTags(AA_TAGS).analyze();
  // A scan that reached nothing reports zero violations, as a clean page does.
  expect(results.passes.length).toBeGreaterThan(10);
  return results.violations.map(violation => ({
    id: violation.id,
    impact: violation.impact ?? "unknown",
    targets: violation.nodes.flatMap(node => node.target.map(String)),
  }));
}

test.describe("every page builder surface meets WCAG 2.2 AA", () => {
  test.describe.configure({ timeout: 120_000 });

  SURFACES.forEach((surface, index) => {
    /*
     * Each surface reads through an account of its own. Every case opens the
     * editor afresh, and an editor's load spends a share of the REST limit's
     * per-user budget, so through the file's one account the twenty-first
     * open met a 429 and an editor that never loaded. A seat per surface
     * spends two opens of a budget, its light and dark scans.
     */
    test.describe(surface.name, () => {
      ownSeat(index + 1);

      for (const scheme of ["light", "dark"] as const) {
        test(`${surface.name}, ${scheme}`, async ({ page }) => {
          await openEditor(page, scheme);
          await surface.open(page);

          const findings = await scan(page);

          expect(
            findings,
            `axe reported ${findings.length} violation(s) with ${surface.name} open, ${scheme}:\n${JSON.stringify(findings, null, 2)}`
          ).toEqual([]);
        });
      }
    });
  });
});
