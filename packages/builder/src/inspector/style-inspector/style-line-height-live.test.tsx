// @vitest-environment jsdom

/**
 * A line height typed live writes as it is typed, but a variable's name is
 * matched only when the field is left: a name that is a whole variable on the
 * way to a longer one ("line-height.body" before "line-height.body-large") must not turn the
 * field into a variable mid-word.
 *
 * @module style-line-height-live.test
 */
import {
  BASE_BREAKPOINT,
  clearBlocks,
  registerBlocks,
  type BlockDocument,
  type SiteTokenSet,
} from "@nextlyhq/blocks-engine";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import * as React from "react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { useEditorState, type EditorState } from "../../editor-state";
import { StyleInspectorPanel } from "./style-inspector-panel";

beforeAll(() => {
  Element.prototype.scrollIntoView ??= () => {};
  (window as unknown as Record<string, unknown>).ResizeObserver ??=
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

const TOKENS: SiteTokenSet = {
  tokens: [
    { name: "line-height.body", kind: "number", values: { light: "1.2" } },
    {
      name: "line-height.body-large",
      kind: "number",
      values: { light: "1.6" },
    },
  ],
};

function mountLive(): { editor?: EditorState } {
  registerBlocks(
    [
      {
        name: "acme/box",
        version: 1,
        description: "A box.",
        example: { props: {} },
        editor: { label: "Box" },
        props: { text: { type: "text" } },
        supports: { typography: true },
        render: () => null,
      },
    ] as never,
    { source: "style-line-height-live-test" }
  );
  const live: { editor?: EditorState } = {};
  function Live(): React.JSX.Element {
    const editor = useEditorState({
      initialDocument: {
        formatVersion: 1,
        kind: "page",
        nodes: [
          {
            id: "a",
            type: "acme/box",
            version: 1,
            props: {},
            styles: { base: { [BASE_BREAKPOINT]: { lineHeight: 1.4 } } },
          },
        ],
      } as unknown as BlockDocument,
    });
    live.editor = editor;
    React.useEffect(() => editor.select("a"), []);
    return <StyleInspectorPanel editor={editor} tokens={TOKENS} />;
  }
  render(<Live />);
  return live;
}

/** The field, opening its section first where it is closed. */
function lineHeightField(): HTMLInputElement {
  const find = () =>
    document.querySelector<HTMLInputElement>(
      '[data-property="lineHeight"] input'
    );
  for (const header of document.querySelectorAll<HTMLElement>(
    '[data-section] [data-slot="accordion-trigger"][aria-expanded="false"]'
  )) {
    if (find() !== null) break;
    fireEvent.click(header);
  }
  const found = find();
  if (found === null) throw new Error("no line height field");
  return found;
}

describe("a line height typed live", () => {
  it("keeps the field while a variable's name is typed, and picks it when the field is left", () => {
    const live = mountLive();
    let typed = "";
    for (const character of "line-height.body-large") {
      typed += character;
      const field = lineHeightField();
      field.focus();
      fireEvent.change(field, { target: { value: typed } });
    }
    const field = lineHeightField();
    expect(field.value).toBe("line-height.body-large");
    expect(document.activeElement).toBe(field);
    fireEvent.blur(field);
    const lineHeight = (
      live.editor?.document.nodes[0]?.styles?.base?.[BASE_BREAKPOINT] as
        | { lineHeight?: unknown }
        | undefined
    )?.lineHeight;
    expect(lineHeight).toEqual({ $token: "line-height.body-large" });
  });
});
