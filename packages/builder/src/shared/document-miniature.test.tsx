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
 *   both ways; with no mode none is stated, and the ground takes the device's
 *   scheme, as the canvas's does, rather than the admin's.
 * - A host handing the same documents in a new list (every panel re-render)
 *   does not draw them again: a picture that did would rerun the renderer for
 *   every tile on each keystroke in the panel's search.
 * - A picture that could not be drawn is drawn once what it lacked arrives (a
 *   component's definition read after the panel opened).
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
      <DocumentMiniature
        documents={[HEADER]}
        render={RENDER}
        session={session}
      />
    );
    act(() => first.show());
    shown.unmount();

    // Never shown this time: drawn from the session's memory alone.
    stubObserver();
    const { container } = render(
      <DocumentMiniature
        documents={[HEADER]}
        render={RENDER}
        session={session}
      />
    );
    expect(texts(container)).toEqual(["Header"]);
  });

  it("scales a document seen before to its box, drawn in the same render as the box", () => {
    // The box is 128px wide: a tenth of the 1280px the document is laid out at.
    const width = vi
      .spyOn(HTMLElement.prototype, "clientWidth", "get")
      .mockImplementation(function (this: HTMLElement) {
        return this.classList.contains("nx-picture") ? 128 : 0;
      });
    const session = createMiniatureSession();
    session.seen.add(HEADER);
    const { container } = render(
      <DocumentMiniature
        documents={[HEADER]}
        render={RENDER}
        session={session}
      />
    );
    const scaled = container.querySelector<HTMLElement>(
      '[data-slot="picture-scaled"]'
    );
    expect(scaled?.style.transform).toBe("scale(0.1)");
    width.mockRestore();
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
    const broken = doc(
      "00000000-0000-4000-8000-0000000000b1",
      "",
      "acme/broken"
    );
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
    const unknown = doc(
      "00000000-0000-4000-8000-0000000000c1",
      "",
      "acme/gone"
    );
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

  it("shows the type icon when a block gives up after the drawing, with no size change", async () => {
    const { container } = render(
      <DocumentMiniature
        documents={[HEADER]}
        render={RENDER}
        session={createMiniatureSession()}
      />
    );
    const picture = container.querySelector(".nx-picture");
    expect(picture?.getAttribute("data-state")).toBe("drawn");
    // What an async block that rejects leaves in place of its fallback: a
    // hidden placeholder, which need not change the drawing's size.
    await act(async () => {
      const placeholder = document.createElement("span");
      placeholder.setAttribute("data-nx-block-placeholder", "");
      placeholder.hidden = true;
      container.querySelector(".nx-picture__page")?.append(placeholder);
      // The observer of the drawing's content answers as a microtask.
      await Promise.resolve();
    });
    expect(picture?.getAttribute("data-state")).toBe("failed");
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

  it("takes the device's scheme for its ground when none is previewed", () => {
    vi.stubGlobal(
      "matchMedia",
      (query: string) =>
        ({
          matches: query === "(prefers-color-scheme: dark)",
          addEventListener: () => {},
          removeEventListener: () => {},
        }) as unknown as MediaQueryList
    );
    const { container } = render(
      <DocumentMiniature
        documents={[HEADER]}
        render={RENDER}
        session={createMiniatureSession()}
      />
    );
    expect(
      container.querySelector<HTMLElement>(".nx-picture")?.style.colorScheme
    ).toBe("dark");
    // The scheme only: the page still draws in its own mode.
    expect(
      container
        .querySelector(".nx-picture__page")
        ?.hasAttribute(DARK_MODE_ATTRIBUTE)
    ).toBe(false);
  });

  it("does not draw the same documents again when handed them in a new list", () => {
    let draws = 0;
    const counting: MiniatureRender = {
      blocks: {
        get: type =>
          type === "acme/text"
            ? ({
                ...BLOCKS["acme/text"],
                render: ({ props }: { props: { text?: string } }) => {
                  draws += 1;
                  return createElement(
                    "p",
                    { "data-testid": "drawn" },
                    props.text ?? ""
                  );
                },
              } as never)
            : undefined,
      },
      siteStyles: false,
    };
    const session = createMiniatureSession();
    const { rerender } = render(
      <DocumentMiniature
        documents={[HEADER]}
        render={counting}
        session={session}
      />
    );
    const before = draws;
    expect(before).toBeGreaterThan(0);
    rerender(
      <DocumentMiniature
        documents={[HEADER]}
        render={counting}
        session={session}
      />
    );
    expect(draws).toBe(before);
  });

  it("draws a picture that could not be drawn once what it lacked arrives", () => {
    const lacking: MiniatureRender = {
      blocks: { get: () => undefined },
      siteStyles: false,
    };
    const session = createMiniatureSession();
    const { container, rerender } = render(
      <DocumentMiniature
        documents={[HEADER]}
        render={lacking}
        session={session}
      />
    );
    expect(
      container.querySelector(".nx-picture")?.getAttribute("data-state")
    ).toBe("failed");
    rerender(
      <DocumentMiniature
        documents={[HEADER]}
        render={RENDER}
        session={session}
      />
    );
    expect(
      container.querySelector(".nx-picture")?.getAttribute("data-state")
    ).toBe("drawn");
    expect(texts(container)).toEqual(["Header"]);
  });
});
