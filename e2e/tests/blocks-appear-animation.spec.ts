/**
 * "Animation when it appears" on a published page, in a real browser.
 *
 * The compiler's own tests pin the CSS it writes. What only a browser can say
 * is what a visitor sees:
 *
 * - on a desktop screen, a block set to start on load plays and ends as it
 *   is, and a block set to rise when scrolled into view waits below the fold
 *   and rises as it is scrolled to, with no layout shift on the way;
 * - at a mobile width, where that block says None, it does not move;
 * - asking for reduced motion, printing, and a browser without scroll-driven
 *   animation each show every block as it is, with nothing running;
 * - and the page ships no script for any of it.
 *
 * The site's default breakpoints are read (Mobile up to 640px), so the
 * site-style lock is held. Each test makes its own page, named uniquely.
 *
 * @module blocks-appear-animation.spec
 */
import { expect, type Page } from "@playwright/test";

import { clientReferencesOf } from "./support/client-references";
import { LOCK } from "./support/locks";
import { test } from "./support/test";

test.describe.configure({ lock: [LOCK.siteStyle], timeout: 120_000 });

const PAGES = "/admin/api/collections/pages/entries";

const ON_LOAD = "Comes in as the page loads.";
const ON_SCROLL = "Rises as it scrolls into view.";

/** A section holding one heading, styled as given. */
function section(id: string, text: string, styles?: unknown): unknown {
  return {
    id,
    type: "core/section",
    version: 1,
    props: { as: "section", contained: true },
    ...(styles === undefined ? {} : { styles }),
    slots: {
      children: [
        {
          id: `${id}-h`,
          type: "core/heading",
          version: 1,
          props: { text, level: "h2" },
        },
      ],
    },
  };
}

/** The page: a block on load, a long gap, a block on scroll, and an end. */
function nodes(animated: boolean): unknown[] {
  const appear = (value: unknown) =>
    animated ? { base: { base: { appear: value } } } : undefined;
  return [
    section(
      "appear-load",
      ON_LOAD,
      appear({ effect: "fade-in", duration: 400, start: "load" })
    ),
    section("appear-gap", "A long way down.", {
      base: { base: { padding: { blockStart: "2000px" } } },
    }),
    section(
      "appear-scroll",
      ON_SCROLL,
      animated
        ? {
            base: {
              base: {
                appear: { effect: "rise", duration: 600, start: "scroll" },
              },
              mobile: { appear: { effect: "none" } },
            },
          }
        : undefined
    ),
    section("appear-end", "The end of the page.", {
      base: { base: { padding: { blockEnd: "400px" } } },
    }),
  ];
}

/** A published page of its own: its slug. */
async function seed(page: Page, animated = true): Promise<string> {
  const stamp = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
  const slug = `appear-${stamp}`;
  const created = await page.request.post(PAGES, {
    data: {
      title: `Appear ${stamp}`,
      slug,
      status: "published",
      content: { formatVersion: 1, kind: "page", nodes: nodes(animated) },
    },
  });
  expect(created.ok(), `seeding the page: ${created.status()}`).toBe(true);
  return slug;
}

/** What a block's section is doing: its animations, and how it is drawn. */
async function stateOf(page: Page, text: string) {
  return page
    .getByText(text, { exact: true })
    .locator("xpath=ancestor::section[1]")
    .evaluate(element => {
      const style = getComputedStyle(element);
      const animations = element.getAnimations();
      return {
        running: animations.length,
        scrollDriven: animations.some(
          animation =>
            animation.timeline !== null &&
            animation.timeline.constructor.name === "ViewTimeline"
        ),
        opacity: style.opacity,
        // An animation held at its end reads `0px`, the same place as `none`.
        translate: style.translate === "0px" ? "none" : style.translate,
      };
    });
}

/** Every block on the page, as it is drawn: opaque, and where it belongs. */
async function everyBlockAsItIs(page: Page): Promise<void> {
  for (const text of [ON_LOAD, ON_SCROLL]) {
    await expect
      .poll(() => stateOf(page, text))
      .toEqual({
        running: 0,
        scrollDriven: false,
        opacity: "1",
        translate: "none",
      });
  }
}

test("plays on a desktop screen, on load and as the block scrolls into view", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const slug = await seed(page);
  // Layout shifts from here on, read back once the page has been scrolled.
  await page.addInitScript(() => {
    const shifts: number[] = [];
    (window as unknown as { __shifts: number[] }).__shifts = shifts;
    new PerformanceObserver(list => {
      for (const entry of list.getEntries()) {
        const shift = entry as PerformanceEntry & {
          value: number;
          hadRecentInput: boolean;
        };
        if (!shift.hadRecentInput) shifts.push(shift.value);
      }
    }).observe({ type: "layout-shift", buffered: true });
  });
  const response = await page.goto(`/${slug}`);
  expect(response?.status()).toBe(200);

  // On load: one animation, on the document's own timeline, which plays and
  // ends as it is. Held at its end by its fill, so it is still listed after.
  const played = await page
    .getByText(ON_LOAD, { exact: true })
    .locator("xpath=ancestor::section[1]")
    .evaluate(async element => {
      const animations = element.getAnimations();
      await Promise.all(animations.map(animation => animation.finished));
      return animations.map(animation => ({
        name: (animation as CSSAnimation).animationName,
        onDocumentTimeline: animation.timeline === document.timeline,
      }));
    });
  expect(played).toHaveLength(1);
  expect(played[0]?.name).toMatch(/-appear-fade-in$/);
  expect(played[0]?.onDocumentTimeline).toBe(true);
  expect(await stateOf(page, ON_LOAD)).toMatchObject({ opacity: "1" });

  // Below the fold: waiting in its starting place, on its own view timeline.
  const waiting = await stateOf(page, ON_SCROLL);
  expect(waiting).toMatchObject({ running: 1, scrollDriven: true });
  expect(waiting.opacity).toBe("0");

  // Scrolled to, it rises into place and stays.
  await page
    .getByText("The end of the page.", { exact: true })
    .scrollIntoViewIfNeeded();
  await expect
    .poll(() => stateOf(page, ON_SCROLL))
    .toMatchObject({ opacity: "1", translate: "none" });

  // Only opacity and the transform moved: nothing shifted the layout.
  const shift = await page.evaluate(() =>
    (window as unknown as { __shifts: number[] }).__shifts.reduce(
      (sum, value) => sum + value,
      0
    )
  );
  test.info().annotations.push({
    type: "layout shift",
    description: shift.toFixed(4),
  });
  expect(shift).toBeLessThanOrEqual(0.1);
});

test("stays still at a mobile width, where the block says None", async ({
  page,
}) => {
  await page.setViewportSize({ width: 400, height: 800 });
  const slug = await seed(page);
  await page.goto(`/${slug}`);
  // Below the fold and never scrolled to, still drawn as it is.
  expect(await stateOf(page, ON_SCROLL)).toEqual({
    running: 0,
    scrollDriven: false,
    opacity: "1",
    translate: "none",
  });
});

test("shows every block as it is when the visitor asks for reduced motion", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  const slug = await seed(page);
  await page.goto(`/${slug}`);
  await everyBlockAsItIs(page);
});

test("prints every block as it is", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.emulateMedia({ media: "print" });
  const slug = await seed(page);
  await page.goto(`/${slug}`);
  await everyBlockAsItIs(page);
});

test("shows the scrolled block as it is in a browser without scroll-driven animation", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const slug = await seed(page);
  // The page as such a browser reads it: the two scroll-driven properties are
  // unknown to it, so they are spelled as properties no browser knows, which
  // drops them and makes the feature test answer "no" just as it would.
  let rewritten = 0;
  await page.route(`**/${slug}`, async route => {
    try {
      const response = await route.fetch();
      const body = await response.text();
      const read = body
        .replaceAll("animation-timeline", "x-animation-timeline")
        .replaceAll("animation-range", "x-animation-range");
      rewritten += body.split("animation-timeline").length - 1;
      await route.fulfill({ response, body: read });
    } catch {
      await route.abort();
    }
  });
  await page.goto(`/${slug}`);
  // The control: the page did carry the scroll-driven declarations.
  expect(rewritten).toBeGreaterThan(0);
  expect(await stateOf(page, ON_SCROLL)).toEqual({
    running: 0,
    scrollDriven: false,
    opacity: "1",
    translate: "none",
  });
  // On load still plays: every browser runs that one.
  await expect
    .poll(() => stateOf(page, ON_LOAD))
    .toMatchObject({ opacity: "1" });
});

test("ships no script for the animation", async ({ page }) => {
  const animated = await seed(page);
  const plain = await seed(page, false);
  const withAnimation = await clientReferencesOf(page, `/${animated}`);
  // The control: the read finds the page's references at all.
  expect(withAnimation.length).toBeGreaterThan(0);
  expect(withAnimation).toEqual(await clientReferencesOf(page, `/${plain}`));
  // And the page's own scripts are the same ones.
  const scripts = async (slug: string) => {
    await page.goto(`/${slug}`);
    return page.evaluate(() =>
      Array.from(document.scripts, script =>
        script.src === "" ? "inline" : new URL(script.src).pathname
      )
        .filter(src => src !== "inline")
        .sort()
    );
  };
  expect(await scripts(animated)).toEqual(await scripts(plain));
});
