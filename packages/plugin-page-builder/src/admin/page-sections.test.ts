/**
 * The page's sections as the entry screen lists them.
 *
 * Five sections of different kinds, because the plausible wrong versions each
 * pass on a uniform page: one that reads the first line from the section's own
 * props misses a heading nested inside a container; one that takes the first
 * text it meets puts a paragraph above the heading that names the section; one
 * that names by type ignores the author's own name; and one listing the stored
 * nodes rather than the drawn ones numbers a section the preview never shows.
 */
import {
  DEFAULT_LIMITS,
  DOCUMENT_FORMAT_VERSION,
  type BlockDocument,
  type BlockNode,
} from "@nextlyhq/blocks-engine";
import { coreBlocks } from "@nextlyhq/blocks-react/blocks";
import { describe, expect, it } from "vitest";

import { entryBlockResolver } from "./entry-block-resolver";
import { pageRenderInputs } from "./page-render-inputs";
import { pageSections } from "./page-sections";

function versionOf(type: string): number {
  const block = coreBlocks.find(candidate => candidate.name === type);
  if (!block) throw new Error(`${type} is missing from coreBlocks`);
  return block.version;
}

function block(
  id: string,
  type: string,
  props: Record<string, unknown> = {},
  extra: Partial<BlockNode> = {}
): BlockNode {
  return { id, type, version: versionOf(type), props, ...extra } as BlockNode;
}

function page(nodes: BlockNode[]): BlockDocument {
  return {
    formatVersion: DOCUMENT_FORMAT_VERSION,
    kind: "page",
    nodes,
  } as BlockDocument;
}

const render = pageRenderInputs({
  siteStyle: undefined,
  clientConfig: undefined,
  previewContainer: undefined,
  limits: DEFAULT_LIMITS,
  definitions: new Map(),
});

function sectionsOf(document: BlockDocument) {
  return pageSections(document, entryBlockResolver(), render);
}

describe("pageSections", () => {
  it("lists five sections of different kinds in page order, each named and with its first line", () => {
    const sections = sectionsOf(
      page([
        // A heading nested in a container, AFTER a paragraph: the heading
        // names the section.
        block(
          "hero",
          "core/section",
          {},
          {
            slots: {
              children: [
                block("hero-text", "core/text", { text: "We build tools." }),
                block("hero-title", "core/heading", {
                  text: "Welcome to Acme",
                }),
              ],
            },
          }
        ),
        block("intro", "core/text", { text: "Plain words first." }),
        // No text at all.
        block("rule", "core/divider"),
        // The author's own name wins over the block's.
        block(
          "plans",
          "core/section",
          {},
          {
            name: "Pricing",
            slots: {
              children: [
                block("plans-text", "core/text", { text: "Plans for teams" }),
              ],
            },
          }
        ),
        block("contact", "core/heading", { text: "Contact us" }),
      ])
    );

    expect(sections).toEqual([
      { id: "hero", number: 1, label: "Section", firstLine: "Welcome to Acme" },
      {
        id: "intro",
        number: 2,
        label: "Text",
        firstLine: "Plain words first.",
      },
      { id: "rule", number: 3, label: "Divider", firstLine: "" },
      {
        id: "plans",
        number: 4,
        label: "Pricing",
        firstLine: "Plans for teams",
      },
      { id: "contact", number: 5, label: "Heading", firstLine: "Contact us" },
    ]);
  });

  it("lists only the sections the preview draws, numbered as drawn", () => {
    // A condition is decided per visitor at render time, so the preview, like
    // the published renderer, leaves the section out. Numbering it here would
    // put a "2" in the list that matches nothing on the page above it.
    const sections = sectionsOf(
      page([
        block("a", "core/heading", { text: "First" }),
        block("gated", "core/heading", { text: "Members only" }, {
          visibility: {
            conditions: [
              [{ field: "role", operator: "equals", value: "member" }],
            ],
          },
        } as Partial<BlockNode>),
        block("b", "core/heading", { text: "Second" }),
      ])
    );

    expect(sections.map(({ id, number }) => [id, number])).toEqual([
      ["a", 1],
      ["b", 2],
    ]);
  });

  it("lists nothing for a value that is not a readable document", () => {
    expect(pageSections(undefined, entryBlockResolver(), render)).toEqual([]);
    expect(
      pageSections({ nodes: "not a list" }, entryBlockResolver(), render)
    ).toEqual([]);
  });
});
