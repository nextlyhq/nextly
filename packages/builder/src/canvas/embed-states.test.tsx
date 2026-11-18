// @vitest-environment jsdom
/**
 * An Embed's empty state on the canvas: the field over the box an Embed with
 * no link draws, and what pasting or typing a link there stores.
 */
import {
  DOCUMENT_FORMAT_VERSION,
  type BlockDocument,
  type BlockNode,
} from "@nextlyhq/blocks-engine";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { EditorState } from "../editor-state";
import { CANVAS_ROOT_CLASS } from "../shell-state";

import { EmbedStates } from "./embed-states";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

beforeEach(() => {
  // jsdom lays nothing out: every element is drawn at a 640 by 360 box.
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
    () => new DOMRect(0, 0, 640, 360)
  );
  vi.spyOn(Element.prototype, "getClientRects").mockImplementation(() => {
    const boxes = [new DOMRect(0, 0, 640, 360)];
    return Object.assign(boxes, {
      item: (i: number) => boxes[i] ?? null,
    }) as unknown as DOMRectList;
  });
});

function page(...nodes: BlockNode[]): BlockDocument {
  return { formatVersion: DOCUMENT_FORMAT_VERSION, kind: "page", nodes };
}

const EMBED: BlockNode = {
  id: "e1",
  type: "core/embed",
  version: 1,
  props: { title: "", load: "click", privacy: true },
};

const EMPTY_BOX = '<div data-nx-node="e1" data-nx-embed-empty=""></div>';

function mount(document: BlockDocument) {
  const apply = vi.fn<EditorState["apply"]>(() => document);
  const select = vi.fn<EditorState["select"]>();
  const editor = {
    document,
    selectedId: null,
    selection: { ids: [], primary: null },
    select,
    apply,
    composed: () => undefined,
  } as unknown as EditorState;
  render(
    <div className={CANVAS_ROOT_CLASS}>
      <div dangerouslySetInnerHTML={{ __html: EMPTY_BOX }} />
      <EmbedStates editor={editor} />
    </div>
  );
  return { apply, select };
}

/** A paste of `text` into `field`, as a browser hands one over. */
function paste(field: HTMLElement, text: string): void {
  fireEvent.paste(field, {
    clipboardData: { getData: (type: string) => (type === "text/plain" ? text : "") },
  });
}

describe("an Embed with no link", () => {
  it("asks for a link in a labelled field, with Embed", () => {
    mount(page(EMBED));
    const field = screen.getByLabelText("Paste a YouTube, Vimeo or other link");
    expect(field.tagName).toBe("INPUT");
    expect(screen.getByRole("button", { name: "Embed" })).toBeTruthy();
  });

  it("stores a pasted link at once, sized from its provider, in one step", () => {
    const { apply, select } = mount(page(EMBED));
    paste(
      screen.getByLabelText("Paste a YouTube, Vimeo or other link"),
      "https://www.youtube.com/shorts/aqz-KE-bpKQ"
    );
    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply.mock.calls[0]?.[0]).toEqual({
      kind: "update",
      id: "e1",
      patch: {
        props: { ...EMBED.props, src: "https://www.youtube.com/shorts/aqz-KE-bpKQ" },
        styles: { base: { base: { aspectRatio: "9 / 16" } } },
      },
    });
    expect(select).toHaveBeenCalledWith("e1");
  });

  it("stores a typed link on Embed", () => {
    const { apply } = mount(page(EMBED));
    const field = screen.getByLabelText("Paste a YouTube, Vimeo or other link");
    fireEvent.change(field, { target: { value: "https://example.com/page" } });
    expect(apply).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Embed" }));
    expect(apply).toHaveBeenCalledTimes(1);
    const op = apply.mock.calls[0]?.[0] as { patch: { props: unknown; styles?: unknown } };
    expect(op.patch.props).toEqual({ ...EMBED.props, src: "https://example.com/page" });
    expect(op.patch.styles).toBeUndefined();
  });

  it("leaves text that is not one link to the field", () => {
    const { apply } = mount(page(EMBED));
    paste(
      screen.getByLabelText("Paste a YouTube, Vimeo or other link"),
      "two words"
    );
    expect(apply).not.toHaveBeenCalled();
  });
});
