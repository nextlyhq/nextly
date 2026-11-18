/**
 * A Section's padding as Compact, Normal or Roomy.
 *
 * Normal is the prop left out: a Section that never picked a preset stores
 * nothing new and renders, markup and sheet, exactly as before presets
 * existed. Compact and Roomy pad it from their own pair of the site's spacing
 * variables, on the published page and on the canvas alike, since both are
 * drawn by the same renderer from the same compile.
 */
import {
  DOCUMENT_FORMAT_VERSION,
  nodeClassName,
  PAGE_ROOT_CLASS,
  type AnyBlockDefinition,
  type BlockDocument,
  type BlockNode,
  type StyleCompileContext,
} from "@nextlyhq/blocks-engine";
import { renderToReadableStream } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { createStandaloneContext } from "../context";
import { PageRenderer } from "../page-renderer";
import { createBlockResolver } from "../resolver";
import { resolvePageStyles } from "../styles";

import { coreBlocks } from "./index";
import { section } from "./section";

const blocks = createBlockResolver(coreBlocks as AnyBlockDefinition[]);

const CONTEXT: Pick<StyleCompileContext, "breakpoints"> = {
  breakpoints: {
    viewport: [{ id: "base", label: "Desktop" }],
    container: [],
  },
};

function band(id: string, props: Record<string, unknown> = {}): BlockNode {
  return {
    id,
    type: "core/section",
    version: 1,
    props: { as: "section", contained: true, ...props },
    slots: {
      children: [
        {
          id: `${id}-t`,
          type: "core/text",
          version: 1,
          props: { text: "A band" },
        },
      ],
    },
  };
}

function page(nodes: BlockNode[]): BlockDocument {
  return { formatVersion: DOCUMENT_FORMAT_VERSION, kind: "page", nodes };
}

/** The page's sheet as the published page and the canvas compile it. */
function sheet(nodes: BlockNode[], preview = false): string {
  return (
    resolvePageStyles(
      page(nodes),
      undefined,
      {
        ...CONTEXT,
        ...(preview
          ? { previewStates: true, previewContainer: "nx-canvas" }
          : {}),
      },
      blocks
    ).css ?? ""
  );
}

/** The page's markup, without React's streaming scripts. */
async function markup(nodes: BlockNode[]): Promise<string> {
  const stream = await renderToReadableStream(
    <PageRenderer
      document={page(nodes)}
      blocks={blocks}
      context={createStandaloneContext({})}
    />
  );
  const html = await new Response(stream).text();
  return html.replace(/<script>[\s\S]*?<\/script>/g, "");
}

/** The one-block rule a preset writes, its sides at least the inset. */
function presetRule(id: string, preset: "compact" | "roomy"): string {
  const side = `max(var(--site-space-gutter-${preset}), var(--nx-contain-inset, 0px))`;
  return `.${PAGE_ROOT_CLASS} :where(.${nodeClassName(id)}) { padding-block-end: var(--site-space-section-y-${preset}); padding-block-start: var(--site-space-section-y-${preset}); padding-inline-end: ${side}; padding-inline-start: ${side} }`;
}

describe("a Section's Padding setting", () => {
  it("offers Compact, Normal and Roomy in Style › Spacing", () => {
    expect(section.props?.paddingPreset).toMatchObject({
      label: "Padding",
      type: "select",
      options: ["compact", "normal", "roomy"],
      optionLabels: { compact: "Compact", normal: "Normal", roomy: "Roomy" },
      group: "style",
      section: "spacing",
    });
  });

  it("starts at Normal by storing nothing", () => {
    expect(section.defaultProps).not.toHaveProperty("paddingPreset");
    expect(section.example.props).not.toHaveProperty("paddingPreset");
  });
});

describe("Normal is today's padding", () => {
  it("pads from the site's section spacing, and writes nothing of its own", () => {
    const css = sheet([band("s")]);
    expect(css).toContain(
      `.${PAGE_ROOT_CLASS} :where(.nx-bt-core--section) { padding-block-end: var(--site-space-section-y); padding-block-start: var(--site-space-section-y); padding-inline-end: max(var(--site-space-gutter), var(--nx-contain-inset, 0px)); padding-inline-start: max(var(--site-space-gutter), var(--nx-contain-inset, 0px)) }`
    );
    expect(css).not.toContain(`:where(.${nodeClassName("s")})`);
    expect(css).not.toMatch(/-compact|-roomy/);
  });
});

describe("a Section stored before presets", () => {
  // Held as written, rendered by the Section as it was before presets, never
  // read back from the block now.
  const STORED_MARKUP =
    '<div class="nx-pb-page"><section class="nx-pb-2d8ny8vr4hu nx-bt-core--section nx-pb-contained"><p class="nx-pb-22027z9qio3 nx-bt-core--text">A band</p></section></div>';

  it("renders the same markup", async () => {
    expect(await markup([band("s")])).toBe(STORED_MARKUP);
  });

  it("compiles the same sheet whether it stores Normal or nothing", () => {
    expect(sheet([band("s", { paddingPreset: "normal" })])).toBe(
      sheet([band("s")])
    );
  });
});

describe.each([
  ["the published page", false],
  ["the canvas", true],
] as const)("Compact and Roomy on %s", (_where, preview) => {
  it.each(["compact", "roomy"] as const)(
    "pads a %s section from its own pair of variables",
    preset => {
      const css = sheet([band("s", { paddingPreset: preset })], preview);
      expect(css).toContain(presetRule("s", preset));
    }
  );

  it("leaves a Normal section beside them on the site's section spacing", () => {
    const css = sheet(
      [band("a", { paddingPreset: "compact" }), band("b")],
      preview
    );
    expect(css).toContain(presetRule("a", "compact"));
    expect(css).not.toContain(`:where(.${nodeClassName("b")})`);
  });
});

describe("a preset section's markup", () => {
  it("is a Normal section's: the padding is in the sheet, not on the element", async () => {
    const html = await markup([band("s", { paddingPreset: "roomy" })]);
    expect(html).toBe(await markup([band("s")]));
  });
});
