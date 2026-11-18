/**
 * @vitest-environment jsdom
 */

/**
 * A set's picture in the "Header & footer" menu: its published header above
 * its footer, drawn with the real picture part and the real renderer from the
 * definitions the choices read sent. Only the plugin's config, its block
 * resolver, the site's style read and the media context are stood in for.
 *
 * Each case names the broken version it rules out:
 *
 * - A set with a header and a footer draws both, header first. A hook that
 *   drew one region, or drew them from the editor's draft definitions, would
 *   not show both published texts.
 * - Before the read holding a set's definitions has arrived, its picture is a
 *   placeholder, not the broken-picture icon a missing definition draws.
 * - Once that read is done, a region still without its definition shows the
 *   set's icon: it is missing, not on its way.
 * - "None", and a set with nothing published, draw the empty frame.
 *
 * @module admin/header-footer-pictures.test
 */
import { type BlockDocument, type LayoutRegion } from "@nextlyhq/blocks-engine";
import { act, cleanup, render } from "@testing-library/react";
import type { JSX } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useSetPictures } from "./header-footer-pictures";

vi.mock("./entry-block-resolver", async () => {
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

// The site's stored style, read through the admin elsewhere: none here.
vi.mock("./site-style-client", () => ({
  useSiteStyle: () => ({ siteStyle: undefined, pending: false, error: null }),
}));

// Media and icons resolved through the admin's reads elsewhere: none here.
vi.mock("./editor/canvas-page-context", () => ({
  usePictureContext: () => undefined,
}));

/** A published component holding one line of text. */
function textComponent(id: string, text: string): BlockDocument {
  return {
    formatVersion: 1,
    kind: "component",
    nodes: [
      {
        id: `00000000-0000-4000-8000-0000000000${id}`,
        type: "acme/text",
        version: 1,
        props: { text },
      },
    ],
  } as unknown as BlockDocument;
}

const DEFINITIONS: Readonly<Record<string, BlockDocument>> = {
  head: textComponent("a1", "Head"),
  foot: textComponent("a2", "Foot"),
};

const BOTH: readonly LayoutRegion[] = [
  { area: "header", componentId: "head" },
  { area: "footer", componentId: "foot" },
];

/** Shows every picture on screen, as a menu row scrolling in would. */
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
  picture,
  definitions,
  complete,
}: {
  picture: readonly LayoutRegion[];
  definitions: Readonly<Record<string, BlockDocument>>;
  complete: boolean;
}): JSX.Element {
  const draw = useSetPictures(definitions, complete);
  return <>{draw(picture)}</>;
}

function draw(
  picture: readonly LayoutRegion[],
  definitions: Readonly<Record<string, BlockDocument>> = DEFINITIONS,
  complete = true
): HTMLElement {
  const show = showOnScreen();
  const { container } = render(
    <Picture picture={picture} definitions={definitions} complete={complete} />
  );
  act(() => show());
  return container;
}

/** The text the set's regions drew, in order. */
function drawnText(container: HTMLElement): string[] {
  return [
    ...container.querySelectorAll('.nx-picture__page [data-testid="drawn"]'),
  ].map(element => element.textContent ?? "");
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

describe("a header & footer set's picture", () => {
  it("draws its published header above its footer", () => {
    const container = draw(BOTH);
    expect(
      container.querySelector(".nx-picture")?.getAttribute("data-state")
    ).toBe("drawn");
    expect(drawnText(container)).toEqual(["Head", "Foot"]);
  });

  it("waits quietly for a set whose definitions are still on their way", () => {
    const container = draw(BOTH, { head: DEFINITIONS.head! }, false);
    expect(container.querySelector(".nx-picture")).toBeNull();
    expect(
      container.querySelector('[data-slot="skeleton"], .animate-pulse')
    ).not.toBeNull();
  });

  it("shows the set's icon once the read is done and a region is still missing", () => {
    const container = draw(BOTH, { head: DEFINITIONS.head! }, true);
    const frame = container.querySelector(".nx-picture");
    expect(frame?.getAttribute("data-state")).toBe("failed");
    expect(frame?.querySelector(".nx-block-icon")).not.toBeNull();
  });

  it("draws the empty frame for None and for a set with nothing published", () => {
    const container = draw([]);
    expect(
      container.querySelector(".nx-picture")?.getAttribute("data-state")
    ).toBe("empty");
  });
});
