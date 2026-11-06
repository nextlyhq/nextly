import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { emptyScanReason } from "../../e2e/tests/support/axe-scan.mjs";

import { chromium } from "./browser.mjs";
import { startFixtureServer } from "./fixture-server.mjs";
import {
  checkPage,
  describeFinding,
  readOverflow,
  routeFailure,
  routeFromTable,
  publicRoutesFromTable,
  isPublicRoute,
  seriousViolations,
  SIGN_IN_PATH,
} from "./page-checks.mjs";

/*
 * Each check runs in a real browser against the fixture pages, at a width the
 * page breaks at and one it does not: a check that reported nothing at all
 * would pass the clean width too, so the broken width is what makes the clean
 * one mean anything.
 */
describe("what is read of each page", () => {
  let server;
  let browser;

  beforeAll(async () => {
    server = await startFixtureServer();
    browser = await chromium.launch();
  });

  afterAll(async () => {
    await browser?.close();
    await server?.close();
  });

  // A context of its own per page, which axe's Playwright binding requires. Closing the
  // browser after the last test closes every context with it.
  async function open(route, width) {
    const context = await browser.newContext({
      viewport: { width, height: 844 },
    });
    const page = await context.newPage();
    await page.goto(`${server.baseURL}${route}`);
    return page;
  }

  it("sees a page wider than a phone scroll sideways, and the same page fit a tablet", async () => {
    const narrow = await open("/admin/wide", 390);
    const wide = await open("/admin/wide", 1024);
    try {
      const atPhone = await readOverflow(narrow);
      expect(atPhone.viewportWidth).toBe(390);
      expect(atPhone.scrollWidth).toBeGreaterThanOrEqual(600);
      const atTablet = await readOverflow(wide);
      expect(atTablet.scrollWidth).toBe(atTablet.viewportWidth);
      expect(atTablet.pastRightEdge).toEqual([]);
    } finally {
      await narrow.close();
      await wide.close();
    }
  });

  it("names the element that ends past the right edge, and not one scrolled inside its box or hidden", async () => {
    const page = await open("/admin/wide", 390);
    try {
      const selectors = (await readOverflow(page)).pastRightEdge.map(
        element => element.selector
      );
      expect(selectors).toContain("div.wide-box");
      expect(selectors.some(selector => selector.includes("scrolled"))).toBe(
        false
      );
      expect(selectors.some(selector => selector.includes("hidden-box"))).toBe(
        false
      );
    } finally {
      await page.close();
    }
  });

  it("reports an unlabelled button as axe's serious-or-worse violation, by rule and element", async () => {
    const broken = await open("/admin/unlabelled", 1024);
    const clean = await open("/admin", 1024);
    try {
      expect(await seriousViolations(broken)).toEqual([
        { rule: "button-name", impact: "critical", selector: "button" },
      ]);
      expect(await seriousViolations(clean)).toEqual([]);
    } finally {
      await broken.close();
      await clean.close();
    }
  });

  it("gathers every finding of a page, each described with where it was seen", async () => {
    const page = await open("/admin/wide", 390);
    try {
      const { findings, unread } = await checkPage(page);
      expect(unread).toBeNull();
      const lines = findings.map(finding =>
        describeFinding("/admin/wide 390 light", finding)
      );
      expect(lines).toContain(
        "/admin/wide 390 light: the page scrolls sideways (document 900 px wide, viewport 390 px)"
      );
      expect(lines).toContainEqual(
        expect.stringMatching(
          /^\/admin\/wide 390 light: div\.wide-box ends past the right edge/
        )
      );
    } finally {
      await page.close();
    }
  });
});

/*
 * The control the e2e suite holds every scan to: a whole page judged by ten
 * passing rules or fewer, or a scoped scan that measured no contrast, was not
 * a page axe could judge, and its silence is no pass.
 */
describe("an axe scan that checked nothing", () => {
  const rules = (count, id = "rule") =>
    Array.from({ length: count }, (_, index) => ({
      id: `${id}-${index}`,
      nodes: [{}],
    }));

  it("is named for a whole page with ten passing rules or fewer", () => {
    expect(emptyScanReason({ passes: rules(10), violations: [] })).toMatch(
      /scanned nothing/
    );
    expect(emptyScanReason({ passes: rules(11), violations: [] })).toBeNull();
  });

  it("is named for a scoped scan that measured no contrast inside its scope", () => {
    const scope = { include: "main" };
    expect(
      emptyScanReason({ passes: rules(20), violations: [] }, scope)
    ).toMatch(/inside main/);
    expect(
      emptyScanReason(
        { passes: [{ id: "color-contrast", nodes: [{}] }], violations: [] },
        scope
      )
    ).toBeNull();
  });
});

describe("where the admin sends a visitor with no session", () => {
  const TABLE = "routes.ts";

  it("is read from the route table's LOGIN entry, not restated", () => {
    const source = `import x from "y";\nexport const ROUTES = {\n  SETUP: "/a/setup",\n  LOGIN: "/a/sign-in",\n} as const;\n`;
    expect(routeFromTable(source, TABLE, "LOGIN")).toBe("/a/sign-in");
    expect(routeFromTable(source, TABLE, "SETUP")).toBe("/a/setup");
  });

  it("refuses a table it cannot read the entry from, rather than guessing", () => {
    expect(() =>
      routeFromTable(`export const ROUTES = { HOME: "/a" };`, TABLE, "LOGIN")
    ).toThrow(/LOGIN/);
    expect(() =>
      routeFromTable(`export const OTHER = { LOGIN: "/a" };`, TABLE, "LOGIN")
    ).toThrow(/ROUTES/);
    expect(() =>
      routeFromTable(
        `export const ROUTES = { LOGIN: base + "/x" };`,
        TABLE,
        "LOGIN"
      )
    ).toThrow(/LOGIN/);
  });

  it("is the admin's own sign-in route", () => {
    expect(SIGN_IN_PATH).toMatch(/^\/admin\/\w/);
  });
});

describe("which admin screens a visitor reaches without a session", () => {
  const TABLE = "routes.ts";
  const source = [
    'export const ROUTES = { SETUP: "/a/setup", LOGIN: "/a/sign-in", HOME: "/a" } as const;',
    'export const PUBLIC_ROUTE_PATHS: readonly ["/a/sign-in", "/a/setup"] = [ROUTES.LOGIN, ROUTES.SETUP] as const;',
  ].join("\n");

  it("is read from the route table's public list, each entry resolved through ROUTES", () => {
    expect(publicRoutesFromTable(source, TABLE)).toEqual([
      "/a/sign-in",
      "/a/setup",
    ]);
  });

  it("refuses a table with no public list, or an entry it cannot resolve", () => {
    expect(() => publicRoutesFromTable(source.split("\n")[0], TABLE)).toThrow(
      /PUBLIC_ROUTE_PATHS/
    );
    expect(() =>
      publicRoutesFromTable(
        `export const ROUTES = { LOGIN: "/a" };\nexport const PUBLIC_ROUTE_PATHS = [ROUTES.GONE];`,
        TABLE
      )
    ).toThrow(/GONE/);
  });

  it("matches a route by its path alone, as the admin does", () => {
    expect(isPublicRoute("/admin/login")).toBe(true);
    expect(isPublicRoute("/admin/reset-password?token=x")).toBe(true);
    expect(isPublicRoute("/admin/accept-invite")).toBe(true);
    expect(isPublicRoute("/admin")).toBe(false);
    expect(isPublicRoute("/admin/login/extra")).toBe(false);
  });
});

describe("whether a route answered at all", () => {
  it("fails a route that answers 400 or more, or lands on the sign-in page", () => {
    expect(
      routeFailure({
        route: "/admin/missing",
        status: 404,
        finalUrl: "http://localhost:1/admin/missing",
      })
    ).toMatch(/answered 404/);
    expect(
      routeFailure({
        route: "/admin/x",
        status: 500,
        finalUrl: "http://localhost:1/admin/x",
      })
    ).toMatch(/answered 500/);
    expect(
      routeFailure({
        route: "/admin/private",
        status: 200,
        finalUrl: "http://localhost:1/admin/login?next=x",
      })
    ).toMatch(/sign-in/);
  });

  it("passes a route that answered and stayed, including the sign-in page asked for by name", () => {
    expect(
      routeFailure({
        route: "/admin",
        status: 200,
        finalUrl: "http://localhost:1/admin",
      })
    ).toBeNull();
    expect(
      routeFailure({
        route: "/admin",
        status: 304,
        finalUrl: "http://localhost:1/admin",
      })
    ).toBeNull();
    expect(
      routeFailure({
        route: "/admin/login",
        status: 200,
        finalUrl: "http://localhost:1/admin/login",
      })
    ).toBeNull();
  });
});
