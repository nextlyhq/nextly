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
  COMPONENT_INSTANCE_TYPE,
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
import { layerLabel } from "@nextlyhq/builder";

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
      {
        id: "hero",
        target: "hero",
        parts: ["hero"],
        number: 1,
        label: "Section",
        firstLine: "Welcome to Acme",
      },
      {
        id: "intro",
        target: "intro",
        parts: ["intro"],
        number: 2,
        label: "Text",
        firstLine: "Plain words first.",
      },
      {
        id: "rule",
        target: "rule",
        parts: ["rule"],
        number: 3,
        label: "Divider",
        firstLine: "",
      },
      {
        id: "plans",
        target: "plans",
        parts: ["plans"],
        number: 4,
        label: "Pricing",
        firstLine: "Plans for teams",
      },
      {
        id: "contact",
        target: "contact",
        parts: ["contact"],
        number: 5,
        label: "Heading",
        firstLine: "Contact us",
      },
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
            conditions: [[{ field: "role", op: "equals", value: "member" }]],
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

  it("opens a component's section at the instance the editor holds, not the ids it was drawn with", () => {
    // A placed component draws as its definition's nodes, which carry ids
    // minted for the drawing. The editor's document holds the INSTANCE, so a
    // section opened by a drawn id would select nothing.
    const instance = {
      id: "i1",
      type: COMPONENT_INSTANCE_TYPE,
      version: 1,
      props: { componentId: "header" },
    } as BlockNode;
    const withHeader = pageRenderInputs({
      siteStyle: undefined,
      clientConfig: undefined,
      previewContainer: undefined,
      limits: DEFAULT_LIMITS,
      definitions: new Map([
        [
          "header",
          {
            ...page([block("d1", "core/heading", { text: "Site header" })]),
            kind: "component",
          },
        ],
      ]) as never,
    });

    const sections = pageSections(
      page([block("intro", "core/text", { text: "Hello" }), instance]),
      entryBlockResolver(),
      withHeader
    );

    const header = sections[1];
    expect(header?.target).toBe("i1");
    expect(header?.id).not.toBe("i1");
    expect(header?.firstLine).toBe("Site header");
    // Named as Layers names what the author placed: the instance.
    expect(header?.label).toBe(
      layerLabel(instance, type => entryBlockResolver().get(type))
    );
    // An ordinary section opens at its own id.
    expect(sections[0]?.target).toBe("intro");
  });

  it("names a placed component's section by the component's title", () => {
    const instance = {
      id: "i1",
      type: COMPONENT_INSTANCE_TYPE,
      version: 1,
      props: { componentId: "header" },
    } as BlockNode;
    const withHeader = pageRenderInputs({
      siteStyle: undefined,
      clientConfig: undefined,
      previewContainer: undefined,
      limits: DEFAULT_LIMITS,
      definitions: new Map([
        [
          "header",
          {
            ...page([block("d1", "core/heading", { text: "Site header" })]),
            kind: "component",
          },
        ],
      ]) as never,
    });
    const document = page([instance]);
    const titleOf = (id: string) =>
      id === "header" ? "Header with logo" : undefined;

    expect(
      pageSections(document, entryBlockResolver(), withHeader, titleOf)[0]
        ?.label
    ).toBe("Header with logo");
    // With no title to read, it is a component, not the engine's word for one.
    expect(
      pageSections(document, entryBlockResolver(), withHeader)[0]?.label
    ).toBe("Component");
  });

  it("lists a placed component with several top-level parts as one section", () => {
    // The author placed ONE thing. Listed per drawn root, it showed as several
    // sections that all opened the same instance, and the list's numbers no
    // longer counted what the author placed.
    const instance = {
      id: "i1",
      type: COMPONENT_INSTANCE_TYPE,
      version: 1,
      props: { componentId: "band" },
    } as BlockNode;
    const withBand = pageRenderInputs({
      siteStyle: undefined,
      clientConfig: undefined,
      previewContainer: undefined,
      limits: DEFAULT_LIMITS,
      definitions: new Map([
        [
          "band",
          {
            ...page([
              block("d1", "core/heading", { text: "Band title" }),
              block("d2", "core/text", { text: "Band words" }),
            ]),
            kind: "component",
          },
        ],
      ]) as never,
    });

    const sections = pageSections(
      page([instance, block("after", "core/heading", { text: "After" })]),
      entryBlockResolver(),
      withBand
    );

    expect(sections.map(({ target, number }) => [target, number])).toEqual([
      ["i1", 1],
      ["after", 2],
    ]);
    const band = sections[0];
    // Both drawn roots belong to it, so the preview can cover the whole of it.
    expect(band?.parts).toHaveLength(2);
    expect(band?.parts[0]).toBe(band?.id);
    expect(band?.firstLine).toBe("Band title");
  });

  it("keeps a block the preview draws as a placeholder in its place", () => {
    // A block nothing registers still takes a place on the drawn page. Left
    // out, every number after it would point one section too high.
    const sections = sectionsOf(
      page([
        block("a", "core/heading", { text: "First" }),
        {
          id: "gone",
          type: "acme/removed",
          version: 1,
          props: {},
        } as BlockNode,
        block("b", "core/heading", { text: "Second" }),
      ])
    );

    expect(sections.map(({ target, number }) => [target, number])).toEqual([
      ["a", 1],
      ["gone", 2],
      ["b", 3],
    ]);
  });

  it("lists nothing for a value that is not a readable document", () => {
    expect(pageSections(undefined, entryBlockResolver(), render)).toEqual([]);
    expect(
      pageSections({ nodes: "not a list" }, entryBlockResolver(), render)
    ).toEqual([]);
  });
});
