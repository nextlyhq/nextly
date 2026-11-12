/**
 * The admin shell at every width, and by keyboard.
 *
 * One page of each kind the admin frames (the dashboard, a collection's list,
 * a list, a form, an entry's editor, a Single's editor and a plugin's
 * workspace) is opened at a phone, a small laptop, a desktop and a large
 * desktop, in light and in dark, and must not scroll sideways: neither the
 * document nor `<main>`, which is the shell's own scroll container.
 *
 * Then the shell is walked with Tab from the top of the document on a wide
 * window: the skip link first, then the rail top to bottom, then the panel
 * where the page has one, then the top bar, and from there into the page.
 * Every stop is inside the window and draws a focus indicator, every
 * reachable control of the shell is a stop, and each menu the rail and the
 * bar open closes on Escape and gives focus back to its trigger.
 *
 * The Single's form claims its document when it opens, so this file holds
 * that document's lock; everything else it reads is its own or not shared.
 *
 * @module tests/admin-shell-every-width.spec
 */
import { expect, type Locator, type Page } from "@playwright/test";

import { uniqueTag } from "./support/accounts";
import { gotoAdmin, type Theme } from "./support/admin";
import { LOCK } from "./support/locks";
import { createEntry } from "./support/runtime-collection";
import { waitForShellAnswers } from "./support/shell-geometry";
import { test } from "./support/test";

test.describe.configure({ lock: [LOCK.siteSettings] });

/** The visual check's widths, each at its device's usual height. */
const VIEWPORTS = [
  { width: 390, height: 844 },
  { width: 1024, height: 768 },
  { width: 1440, height: 900 },
  { width: 1920, height: 1080 },
] as const;

const SCHEMES: readonly Theme[] = ["light", "dark"];

/** What a page needs to be opened: a post of this test's own, where it asks. */
interface Opened {
  postId: string;
  postTitle: string;
}

interface ShellPage {
  /** Named in a failure. */
  name: string;
  /** The page's address below `/admin`. */
  path: (opened: Opened) => string;
  /**
   * The frame type the page declares (`data-page-type`), checked so the table
   * cannot drift to a page of another kind; `null` where the page has none.
   */
  pageType: "list" | "form" | "editor" | "workspace" | null;
  /** Visible once the page has drawn its content, not only the shell. */
  ready: (page: Page, opened: Opened) => Locator;
  /** Whether the page needs a post to exist. */
  needsPost?: boolean;
}

const PAGES: readonly ShellPage[] = [
  {
    name: "the dashboard",
    path: () => "/",
    pageType: null,
    ready: page =>
      page.getByRole("heading", {
        level: 1,
        name: /^(Good (morning|afternoon|evening), \S+|Welcome|Dashboard)$/,
      }),
  },
  {
    name: "a collection's list",
    path: () => "/collections/posts",
    pageType: null,
    needsPost: true,
    // The row's way in, in whichever of the table and the cards is showing.
    ready: (page, { postTitle }) =>
      page.getByRole("link", { name: postTitle }).first(),
  },
  {
    name: "a list page",
    path: () => "/settings/webhooks",
    pageType: "list",
    ready: page => page.getByRole("heading", { level: 1, name: "Webhooks" }),
  },
  {
    name: "a form page",
    path: () => "/settings",
    pageType: "form",
    ready: page =>
      page.getByRole("heading", { level: 1, name: "General Settings" }),
  },
  {
    name: "an entry's editor",
    path: ({ postId }) => `/collections/posts/${postId}`,
    pageType: "editor",
    needsPost: true,
    ready: page => page.getByRole("textbox", { name: "Excerpt", exact: true }),
  },
  {
    name: "a Single's editor",
    path: () => "/singles/site-settings",
    pageType: "editor",
    ready: page => page.getByRole("textbox", { name: "Tagline", exact: true }),
  },
  {
    name: "a plugin's workspace page",
    // The style fixture's Workspace page; the fixture is on for every e2e run.
    path: () => "/plugins/style-fixture/frame-workspace",
    pageType: "workspace",
    ready: page =>
      page.getByRole("heading", { level: 1, name: "Fixture workspace page" }),
  },
];

/** How wide the document and `<main>` are against what they show. */
interface Overflow {
  document: { scrollWidth: number; clientWidth: number };
  main: { scrollWidth: number; clientWidth: number } | null;
  /** The outermost visible elements ending past the window's right edge. */
  pastEdge: string[];
}

function readOverflow(page: Page): Promise<Overflow> {
  return page.evaluate(() => {
    const root = document.documentElement;
    const limit = root.clientWidth + 1;
    // The one `<main>` on screen: a page Next.js keeps mounted but hidden has
    // its own copy.
    const main =
      [...document.querySelectorAll("main")].find(element =>
        element.checkVisibility()
      ) ?? null;

    // A box inside one that clips or scrolls sideways and itself ends inside
    // the window is not seen past the edge.
    const clippedInside = (element: Element) => {
      for (let up = element.parentElement; up && up !== root; ) {
        if (
          getComputedStyle(up).overflowX !== "visible" &&
          up.getBoundingClientRect().right <= limit
        )
          return true;
        up = up.parentElement;
      }
      return false;
    };
    const describeElement = (element: Element) => {
      const classes = [...element.classList].slice(0, 3).join(".");
      const label = element.getAttribute("aria-label");
      return `${element.tagName.toLowerCase()}${classes ? `.${classes}` : ""}${
        label ? `[aria-label="${label}"]` : ""
      } (right edge ${Math.round(element.getBoundingClientRect().right)}px)`;
    };

    const reported: Element[] = [];
    for (const element of document.body.querySelectorAll("*")) {
      const box = element.getBoundingClientRect();
      if (box.width === 0 || box.height === 0 || box.right <= limit) continue;
      if (!element.checkVisibility({ visibilityProperty: true })) continue;
      if (reported.some(outer => outer.contains(element))) continue;
      if (clippedInside(element)) continue;
      reported.push(element);
    }

    return {
      document: {
        scrollWidth: root.scrollWidth,
        clientWidth: root.clientWidth,
      },
      main: main
        ? { scrollWidth: main.scrollWidth, clientWidth: main.clientWidth }
        : null,
      pastEdge: reported.slice(0, 5).map(describeElement),
    };
  });
}

/** Opens `target` at one width and scheme, drawn in full. */
async function openAt(
  page: Page,
  target: ShellPage,
  opened: Opened,
  viewport: (typeof VIEWPORTS)[number],
  scheme: Theme
): Promise<void> {
  await page.setViewportSize(viewport);
  // The system preference as well as the admin's stored choice, as the visual
  // check sets both.
  await page.emulateMedia({ colorScheme: scheme });
  await gotoAdmin(page, target.path(opened), scheme);
  await waitForShellAnswers(page);
  await expect(target.ready(page, opened)).toBeVisible({ timeout: 30_000 });
  if (target.pageType) {
    await expect(
      page.locator(`main [data-page-type="${target.pageType}"]`).first()
    ).toBeVisible();
  }
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
}

test.describe("no page scrolls sideways", () => {
  for (const target of PAGES) {
    test(`${target.name} fits every width in both schemes`, async ({
      page,
    }) => {
      test.setTimeout(240_000);
      const opened: Opened = { postId: "", postTitle: "" };
      if (target.needsPost) {
        const tag = uniqueTag();
        opened.postTitle = `Every width ${tag}`;
        opened.postId = await createEntry(page.request, "posts", {
          title: opened.postTitle,
          slug: `every-width-${tag}`,
          excerpt: "A post the shell is measured around.",
        });
      }

      for (const scheme of SCHEMES) {
        for (const viewport of VIEWPORTS) {
          await openAt(page, target, opened, viewport, scheme);
          const where = `${target.name} (/admin${target.path(opened)}) at ${viewport.width}x${viewport.height}, ${scheme}`;
          const overflow = await readOverflow(page);
          const past = overflow.pastEdge.length
            ? `; past the right edge: ${overflow.pastEdge.join(", ")}`
            : "";

          // The positive control: `<main>` was found, so a page that scrolls
          // inside it is measured, not skipped.
          expect(overflow.main, `${where}: no <main> on screen`).not.toBeNull();
          expect
            .soft(
              overflow.document.scrollWidth,
              `${where}: the document scrolls sideways (${overflow.document.scrollWidth}px wide in a ${overflow.document.clientWidth}px window)${past}`
            )
            .toBeLessThanOrEqual(overflow.document.clientWidth);
          if (overflow.main) {
            expect
              .soft(
                overflow.main.scrollWidth,
                `${where}: <main> scrolls sideways (${overflow.main.scrollWidth}px of content in ${overflow.main.clientWidth}px)${past}`
              )
              .toBeLessThanOrEqual(overflow.main.clientWidth);
          }
        }
      }
    });
  }
});

/** The shell's parts in reading order; a walk never goes back to an earlier one. */
const REGIONS = ["skip", "rail", "panel", "bar"] as const;
type Region = (typeof REGIONS)[number] | "main" | "other";

/** One stop of the walk: the focused element, as the walk reads it. */
interface Stop {
  region: Region;
  name: string;
  /** Its box against the window. */
  box: { left: number; top: number; right: number; bottom: number };
  /** Its box in its scroll containers' content, which scrolling does not move. */
  laidOut: { left: number; top: number; right: number; bottom: number };
  inWindow: boolean;
  /** What draws its focus indicator, or `null` when nothing does. */
  indicator: string | null;
}

/**
 * Notes, before the walk, how each control of the shell looks without focus,
 * so a stop can be told apart from the same control at rest; and installs the
 * readers the walk's steps call.
 */
async function prepareWalk(page: Page): Promise<void> {
  await page.evaluate(() => {
    const FOCUSABLE =
      'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])';
    const look = (element: Element) => {
      const style = getComputedStyle(element);
      return {
        outlineStyle: style.outlineStyle,
        outlineWidth: style.outlineWidth,
        outlineColor: style.outlineColor,
        boxShadow: style.boxShadow,
        borderColor: style.borderColor,
        borderWidth: style.borderTopWidth,
      };
    };
    // A colour's opacity, by letting the browser paint it.
    const opacity = (color: string) => {
      const canvas = document.createElement("canvas");
      canvas.width = 1;
      canvas.height = 1;
      const context = canvas.getContext("2d");
      if (!context) return 1;
      context.fillStyle = color;
      context.fillRect(0, 0, 1, 1);
      return context.getImageData(0, 0, 1, 1).data[3] / 255;
    };
    // `box-shadow`'s layers, split at the commas between them, not inside a
    // colour's parentheses.
    const layers = (shadow: string) => {
      if (shadow === "none") return [];
      const parts: string[] = [];
      let depth = 0;
      let start = 0;
      for (let i = 0; i < shadow.length; i++) {
        if (shadow[i] === "(") depth++;
        else if (shadow[i] === ")") depth--;
        else if (shadow[i] === "," && depth === 0) {
          parts.push(shadow.slice(start, i));
          start = i + 1;
        }
      }
      parts.push(shadow.slice(start));
      return parts.map(part => {
        const trimmed = part.trim();
        const color =
          /^([a-z-]+\([^)]*\)|#[0-9a-f]+|[a-z]+)/i.exec(trimmed)?.[1] ?? "";
        const lengths = [
          ...trimmed.slice(color.length).matchAll(/-?[\d.]+px/g),
        ].map(match => parseFloat(match[0]));
        return { color, spread: lengths[3] ?? 0 };
      });
    };

    const resting = new WeakMap<Element, ReturnType<typeof look>>();
    for (const element of document.querySelectorAll(FOCUSABLE)) {
      resting.set(element, look(element));
    }

    const regionOf = (element: Element): string => {
      if (element.matches('a[href="#nextly-main-content"]')) return "skip";
      if (element.closest("main")) return "main";
      if (element.closest('[data-testid="sub-sidebar"]')) return "panel";
      if (element.closest("header")) return "bar";
      if (element.closest("aside")) return "rail";
      return "other";
    };

    // An outline, a ring (a shadow with spread), or a border that changes
    // colour: each a focus indicator, provided it is not how the control
    // looks at rest anyway.
    const indicatorOf = (element: Element): string | null => {
      const now = look(element);
      const rest = resting.get(element);
      const changed = (key: keyof ReturnType<typeof look>) =>
        !rest || rest[key] !== now[key];
      if (
        now.outlineStyle !== "none" &&
        parseFloat(now.outlineWidth) > 0 &&
        (now.outlineStyle === "auto" || opacity(now.outlineColor) > 0) &&
        (changed("outlineStyle") ||
          changed("outlineWidth") ||
          changed("outlineColor"))
      )
        return `outline ${now.outlineStyle} ${now.outlineWidth}`;
      if (
        changed("boxShadow") &&
        layers(now.boxShadow).some(
          layer => layer.spread > 0 && opacity(layer.color) > 0
        )
      )
        return "ring";
      if (rest && changed("borderColor") && parseFloat(now.borderWidth) > 0)
        return "border colour";
      return null;
    };

    // The element's box in its scroll containers' content.
    const laidOut = (element: Element) => {
      const box = element.getBoundingClientRect();
      let x = 0;
      let y = 0;
      for (let up = element.parentElement; up; up = up.parentElement) {
        x += up.scrollLeft;
        y += up.scrollTop;
      }
      return {
        left: box.left + x,
        top: box.top + y,
        right: box.right + x,
        bottom: box.bottom + y,
      };
    };

    const tabbable = (element: Element) =>
      element.matches(FOCUSABLE) &&
      !element.matches(":disabled") &&
      !element.closest("[inert]") &&
      element.checkVisibility({ visibilityProperty: true }) &&
      element.getBoundingClientRect().width > 0;

    Object.assign(window, {
      __shellWalk: { regionOf, indicatorOf, laidOut, tabbable, FOCUSABLE },
    });
  });
}

/** The walk's readers, as `prepareWalk` left them on the window. */
interface WalkReaders {
  regionOf: (element: Element) => Region;
  indicatorOf: (element: Element) => string | null;
  laidOut: (element: Element) => Stop["laidOut"];
  tabbable: (element: Element) => boolean;
  FOCUSABLE: string;
}

/** Reads the focused element, once its focus styles have finished moving. */
async function readStop(page: Page, step: number): Promise<Stop> {
  await page.waitForFunction(() => {
    const focused = document.activeElement;
    return (
      focused !== null &&
      focused
        .getAnimations()
        .every(animation => animation.playState !== "running")
    );
  });
  return page.evaluate(n => {
    const walk = (window as unknown as { __shellWalk: WalkReaders })
      .__shellWalk;
    const focused = document.activeElement ?? document.body;
    // Marked, so the controls the walk never reached can be named at the end.
    focused.setAttribute("data-shell-walk", String(n));
    const box = focused.getBoundingClientRect();
    const root = document.documentElement;
    const name =
      focused.getAttribute("aria-label") ??
      ((focused.textContent ?? "").trim().slice(0, 40) || focused.tagName);
    return {
      region: walk.regionOf(focused),
      name: `${focused.tagName.toLowerCase()} "${name}"`,
      box: {
        left: box.left,
        top: box.top,
        right: box.right,
        bottom: box.bottom,
      },
      laidOut: walk.laidOut(focused),
      inWindow:
        box.width > 0 &&
        box.height > 0 &&
        box.left >= -1 &&
        box.top >= -1 &&
        box.right <= root.clientWidth + 1 &&
        box.bottom <= root.clientHeight + 1,
      indicator: walk.indicatorOf(focused),
    };
  }, step);
}

/** Whether `next` comes after `previous` in reading order. */
function readsAfter(previous: Stop, next: Stop): boolean {
  const a = previous.laidOut;
  const b = next.laidOut;
  const sameLine = b.top < a.bottom && b.bottom > a.top;
  return sameLine ? b.left >= a.left - 1 : b.top >= a.bottom - 1;
}

/**
 * Tabs from the top of the document into the page, and holds each stop to
 * being in the window, showing focus and coming after the one before.
 */
async function walkShell(page: Page, where: string): Promise<Stop[]> {
  await prepareWalk(page);
  // Off the shell, so no control reads as hovered.
  await page.mouse.move(1430, 890);
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement)
      document.activeElement.blur();
  });

  const stops: Stop[] = [];
  for (let step = 0; step < 200; step++) {
    await page.keyboard.press("Tab");
    const stop = await readStop(page, step);
    if (stop.region === "main") return stops;
    const at = `${where}, stop ${step + 1}, ${stop.name} in the ${stop.region}`;

    expect(stop.region, `${at}: outside the shell's parts`).not.toBe("other");
    expect(stop.inWindow, `${at}: not inside the window`).toBe(true);
    expect(stop.indicator, `${at}: no focus indicator is drawn`).not.toBeNull();

    const previous = stops[stops.length - 1];
    if (previous) {
      const before = REGIONS.indexOf(
        previous.region as (typeof REGIONS)[number]
      );
      const now = REGIONS.indexOf(stop.region as (typeof REGIONS)[number]);
      expect(
        now,
        `${at}: reached after the ${previous.region} (${previous.name}), out of reading order`
      ).toBeGreaterThanOrEqual(before);
      if (now === before) {
        expect(
          readsAfter(previous, stop),
          `${at}: comes before ${previous.name} on screen, but after it in tab order`
        ).toBe(true);
      }
    } else {
      expect(stop.region, `${at}: the first stop is not the skip link`).toBe(
        "skip"
      );
    }
    stops.push(stop);
  }
  throw new Error(`${where}: 200 Tabs never reached the page's content`);
}

/** The shell's controls Tab can reach that the walk did not stop on. */
function unvisited(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const walk = (window as unknown as { __shellWalk: WalkReaders })
      .__shellWalk;
    return [...document.querySelectorAll(walk.FOCUSABLE)]
      .filter(
        element =>
          walk.tabbable(element) &&
          ["skip", "rail", "panel", "bar"].includes(walk.regionOf(element)) &&
          !element.hasAttribute("data-shell-walk")
      )
      .map(
        element =>
          `${element.tagName.toLowerCase()} "${element.getAttribute("aria-label") ?? (element.textContent ?? "").trim().slice(0, 40)}" in the ${walk.regionOf(element)}`
      );
  });
}

test.describe("the shell by keyboard", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("Tab walks the dashboard's shell in reading order, showing focus", async ({
    page,
  }) => {
    await gotoAdmin(page, "/");
    await waitForShellAnswers(page);
    const stops = await walkShell(page, "the dashboard");

    const regions = new Set(stops.map(stop => stop.region));
    // POSITIVE CONTROLS: the walk passed through the rail to its foot.
    expect(regions.has("rail"), "the walk never reached the rail").toBe(true);
    expect(
      stops.some(stop => stop.name.includes("User profile menu")),
      "the walk never reached the account menu's button"
    ).toBe(true);
    // The dashboard owns no panel.
    expect(regions.has("panel")).toBe(false);
    expect(await unvisited(page), "controls Tab skipped").toEqual([]);
  });

  test("Tab walks the rail, the open panel and the bar in reading order", async ({
    page,
  }) => {
    await gotoAdmin(page, "/collections/posts");
    await waitForShellAnswers(page);
    await expect(
      page
        .getByTestId("sub-sidebar")
        .getByRole("link", { name: "Posts", exact: true })
    ).toBeVisible();
    const stops = await walkShell(page, "a collection's list");

    const regions = [...new Set(stops.map(stop => stop.region))];
    // The panel is open on a collection, so the walk passes through it, after
    // the rail.
    expect(regions.slice(0, 3)).toEqual(["skip", "rail", "panel"]);
    expect(
      stops.some(
        stop => stop.region === "panel" && stop.name.includes("Posts")
      ),
      "the walk never reached the panel's Posts link"
    ).toBe(true);
    expect(await unvisited(page), "controls Tab skipped").toEqual([]);
  });

  test("each menu of the rail and the bar closes on Escape, giving focus back", async ({
    page,
  }) => {
    await gotoAdmin(page, "/collections/posts");
    await waitForShellAnswers(page);

    // Every control of the rail, the panel or the bar that opens something:
    // the account menu, the Inbox, and any menu added later. Chosen in the
    // page, by where each sits, from all the page's popup triggers, so each
    // is then reached by its place among them.
    const all = page.locator("[aria-haspopup]:visible");
    const shell = await all.evaluateAll(elements =>
      elements.flatMap((element, index) =>
        !element.closest("main") && element.closest("aside, header")
          ? [
              {
                index,
                name:
                  element.getAttribute("aria-label") ??
                  (element.textContent ?? "").trim(),
              },
            ]
          : []
      )
    );
    const names = shell.map(trigger => trigger.name);
    // POSITIVE CONTROL: the two the shell always draws for this reader.
    expect(names).toEqual(
      expect.arrayContaining([
        "User profile menu",
        expect.stringMatching(/^Notifications/),
      ])
    );

    for (const { index, name } of shell) {
      const trigger = all.nth(index);
      await trigger.focus();
      await page.keyboard.press("Enter");
      await expect(trigger, `${name}: Enter did not open it`).toHaveAttribute(
        "aria-expanded",
        "true"
      );
      const controls = await trigger.getAttribute("aria-controls");
      expect(controls, `${name}: names no popup it controls`).toBeTruthy();
      const popup = page.locator(`[id="${controls}"]:visible`);
      await expect(popup, `${name}: its popup is not shown`).toBeVisible();
      await expect
        .poll(
          () =>
            popup.evaluate(element => element.contains(document.activeElement)),
          { message: `${name}: focus did not move into its popup` }
        )
        .toBe(true);

      await page.keyboard.press("Escape");
      await expect(popup, `${name}: Escape did not close it`).toBeHidden();
      await expect(trigger).toHaveAttribute("aria-expanded", "false");
      await expect(
        trigger,
        `${name}: focus did not come back to its trigger`
      ).toBeFocused();
    }
  });
});
