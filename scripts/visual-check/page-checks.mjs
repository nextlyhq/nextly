/**
 * What the visual check reads of each page before a person looks at it: did
 * the route answer, does the page scroll sideways, which elements end past the
 * viewport's right edge, and which serious accessibility violations axe finds.
 *
 * @module scripts/visual-check/page-checks
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  literalText,
  parseSource,
  walk,
} from "@nextlyhq/module-specifiers/parse-source";

import { scanAxe } from "../../e2e/tests/support/axe-scan.mjs";

import { ROOT } from "./browser.mjs";

/** The admin's route table, the one place its paths are written. */
const ROUTE_TABLE = path.join(
  ROOT,
  "packages",
  "admin",
  "src",
  "constants",
  "routes.ts"
);

/** An expression without the `as const` (or other assertion) wrapped round it. */
function unwrapped(node) {
  return node?.type === "TSAsExpression" ||
    node?.type === "TSSatisfiesExpression"
    ? unwrapped(node.expression)
    : node;
}

/** The name a property is keyed by, written bare or quoted. */
function keyName(property) {
  return property.key?.type === "Identifier"
    ? property.key.name
    : literalText(property.key);
}

/**
 * The path `ROUTES[key]` holds in a route table's source.
 *
 * Read with the repository's own parser rather than imported: the table is
 * TypeScript that imports `nextly`, which the check must not need built or
 * transpiled. Anything other than one literal path under that key is refused,
 * so a renamed table or a computed path fails the run instead of being guessed.
 */
export function routeFromTable(text, fileName, key) {
  let table;
  walk(parseSource(text, fileName).program, node => {
    if (node.type === "VariableDeclarator" && node.id?.name === "ROUTES") {
      table = unwrapped(node.init);
    }
  });
  if (table?.type !== "ObjectExpression") {
    throw new Error(
      `${fileName} declares no ROUTES object to read ${key} from.`
    );
  }
  const entry = table.properties.find(property => keyName(property) === key);
  const value = literalText(entry?.value);
  if (value === null) {
    throw new Error(`${fileName} has no literal ROUTES.${key} path.`);
  }
  return value;
}

/**
 * Where the admin sends a visitor with no session, read from its route table
 * (`ROUTES.LOGIN`). A capture of it in place of the route asked for is a
 * capture of the wrong page.
 */
export const SIGN_IN_PATH = routeFromTable(
  readFileSync(ROUTE_TABLE, "utf8"),
  ROUTE_TABLE,
  "LOGIN"
);

/** The impacts worth failing a run over; axe's "moderate" and "minor" are left to the reader. */
const FAILING_IMPACTS = new Set(["serious", "critical"]);

/**
 * Why a route cannot be captured, or null when it can: it answered 400 or
 * more, or it ended on the sign-in page without having asked for it.
 */
export function routeFailure({ route, status, finalUrl }) {
  if (status >= 400) return `${route} answered ${status}`;
  const landed = new URL(finalUrl).pathname;
  const asked = new URL(route, finalUrl).pathname;
  if (landed.startsWith(SIGN_IN_PATH) && !asked.startsWith(SIGN_IN_PATH)) {
    return `${route} was sent to the sign-in page (${landed}), so the session did not reach it`;
  }
  return null;
}

/**
 * How wide the document is against the viewport, and each visible element
 * whose box ends past the viewport's right edge, by a selector unique on the
 * page.
 *
 * Two kinds of element are left out because a reader never sees them past the
 * edge: one inside a box that clips or scrolls sideways and itself ends inside
 * the viewport (a wide table in a scrolling container), and one inside an
 * element already reported, which is part of the same overflow.
 */
export async function readOverflow(page) {
  return page.evaluate(() => {
    // Runs in the page, so its globals are read off `globalThis` rather than
    // from this node module's scope.
    const { CSS, document, getComputedStyle, window } = globalThis;
    const root = document.documentElement;
    const viewportWidth = root.clientWidth;
    // Sub-pixel layout can put a fitting box a fraction past the edge.
    const limit = viewportWidth + 1;
    const rightOf = element =>
      element.getBoundingClientRect().right + window.scrollX;

    const clippedInside = element => {
      for (
        let up = element.parentElement;
        up && up !== root;
        up = up.parentElement
      ) {
        if (
          getComputedStyle(up).overflowX !== "visible" &&
          rightOf(up) <= limit
        )
          return true;
      }
      return false;
    };

    const part = element => {
      const tag = element.tagName.toLowerCase();
      if (element.id) return `${tag}#${CSS.escape(element.id)}`;
      const classes = [...element.classList]
        .slice(0, 2)
        .map(name => `.${CSS.escape(name)}`);
      return tag + classes.join("");
    };
    // The shortest chain of parts, from the element up, that matches it alone.
    const selectorOf = element => {
      let selector = part(element);
      for (
        let up = element.parentElement;
        up && up !== root;
        up = up.parentElement
      ) {
        if (document.querySelectorAll(selector).length === 1) return selector;
        selector = `${part(up)} > ${selector}`;
      }
      return selector;
    };

    // Drawn, and with a box that ends past the edge.
    const drawnPastEdge = element => {
      const box = element.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) return false;
      const visible = element.checkVisibility({
        visibilityProperty: true,
        opacityProperty: true,
      });
      return visible && rightOf(element) > limit;
    };

    const reported = new Set();
    const insideReported = element => {
      for (let up = element.parentElement; up; up = up.parentElement) {
        if (reported.has(up)) return true;
      }
      return false;
    };

    // Document order visits each element before its descendants, so the
    // outermost element of an overflow is the one reported.
    const pastRightEdge = [];
    for (const element of document.body.querySelectorAll("*")) {
      if (!drawnPastEdge(element)) continue;
      if (insideReported(element) || clippedInside(element)) continue;
      reported.add(element);
      pastRightEdge.push({
        selector: selectorOf(element),
        right: Math.round(rightOf(element)),
      });
    }
    return { scrollWidth: root.scrollWidth, viewportWidth, pastRightEdge };
  });
}

/** axe's serious and critical AA violations, one per rule and element. */
export async function seriousViolations(page) {
  const { findings } = await scanAxe(page);
  return findings
    .filter(finding => FAILING_IMPACTS.has(finding.impact))
    .flatMap(finding =>
      finding.targets.map(selector => ({
        rule: finding.id,
        impact: finding.impact,
        selector,
      }))
    );
}

/** Every finding on the page as it is drawn now. */
export async function checkPage(page) {
  const overflow = await readOverflow(page);
  const findings = [];
  if (overflow.scrollWidth > overflow.viewportWidth) {
    findings.push({
      kind: "sideways",
      scrollWidth: overflow.scrollWidth,
      viewportWidth: overflow.viewportWidth,
    });
  }
  for (const element of overflow.pastRightEdge)
    findings.push({ kind: "past-edge", ...element });
  for (const violation of await seriousViolations(page))
    findings.push({ kind: "axe", ...violation });
  return findings;
}

/** One finding as a line, after `where` it was seen (route, width and scheme). */
export function describeFinding(where, finding) {
  switch (finding.kind) {
    case "sideways":
      return `${where}: the page scrolls sideways (document ${finding.scrollWidth} px wide, viewport ${finding.viewportWidth} px)`;
    case "past-edge":
      return `${where}: ${finding.selector} ends past the right edge (at ${finding.right} px)`;
    case "axe":
      return `${where}: axe ${finding.rule} (${finding.impact}) at ${finding.selector}`;
    default:
      return `${where}: ${JSON.stringify(finding)}`;
  }
}
