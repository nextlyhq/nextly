/**
 * The development widget preview page, in a browser on `next dev`.
 *
 * It lists every widget the reader may see, drawn from each widget's declared
 * preview cases with no data read: a plugin's widget (the playground's
 * widget-kit fixture) beside core's. A person lacking a widget's permission is
 * not shown it. And the page's accessibility check, run on each drawn state in
 * light and dark, is what CI holds first-party widgets to: no serious or
 * critical finding. The planted fixture (a control with no label) is the
 * check's positive control, so a check that found nothing anywhere cannot
 * pass as one that found nothing wrong.
 *
 * On `next dev` only (`DEV_SPECS` in playwright.config.ts): the page exists
 * only while the server runs in development. Its production half, that a
 * direct visit is not found, is `production/widget-preview.spec.ts`.
 */
import { createRequire } from "node:module";

import { expect, type Page } from "@playwright/test";

import { gotoAdmin, type Theme } from "./support/admin";
import { signInAsLimitedUser, type LimitedUser } from "./support/limited-user";
import { LOCK } from "./support/locks";
import { fileAccount, test } from "./support/test";

// Creates a role and a user for the limited reader.
test.describe.configure({ lock: [LOCK.usersRoles] });

const PREVIEWS = "/dev/widget-previews";
/** A plugin widget drawn by its own component, with a preview case. */
const KIT = "widget-kit-fixture/kit";
/** The widget planted with an unlabelled control. */
const PLANTED = "widget-kit-fixture/unlabelled-control";
/** Core's Team card, offered only to a reader who may manage people. */
const TEAM = "core/team";

/** axe-core's browser script, from the copy `@axe-core/playwright` runs. */
const AXE_SCRIPT = createRequire(
  createRequire(import.meta.url).resolve("@axe-core/playwright")
).resolve("axe-core/axe.min.js");

/** Opens the preview page and waits for its widgets to be listed. */
async function openPreviews(page: Page, theme: Theme = "light") {
  await gotoAdmin(page, PREVIEWS, theme);
  await expect(
    page.getByRole("heading", { name: "Widget previews" })
  ).toBeVisible({
    timeout: 60_000,
  });
  await expect(page.locator("[data-preview-section]").first()).toBeVisible();
}

const section = (page: Page, id: string) =>
  page.locator(`[data-preview-section="${id}"]`);

/** One drawn state with a serious or critical finding. */
interface BlockingState {
  widget: string;
  owner: string | null;
  key: string;
  rules: string[];
}

/** Runs the page's own check in `theme` and reads back every blocking state. */
async function blockingStatesIn(
  page: Page,
  theme: Theme
): Promise<BlockingState[]> {
  await page
    .getByRole("button", { name: theme === "light" ? "Light" : "Dark" })
    .click();
  // The palette hangs off the admin root, as `gotoAdmin` waits for it.
  const adminRoot = page.locator(".nextly-admin").first();
  if (theme === "dark") await expect(adminRoot).toHaveClass(/\bdark\b/);
  else await expect(adminRoot).not.toHaveClass(/\bdark\b/);
  await page.addScriptTag({ path: AXE_SCRIPT });
  await page.getByRole("button", { name: "Check accessibility" }).click();
  const status = page.getByTestId("accessibility-status");
  await expect(status).toHaveAttribute("data-check", "done", {
    timeout: 300_000,
  });
  await expect(status).toContainText(`in ${theme}`);

  return page.locator("[data-preview-key]").evaluateAll(states =>
    states.flatMap(state => {
      const findings = state.querySelector("[data-preview-findings]");
      if (Number(findings?.getAttribute("data-blocking") ?? "0") === 0)
        return [];
      const owner =
        state
          .closest("[data-preview-section]")
          ?.getAttribute("data-preview-owner") ?? null;
      return [
        {
          widget: state.getAttribute("data-preview-widget") ?? "",
          owner,
          key: state.getAttribute("data-preview-key") ?? "",
          rules: [...(findings?.querySelectorAll("[data-rule]") ?? [])]
            .filter(rule =>
              ["serious", "critical"].includes(
                rule.getAttribute("data-impact") ?? ""
              )
            )
            .map(rule => rule.getAttribute("data-rule") ?? ""),
        },
      ];
    })
  );
}

/**
 * Whether a widget is first-party: core's own, or a plugin published from this
 * repository. A fixture is neither, so the planted one never fails CI by
 * being present; it is held to the rule only where a test makes it the subject.
 */
function isFirstParty(state: BlockingState): boolean {
  return state.owner === "core" || (state.owner ?? "").includes('"@nextlyhq/');
}

/** The CI rule: the blocking states of the widgets it holds to it. */
function failingStates(
  states: readonly BlockingState[],
  heldToRule: (state: BlockingState) => boolean
): BlockingState[] {
  return states.filter(heldToRule);
}

test("lists a plugin widget drawn from its preview case, beside core's", async ({
  page,
}) => {
  await openPreviews(page);

  const kit = section(page, KIT);
  await expect(kit).toBeVisible();
  // Its ready state from the case it declares, drawn by its own component at
  // each of its sizes, with no data read for it.
  const ready = kit.locator(
    '[data-preview-state="ready"][data-preview-case="Busy week"]'
  );
  await expect(ready.first()).toBeVisible();
  await expect(ready.first().getByTestId("kit-card")).toBeVisible();
  // Every frame state beside it.
  for (const state of ["loading", "empty", "error", "unavailable"]) {
    await expect(
      kit.locator(`[data-preview-state="${state}"]`).first()
    ).toBeVisible();
  }
  // A core widget, listed by the same read.
  await expect(section(page, TEAM)).toBeVisible();
});

test("lists a widget the site config declares", async ({ page }) => {
  // The playground's config declares `playground/site-notes` itself, so the
  // read lists it as the site's own: a section for that id, owned by the
  // site config rather than a plugin.
  await openPreviews(page);
  const site = page.locator('[data-preview-section="playground/site-notes"]');
  await expect(site).toBeVisible();
  await expect(site).toHaveAttribute("data-preview-owner", "the site config");
});

test("customise mode offers the page beside its other actions, and the link opens it", async ({
  page,
}) => {
  // The production spec finds no such link; this is the same place on a
  // development server, where it is drawn.
  await gotoAdmin(page, "");
  await page.getByTestId("dashboard-edit-begin").click();
  await expect(page.getByRole("button", { name: "Save" })).toBeVisible();
  const link = page.getByTestId("widget-previews-link");
  await expect(link).toBeVisible();
  await link.click();
  await expect(
    page.getByRole("heading", { name: "Widget previews" })
  ).toBeVisible({ timeout: 60_000 });
});

test.describe("a reader lacking a widget's permission", () => {
  test.describe.configure({ mode: "serial" });

  let limited: LimitedUser;
  let page: Page;

  test.beforeAll(async ({ browser, playwright }, testInfo) => {
    const baseURL = testInfo.project.use.baseURL;
    if (baseURL === undefined) throw new Error("[e2e] No baseURL configured.");
    const admin = await playwright.request.newContext({
      baseURL,
      storageState: await fileAccount(baseURL, testInfo),
    });
    try {
      // May read media, and may not read or manage people: Team's gate.
      limited = await signInAsLimitedUser(browser, admin, baseURL, [
        "read-media",
      ]);
    } finally {
      await admin.dispose();
    }
    page = await limited.context.newPage();
  });

  test.afterAll(async () => {
    await limited?.context.close();
  });

  test("is not shown that widget, and is shown the others", async ({
    page: own,
  }) => {
    // The control: the file's own account, who may manage people, is shown it.
    await openPreviews(own);
    await expect(section(own, TEAM)).toBeVisible();

    await openPreviews(page);
    await expect(section(page, KIT)).toBeVisible();
    await expect(section(page, TEAM)).toHaveCount(0);
  });
});

test("the accessibility check refuses the planted control, and no first-party widget has a serious or critical finding", async ({
  page,
}) => {
  test.setTimeout(600_000);
  await openPreviews(page);

  for (const theme of ["light", "dark"] as const) {
    const blocking = await blockingStatesIn(page, theme);

    // The positive control: the check, made to hold the planted widget to the
    // rule, fails on it, by axe's label rule.
    const planted = failingStates(blocking, state => state.widget === PLANTED);
    expect(planted.length, `the planted control in ${theme}`).toBeGreaterThan(
      0
    );
    expect(planted.flatMap(state => state.rules)).toContain("label");

    // The rule CI holds: no first-party widget's state blocks.
    expect(
      failingStates(blocking, isFirstParty).map(
        state => `${state.key}: ${state.rules.join(", ")}`
      ),
      `first-party widgets with serious or critical findings in ${theme}`
    ).toEqual([]);
  }
});
