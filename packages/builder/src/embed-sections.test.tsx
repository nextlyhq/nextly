// @vitest-environment jsdom

/**
 * The Embed's Content section in the inspector: the Link that writes the
 * provider's shape with the link, what it says was found, and the settings
 * shown only where they apply.
 */
import {
  clearBlocks,
  hasBlock,
  registerBlocks,
  type BlockDocument,
  type BlockNode,
} from "@nextlyhq/blocks-engine";
import { embed } from "@nextlyhq/blocks-react/blocks";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import * as React from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import type { ContentServices } from "./content-controls";
import type { EditorState } from "./editor-state";
import { InspectorPanel } from "./inspector-panel";

beforeAll(() => {
  const element = window.Element.prototype as unknown as Record<
    string,
    unknown
  >;
  element.scrollIntoView = function scrollIntoView(): void {};
  element.hasPointerCapture = () => false;
  element.releasePointerCapture = () => {};
  (window as unknown as Record<string, unknown>).ResizeObserver =
    class ResizeObserver {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    };
});

afterEach(() => {
  cleanup();
  clearBlocks();
});

const NEW_EMBED = { title: "", allowFullscreen: true, load: "click", privacy: true };
const WATCH = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";

/** A page holding one Embed with `props`, and an editor recording its writes. */
function mount(props: Record<string, unknown>, services?: ContentServices) {
  return mountWith(props, services).editor;
}

function mountWith(
  props: Record<string, unknown>,
  services?: ContentServices,
  bindings?: BlockNode["bindings"]
) {
  if (!hasBlock(embed.name)) {
    registerBlocks([embed] as never, { source: "embed-sections-test" });
  }
  const document = {
    formatVersion: 1,
    kind: "page",
    nodes: [
      {
        id: "e",
        type: "core/embed",
        version: 1,
        props,
        ...(bindings === undefined ? {} : { bindings }),
      } as BlockNode,
    ],
  } as BlockDocument;
  const editor = {
    document,
    selectedId: "e",
    selection: { ids: ["e"], primary: "e" },
    applyAll: vi.fn(() => document),
    select: vi.fn(),
    apply: vi.fn(() => document),
    undo: vi.fn(),
    redo: vi.fn(),
    canUndo: false,
    canRedo: false,
    undoDepth: 0,
    lockRefusalFor: () => undefined,
    composed: () => undefined,
  } as unknown as EditorState & { apply: ReturnType<typeof vi.fn> };
  const view = render(
    <InspectorPanel
      editor={editor}
      {...(services === undefined ? {} : { contentServices: services })}
    />
  );
  return { editor, view };
}

/** The labels of the settings the section draws, in order. */
function shownLabels(): string[] {
  return ["Link", "Screen reader label", "Load", "Privacy mode", "Poster"].filter(
    label => screen.queryAllByText(label, { selector: "label, legend, span, p" }).length > 0
  );
}

describe("the Embed's Link", () => {
  it("says what a provider's link is, and that the block was sized for it", () => {
    mount({ ...NEW_EMBED, src: WATCH });
    expect(screen.getByRole("status").textContent).toBe(
      "YouTube detected. Size set from the video."
    );
  });

  it("says a link nobody owns is shown as a plain frame", () => {
    mount({ ...NEW_EMBED, src: "https://example.com/page" });
    expect(screen.getByText("Shown as a plain frame")).toBeTruthy();
  });

  it("writes a typed link with the provider's proportion, as one step", () => {
    const editor = mount({ ...NEW_EMBED });
    const field = screen.getByLabelText("Link");
    fireEvent.change(field, { target: { value: "https://vimeo.com/76979871" } });
    fireEvent.keyDown(field, { key: "Enter" });
    expect(editor.apply).toHaveBeenCalledTimes(1);
    expect(editor.apply.mock.calls[0]?.[0]).toEqual({
      kind: "update",
      id: "e",
      patch: {
        props: { ...NEW_EMBED, src: "https://vimeo.com/76979871" },
        styles: { base: { base: { aspectRatio: "16 / 9" } } },
      },
    });
  });
});

describe("the settings shown", () => {
  it("offers Load, Privacy mode and Poster for a YouTube link played on press", () => {
    mount({ ...NEW_EMBED, src: WATCH });
    expect(shownLabels()).toEqual([
      "Link",
      "Screen reader label",
      "Load",
      "Privacy mode",
      "Poster",
    ]);
  });

  it("hides Privacy mode for a provider without one", () => {
    mount({ ...NEW_EMBED, src: "https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC" });
    expect(shownLabels()).toEqual(["Link", "Screen reader label", "Load", "Poster"]);
  });

  it("hides the Poster while the player loads with the page", () => {
    mount({ ...NEW_EMBED, src: WATCH, load: "page" });
    expect(shownLabels()).toEqual([
      "Link",
      "Screen reader label",
      "Load",
      "Privacy mode",
    ]);
  });

  it("offers only the link and label for a link nobody owns", () => {
    mount({ ...NEW_EMBED, src: "https://example.com/page" });
    expect(shownLabels()).toEqual(["Link", "Screen reader label"]);
  });
});

describe("Use the video's thumbnail", () => {
  it("copies the picture through the host and makes it the poster", async () => {
    const copyEmbedThumbnail = vi.fn(() =>
      Promise.resolve({ id: "m9", url: "/media/m9", filename: "youtube-x-thumbnail.jpg" })
    );
    const editor = mount({ ...NEW_EMBED, src: WATCH }, { copyEmbedThumbnail });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Use the video's thumbnail" }));
      await Promise.resolve();
    });
    expect(copyEmbedThumbnail).toHaveBeenCalledWith(WATCH);
    const op = editor.apply.mock.calls.at(-1)?.[0] as {
      patch: { props: Record<string, unknown> };
    };
    expect(op.patch.props.poster).toBe("m9");
  });

  it("is not offered for a provider with no picture, or without the host's copy", () => {
    mount(
      { ...NEW_EMBED, src: "https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC" },
      { copyEmbedThumbnail: vi.fn() }
    );
    expect(screen.queryByRole("button", { name: "Use the video's thumbnail" })).toBeNull();
    cleanup();
    mount({ ...NEW_EMBED, src: WATCH });
    expect(screen.queryByRole("button", { name: "Use the video's thumbnail" })).toBeNull();
  });
});

describe("an Embed stored before Load existed", () => {
  it("reads as Right away, as the page draws it, with no Poster", () => {
    mount({ title: "", allowFullscreen: true, src: WATCH });
    expect(screen.getByText("Right away")).toBeTruthy();
    expect(screen.queryByText("When played")).toBeNull();
    expect(shownLabels()).not.toContain("Poster");
  });
});

describe("a thumbnail copy pending when the link changes", () => {
  it("leaves the new link's button ready, and stores nothing for the old one", async () => {
    let finish: ((media: { id: string }) => void) | undefined;
    const copyEmbedThumbnail = vi.fn(
      () =>
        new Promise<{ id: string }>(resolve => {
          finish = resolve;
        })
    );
    const services = { copyEmbedThumbnail } as unknown as ContentServices;
    const { editor, view } = mountWith({ ...NEW_EMBED, src: WATCH }, services);
    fireEvent.click(screen.getByRole("button", { name: "Use the video's thumbnail" }));
    expect(screen.getByRole("button", { name: "Copying the thumbnail…" })).toBeTruthy();

    // The author pastes another video while the copy is pending.
    const other = { ...editor, document: {
      ...editor.document,
      nodes: [{ id: "e", type: "core/embed", version: 1, props: { ...NEW_EMBED, src: "https://youtu.be/aqz-KE-bpKQ" } }],
    } } as unknown as EditorState;
    view.rerender(<InspectorPanel editor={other} contentServices={services} />);
    const ready = screen.getByRole("button", { name: "Use the video's thumbnail" });
    expect((ready as HTMLButtonElement).disabled).toBe(false);

    await act(async () => {
      finish?.({ id: "old" });
      await Promise.resolve();
    });
    const posters = editor.apply.mock.calls.filter(call =>
      JSON.stringify(call[0]).includes("\"poster\":\"old\"")
    );
    expect(posters).toEqual([]);
  });
});

describe("a thumbnail copy under Strict Mode", () => {
  it("still stores the poster when React mounts the copy twice", async () => {
    if (!hasBlock(embed.name)) {
      registerBlocks([embed] as never, { source: "embed-sections-test" });
    }
    const document = {
      formatVersion: 1,
      kind: "page",
      nodes: [{ id: "e", type: "core/embed", version: 1, props: { ...NEW_EMBED, src: WATCH } } as BlockNode],
    } as BlockDocument;
    const editor = {
      document,
      selectedId: "e",
      selection: { ids: ["e"], primary: "e" },
      applyAll: vi.fn(() => document),
      select: vi.fn(),
      apply: vi.fn(() => document),
      undo: vi.fn(),
      redo: vi.fn(),
      canUndo: false,
      canRedo: false,
      undoDepth: 0,
      lockRefusalFor: () => undefined,
      composed: () => undefined,
    } as unknown as EditorState & { apply: ReturnType<typeof vi.fn> };
    const copyEmbedThumbnail = vi.fn(() => Promise.resolve({ id: "m9" }));
    render(
      <React.StrictMode>
        <InspectorPanel
          editor={editor}
          contentServices={{ copyEmbedThumbnail } as unknown as ContentServices}
        />
      </React.StrictMode>
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Use the video's thumbnail" }));
      await Promise.resolve();
    });
    const op = editor.apply.mock.calls.at(-1)?.[0] as { patch: { props: Record<string, unknown> } };
    expect(op.patch.props.poster).toBe("m9");
  });
});

describe("an Embed whose link is bound to a field", () => {
  it("offers every setting a provider's link takes, and no thumbnail copy", () => {
    mountWith(
      { ...NEW_EMBED, src: "https://example.com/stale" },
      { copyEmbedThumbnail: vi.fn() } as unknown as ContentServices,
      { src: { $bind: "video", source: "entry" } }
    );
    expect(shownLabels()).toEqual([
      "Link",
      "Screen reader label",
      "Load",
      "Privacy mode",
      "Poster",
    ]);
    // The stored literal is not the link the page draws, so no word about it
    // and no copy of its picture.
    expect(screen.queryByText("Shown as a plain frame")).toBeNull();
    expect(screen.queryByRole("button", { name: "Use the video's thumbnail" })).toBeNull();
  });
});
