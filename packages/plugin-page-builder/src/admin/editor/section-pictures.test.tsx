/**
 * @vitest-environment jsdom
 */

/**
 * A saved section's picture in the Add panel, as the editor supplies it: its
 * published document, drawn with this site's rendering, in the mode the canvas
 * is previewed in.
 *
 * The real hook feeds the real picture part and the real renderer; only the
 * plugin's config and its block resolver are stood in for. Each case names
 * the broken version it rules out:
 *
 * - In a dark preview the drawn section carries the site's dark marker, so
 *   the site's dark token values apply to it, and its box takes the dark
 *   scheme; in a light one, the light marker and scheme. A hook that dropped
 *   the mode would draw every picture in the page's own mode.
 * - With no mode picked, no marker is stated: the section draws as published.
 * - A component the section names is drawn from the editor's definitions;
 *   one missing from them shows the saved section's icon, not a broken
 *   picture.
 *
 * @module admin/editor/section-pictures.test
 */
import {
  COMPONENT_INSTANCE_TYPE,
  DARK_MODE_ATTRIBUTE,
  type BlockDocument,
  type DefinitionsById,
  type TokenMode,
} from "@nextlyhq/blocks-engine";
import {
  createMiniatureSession,
  type PatternInsertEntry,
} from "@nextlyhq/builder/shell";
import { act, cleanup, render } from "@testing-library/react";
import type { JSX } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SiteStyleData } from "../../site-style";

import {
  useSectionPictures,
  type SectionPictureInputs,
} from "./section-pictures";

vi.mock("../entry-block-resolver", async () => {
  const { createBlockResolver, defineBlock } = await import(
    "@nextlyhq/blocks-react"
  );
  const { createElement } = await import("react");
  const text = defineBlock<{ text: string }>({
    name: "acme/text",
    version: 1,
    description: "A line of text.",
    example: { props: { text: "" } },
    defaultProps: { text: "" },
    render: ({ className, props }) =>
      createElement("p", { className, "data-testid": "drawn" }, props.text),
  });
  const resolver = createBlockResolver([text] as never);
  return { entryBlockResolver: () => resolver };
});

const CONFIG = {};
vi.mock("@nextlyhq/plugin-sdk/admin", async importOriginal => ({
  ...(await importOriginal<typeof import("@nextlyhq/plugin-sdk/admin")>()),
  usePluginClientConfig: () => CONFIG,
}));

/** A site whose ground token has a light and a dark value. */
const SITE: SiteStyleData = {
  tokens: {
    tokens: [
      {
        name: "colour.ground",
        kind: "color",
        values: { light: "#fafafa", dark: "#101010" },
      },
    ],
  },
} as SiteStyleData;

const NONE: DefinitionsById = new Map();

function sectionOf(...nodes: BlockDocument["nodes"]): PatternInsertEntry {
  return {
    kind: "pattern",
    document: { formatVersion: 1, kind: "pattern", nodes } as BlockDocument,
  } as unknown as PatternInsertEntry;
}

const HERO = sectionOf({
  id: "00000000-0000-4000-8000-0000000000b1",
  type: "acme/text",
  version: 1,
  props: { text: "Hero" },
});

/** Shows every picture on screen, as the panel's row scrolling in would. */
function showOnScreen(): () => void {
  const callbacks: IntersectionObserverCallback[] = [];
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(callback: IntersectionObserverCallback) {
        callbacks.push(callback);
      }
      observe(): void {}
      disconnect(): void {}
    }
  );
  return () => {
    for (const callback of callbacks) {
      callback(
        [{ isIntersecting: true } as IntersectionObserverEntry],
        {} as IntersectionObserver
      );
    }
  };
}

function Picture({
  entry,
  ...inputs
}: SectionPictureInputs & { entry: PatternInsertEntry }): JSX.Element {
  const renderPicture = useSectionPictures(inputs);
  return <>{renderPicture(entry)}</>;
}

/** The text the section's blocks drew, read past the site's sheet. */
function drawnText(container: HTMLElement): string[] {
  return [
    ...container.querySelectorAll('.nx-picture__page [data-testid="drawn"]'),
  ].map(element => element.textContent ?? "");
}

function draw(
  entry: PatternInsertEntry,
  mode: TokenMode | null,
  definitions: DefinitionsById = NONE
): HTMLElement {
  const show = showOnScreen();
  const { container } = render(
    <Picture
      entry={entry}
      siteStyle={SITE}
      definitions={definitions}
      mode={mode}
      session={createMiniatureSession()}
    />
  );
  act(() => show());
  return container;
}

beforeEach(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("a saved section's picture", () => {
  it.each(["light", "dark"] as const)(
    "draws the section in the canvas's %s preview",
    mode => {
      const container = draw(HERO, mode);
      const frame = container.querySelector<HTMLElement>(".nx-picture");
      const page = container.querySelector(".nx-picture__page");

      expect(frame?.getAttribute("data-state")).toBe("drawn");
      expect(drawnText(container)).toEqual(["Hero"]);
      expect(page?.getAttribute(DARK_MODE_ATTRIBUTE)).toBe(mode);
      expect(frame?.style.colorScheme).toBe(mode);
      // The site's own sheet is drawn with it, with the dark value keyed on
      // the marker the page carries: the canvas's rule, not one of the
      // picture's.
      const sheets = [...container.querySelectorAll("style")]
        .map(style => style.textContent ?? "")
        .join("\n");
      expect(sheets).toContain(`[${DARK_MODE_ATTRIBUTE}="dark"]`);
      expect(sheets).toContain("#101010");
    }
  );

  it("states no mode when the canvas shows the page's own", () => {
    const container = draw(HERO, null);
    const page = container.querySelector(".nx-picture__page");
    expect(drawnText(container)).toEqual(["Hero"]);
    expect(page?.hasAttribute(DARK_MODE_ATTRIBUTE)).toBe(false);
    expect(
      container.querySelector<HTMLElement>(".nx-picture")?.style.colorScheme
    ).toBe("");
  });

  it("draws a component the section names from the editor's definitions", () => {
    const instance = sectionOf({
      id: "00000000-0000-4000-8000-0000000000c1",
      type: COMPONENT_INSTANCE_TYPE,
      version: 1,
      props: { componentId: "banner" },
    });
    const definitions: DefinitionsById = new Map([
      [
        "banner",
        {
          formatVersion: 1,
          kind: "component",
          nodes: [
            {
              id: "00000000-0000-4000-8000-0000000000c2",
              type: "acme/text",
              version: 1,
              props: { text: "Banner" },
            },
          ],
        } as unknown as BlockDocument,
      ],
    ]);

    const drawn = draw(instance, null, definitions);
    expect(drawn.querySelector(".nx-picture")?.getAttribute("data-state")).toBe(
      "drawn"
    );
    expect(drawnText(drawn)).toEqual(["Banner"]);
    cleanup();

    // The same section once its component is gone: the section's icon.
    const missing = draw(instance, null, NONE);
    const frame = missing.querySelector(".nx-picture");
    expect(frame?.getAttribute("data-state")).toBe("failed");
    expect(missing.querySelector(".nx-picture__page")).toBeNull();
    expect(frame?.querySelector(".nx-block-icon")).not.toBeNull();
  });
});
