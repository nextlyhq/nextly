// @vitest-environment jsdom

/**
 * The picture part: what it draws, when, and what it shows instead.
 *
 * Each case names the broken version it rules out:
 *
 * - The documents are drawn by the renderer, top to bottom. A part that drew
 *   only the first, or its own stand-in, fails the order case.
 * - Nothing is drawn until the box is seen. A part that drew on mount would
 *   hold a panel up for every row in it.
 * - A document seen once in the session is drawn at once on a later mount.
 * - No documents shows the empty-frame icon; a host's "can't be drawn", a
 *   throw while drawing and a block the renderer left a placeholder for show
 *   the type icon and no page.
 * - The previewed mode is stated on the drawn page as the site's theme marker,
 *   both ways; with no mode none is stated.
 *
 * @module document-miniature.test
 */
import {
  DARK_MODE_ATTRIBUTE,
  type AnyBlockDefinition,
  type BlockDocument,
} from "@nextlyhq/blocks-engine";
import type { BlockResolver } from "@nextlyhq/blocks-react";
import { act, cleanup, render } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DocumentMiniature, type MiniatureRender } from "./document-miniature";
import { createMiniatureSession } from "./miniature-surface";

/** A block that draws its text, and one that throws. */
const BLOCKS: Record<string, AnyBlockDefinition> = {
  "acme/text": {
    name: "acme/text",
    version: 1,
    description: "Text.",
    example: { props: {} },
    render: ({ props }: { props: { text?: string } }) =>
      createElement("p", { "data-testid": "drawn" }, props.text ?? ""),
  } as never,
  "acme/broken": {
    name: "acme/broken",
    version: 1,
    description: "Throws.",
    example: { props: {} },
    render: () => {
      throw new Error("cannot draw");
    },
  } as never,
};

const RESOLVER: BlockResolver = { get: type => BLOCKS[type] };

const RENDER: MiniatureRender = { blocks: RESOLVER, siteStyles: false };

function doc(id: string, text: string, type = "acme/text"): BlockDocument {
  return {
    formatVersion: 1,
    kind: "pattern",
    nodes: [{ id, type, version: 1, props: { text } }],
  } as BlockDocument;
}

const HEADER = doc("00000000-0000-4000-8000-0000000000a1", "Header");
const FOOTER = doc("00000000-0000-4000-8000-0000000000a2", "Footer");

/** An observer whose callback the test fires, recording what it watched. */
function stubObserver(): { show: () => void; watched: Element[] } {
  const callbacks: IntersectionObserverCallback[] = [];
  const watched: Element[] = [];
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(callback: IntersectionObserverCallback) {
        callbacks.push(callback);
      }
      observe(element: Element): void {
        watched.push(element);
      }
      disconnect(): void {}
    }
  );
  return {
    watched,
    show: () => {
      for (const callback of callbacks) {
        callback(
          [{ isIntersecting: true } as IntersectionObserverEntry],
          {} as IntersectionObserver
        );
      }
    },
  };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function texts(container: HTMLElement): string[] {
  return [...container.querySelectorAll('[data-testid="drawn"]')].map(
    element => element.textContent ?? ""
  );
}

describe("a picture of documents", () => {
  it("draws each document with the renderer, top to bottom, inert", () => {
    const { container } = render(
      <DocumentMiniature
        documents={[HEADER, FOOTER]}
        render={RENDER}
        session={createMiniatureSession()}
      />
    );
    expect(texts(container)).toEqual(["Header", "Footer"]);
    const surface = container.querySelector('[data-slot="picture-surface"]');
    expect(surface?.hasAttribute("inert")).toBe(true);
    // The whole picture is the row's, never read on its own.
    expect(
      container.querySelector(".nx-picture")?.getAttribute("aria-hidden")
    ).toBe("true");
  });

  it("draws nothing until its box is on screen", () => {
    const observer = stubObserver();
    const { container } = render(
      <DocumentMiniature
        documents={[HEADER]}
        render={RENDER}
        session={createMiniatureSession()}
      />
    );
    expect(texts(container)).toEqual([]);
    expect(observer.watched).toEqual([container.querySelector(".nx-picture")]);
    act(() => observer.show());
    expect(texts(container)).toEqual(["Header"]);
  });

  it("draws a document seen before in the session at once", () => {
    const session = createMiniatureSession();
    const first = stubObserver();
    const shown = render(
      <DocumentMiniature documents={[HEADER]} render={RENDER} session={session} />
    );
    act(() => first.show());
    shown.unmount();

    // Never shown this time: drawn from the session's memory alone.
    stubObserver();
    const { container } = render(
      <DocumentMiniature documents={[HEADER]} render={RENDER} session={session} />
    );
    expect(texts(container)).toEqual(["Header"]);
  });

  it("shows the empty-frame icon with nothing to draw", () => {
    const { container } = render(
      <DocumentMiniature
        documents={[]}
        render={RENDER}
        session={createMiniatureSession()}
      />
    );
    const picture = container.querySelector(".nx-picture");
    expect(picture?.getAttribute("data-state")).toBe("empty");
    expect(picture?.querySelector(".nx-picture__empty")).not.toBeNull();
    expect(picture?.querySelector('[data-slot="picture-surface"]')).toBeNull();
  });

  it("shows the type icon, and no page, when the host says it can't be drawn", () => {
    const { container } = render(
      <DocumentMiniature
        documents={[HEADER]}
        render={RENDER}
        icon="layout"
        failed
        session={createMiniatureSession()}
      />
    );
    const picture = container.querySelector(".nx-picture");
    expect(picture?.getAttribute("data-state")).toBe("failed");
    expect(picture?.querySelector(".nx-block-icon")).not.toBeNull();
    expect(texts(container)).toEqual([]);
  });

  it("shows the type icon, not a broken picture, when drawing throws", () => {
    // React reports the caught throw; the picture is what is under test.
    vi.spyOn(console, "error").mockImplementation(() => {});
    const broken = doc("00000000-0000-4000-8000-0000000000b1", "", "acme/broken");
    const { container } = render(
      <DocumentMiniature
        documents={[broken]}
        render={RENDER}
        session={createMiniatureSession()}
      />
    );
    const picture = container.querySelector(".nx-picture");
    expect(picture?.getAttribute("data-state")).toBe("failed");
    expect(picture?.querySelector(".nx-block-icon")).not.toBeNull();
    expect(picture?.querySelector('[data-slot="picture-surface"]')).toBeNull();
  });

  it("shows the type icon when a block in it can't be drawn", () => {
    // A type no block is registered for: what a deleted component or a
    // removed plugin leaves in a saved section.
    const unknown = doc("00000000-0000-4000-8000-0000000000c1", "", "acme/gone");
    const { container } = render(
      <DocumentMiniature
        documents={[HEADER, unknown]}
        render={RENDER}
        session={createMiniatureSession()}
      />
    );
    const picture = container.querySelector(".nx-picture");
    expect(picture?.getAttribute("data-state")).toBe("failed");
    expect(texts(container)).toEqual([]);
  });

  it.each(["light", "dark"] as const)(
    "draws the page in the %s preview when the canvas is previewed so",
    mode => {
      const { container } = render(
        <DocumentMiniature
          documents={[HEADER]}
          render={RENDER}
          mode={mode}
          session={createMiniatureSession()}
        />
      );
      const page = container.querySelector(".nx-picture__page");
      expect(page?.getAttribute(DARK_MODE_ATTRIBUTE)).toBe(mode);
      expect(
        container.querySelector<HTMLElement>(".nx-picture")?.style.colorScheme
      ).toBe(mode);
      expect(texts(container)).toEqual(["Header"]);
    }
  );

  it("states no mode when none is previewed, as the canvas draws the page's own", () => {
    const { container } = render(
      <DocumentMiniature
        documents={[HEADER]}
        render={RENDER}
        session={createMiniatureSession()}
      />
    );
    expect(
      container
        .querySelector(".nx-picture__page")
        ?.hasAttribute(DARK_MODE_ATTRIBUTE)
    ).toBe(false);
  });
});
