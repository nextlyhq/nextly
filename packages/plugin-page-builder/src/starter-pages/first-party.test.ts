/**
 * The page builder's own starter pages, judged as a site judges them at
 * start-up, and held to what makes them take a site's look: core blocks
 * only, every colour a variable, no font name, and every variable one a
 * fresh site has.
 *
 * A built-in starter that fails the boot judgement is LEFT OUT rather than
 * refusing the boot, so the first case counts them: a starter that broke
 * would otherwise vanish from the list with every test still green.
 */
import {
  createBlockRegistry,
  DEFAULT_LIMITS,
  resolveSiteTokens,
  tokenIdentity,
  walkNodes,
  type BlockNode,
} from "@nextlyhq/blocks-engine";
import { coreBlocks } from "@nextlyhq/blocks-react/blocks";
import { describe, expect, it } from "vitest";

import { siteBreakpoints } from "../site-style";

import { FIRST_PARTY_STARTER_PAGES } from "./first-party";
import { BUILT_IN_STARTER_FLOOR, starterFit } from "./starter-fit";
import { registerStarterPagesAtBoot } from "./starter-pages";

const blocks = createBlockRegistry();
blocks.register(coreBlocks, { source: "@nextlyhq/plugin-page-builder" });

/** Every block of a starter, nested ones included. */
function nodesOf(starter: { blocks: readonly BlockNode[] }): BlockNode[] {
  const found: BlockNode[] = [];
  walkNodes([...starter.blocks], node => {
    found.push(node);
  });
  return found;
}

/**
 * The leaves of one property's value, each a plain value or a variable: a
 * box's four sides and a border's parts stay under the property they set.
 */
function leavesOf(
  property: string,
  value: unknown
): { property: string; value: unknown }[] {
  if (Array.isArray(value)) {
    return value.flatMap(entry => leavesOf(property, entry));
  }
  if (typeof value === "object" && value !== null && !("$token" in value)) {
    return Object.values(value).flatMap(entry => leavesOf(property, entry));
  }
  return [{ property, value }];
}

/**
 * Every value a node's styles hold, with the CSS property it sets, read in
 * the shape styles are stored in: by device, then by state, then property.
 */
function styleValues(styles: unknown): { property: string; value: unknown }[] {
  if (typeof styles !== "object" || styles === null) return [];
  return Object.values(styles).flatMap(byState =>
    typeof byState !== "object" || byState === null
      ? []
      : Object.values(byState).flatMap(values =>
          typeof values !== "object" || values === null
            ? []
            : Object.entries(values).flatMap(([property, value]) =>
                leavesOf(property, value)
              )
        )
  );
}

/** A colour written as a value rather than named by a variable. */
const RAW_COLOUR =
  /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|oklch|oklab|lab|lch|color)\(/i;

/** The variables a fresh site has, by identity. */
const SITE_VARIABLES = new Set(
  resolveSiteTokens().tokens.map(token => tokenIdentity(token))
);

describe("the page builder's own starter pages", () => {
  it("never stop a site starting, however tight its limits: each it can't hold is kept and named in the log", () => {
    // A site allowing pages four levels deep. The landing, about, contact
    // and pricing pages nest deeper; each is kept, listed as unavailable, and
    // said once in the log with how deep it needs and what the site allows.
    const lines: string[] = [];
    const registered = registerStarterPagesAtBoot(
      {
        config: { plugins: [] } as never,
        logger: { info: (line: string) => lines.push(line) } as never,
      },
      {},
      FIRST_PARTY_STARTER_PAGES,
      {
        blocks,
        breakpoints: siteBreakpoints(),
        limits: { ...DEFAULT_LIMITS, maxDepth: 4 },
      }
    );
    expect(registered.map(entry => entry.starter.id)).toEqual(
      FIRST_PARTY_STARTER_PAGES.map(starter => starter.id)
    );
    expect(lines).toEqual([
      '[page-builder] The starter page "Landing" isn\'t available on this site. Needs 5 levels of nesting; this site allows 4.',
      '[page-builder] The starter page "About" isn\'t available on this site. Needs 5 levels of nesting; this site allows 4.',
      '[page-builder] The starter page "Contact" isn\'t available on this site. Needs 6 levels of nesting; this site allows 4.',
      '[page-builder] The starter page "Pricing" isn\'t available on this site. Needs 6 levels of nesting; this site allows 4.',
    ]);
  });

  it("each fit the documented floor, so a site at or above it offers every one", () => {
    // A starter that grows past the floor fails here, rather than starting to
    // show as unavailable on sites that set their limits to it.
    for (const starter of FIRST_PARTY_STARTER_PAGES) {
      expect(
        starterFit(starter, { blocks }, BUILT_IN_STARTER_FLOOR),
        starter.id
      ).toBeUndefined();
    }
  });

  it("have a floor no higher than the engine's defaults, which they are judged against at start-up", () => {
    // The start-up check uses the defaults and the floor test uses the floor:
    // a floor above the defaults would let a starter pass one and fail the
    // other.
    for (const limit of ["maxDepth", "maxNodes", "maxBytes"] as const) {
      expect(BUILT_IN_STARTER_FLOOR[limit], limit).toBeLessThanOrEqual(
        DEFAULT_LIMITS[limit]
      );
    }
  });

  it("are all offered, none left out, judged as a site judges them at start-up", () => {
    const registered = registerStarterPagesAtBoot(
      {
        config: { plugins: [] } as never,
        logger: { info: () => undefined } as never,
      },
      {},
      FIRST_PARTY_STARTER_PAGES,
      { blocks, breakpoints: siteBreakpoints() }
    );
    expect(registered.map(entry => entry.starter.id)).toEqual([
      "landing",
      "about",
      "contact",
      "pricing",
      "coming-soon",
    ]);
    expect(registered.every(entry => entry.builtIn)).toBe(true);
  });

  it("are named Landing, About, Contact, Pricing and Coming soon, each with a description", () => {
    expect(FIRST_PARTY_STARTER_PAGES.map(starter => starter.label)).toEqual([
      "Landing",
      "About",
      "Contact",
      "Pricing",
      "Coming soon",
    ]);
    for (const starter of FIRST_PARTY_STARTER_PAGES) {
      expect(starter.description.length).toBeGreaterThan(20);
    }
  });

  it("are built from core blocks only", () => {
    for (const starter of FIRST_PARTY_STARTER_PAGES) {
      const types = nodesOf(starter).map(node => node.type);
      expect(
        types.filter(type => !type.startsWith("core/")),
        starter.id
      ).toEqual([]);
    }
  });

  it("name no colour and no font: every colour is one of the site's variables", () => {
    for (const starter of FIRST_PARTY_STARTER_PAGES) {
      for (const node of nodesOf(starter)) {
        for (const { property, value } of styleValues(node.styles)) {
          const where = `${starter.id} ${node.id} ${property}`;
          expect(property, where).not.toBe("fontFamily");
          if (typeof value === "string") {
            expect(value, where).not.toMatch(RAW_COLOUR);
          }
          if (/colou?r$/i.test(property) && typeof value === "string") {
            // The one colour word allowed: no fill at all.
            expect(value, where).toBe("transparent");
          }
          if (property === "fontSize" && typeof value === "string") {
            expect(value, where).toBe("inherit");
          }
        }
      }
    }
  });

  it("use only variables a fresh site has, so none is left out for a missing one", () => {
    for (const starter of FIRST_PARTY_STARTER_PAGES) {
      for (const node of nodesOf(starter)) {
        for (const { value } of styleValues(node.styles)) {
          if (
            typeof value === "object" &&
            value !== null &&
            "$token" in value
          ) {
            expect(
              SITE_VARIABLES.has(String(value.$token)),
              `${starter.id} ${node.id} ${String(value.$token)}`
            ).toBe(true);
          }
        }
      }
    }
  });

  it("leave every Image empty, for the author's own picture", () => {
    const images = FIRST_PARTY_STARTER_PAGES.flatMap(starter =>
      nodesOf(starter).filter(node => node.type === "core/image")
    );
    expect(images.length).toBeGreaterThan(0);
    for (const image of images) {
      expect(image.props?.src, image.id).toBeUndefined();
      expect(image.props?.mediaId, image.id).toBeUndefined();
    }
  });

  it("give Contact a Form for a name, an email and a message, and Coming soon one for an email", () => {
    const formOf = (id: string) => {
      const starter = FIRST_PARTY_STARTER_PAGES.find(entry => entry.id === id);
      if (starter === undefined) throw new Error(`no ${id} starter`);
      const forms = nodesOf(starter).filter(node => node.type === "core/form");
      expect(forms, id).toHaveLength(1);
      return forms[0]?.props as {
        fields: { label: string; type: string; required: boolean }[];
        afterSending: string;
        message: string;
      };
    };
    const contact = formOf("contact");
    expect(contact.fields.map(field => [field.label, field.type])).toEqual([
      ["Name", "text"],
      ["Email", "email"],
      ["Message", "textarea"],
    ]);
    expect(contact.afterSending).toBe("message");
    expect(formOf("coming-soon").fields.map(field => field.type)).toEqual([
      "email",
    ]);
  });

  it("give every block an id of its own within its page", () => {
    for (const starter of FIRST_PARTY_STARTER_PAGES) {
      const ids = nodesOf(starter).map(node => node.id);
      expect(new Set(ids).size, starter.id).toBe(ids.length);
    }
  });
});
