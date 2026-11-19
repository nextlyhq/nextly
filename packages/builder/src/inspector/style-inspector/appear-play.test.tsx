// @vitest-environment jsdom

/**
 * Play, beside "Animation when it appears": a press plays the block's
 * animation on the canvas, and so does a change to it, once; nothing else
 * the panel shows plays it.
 *
 * The canvas side is `appear-replay.test.ts`'s; here it is watched, so each
 * case counts the plays the panel asked for.
 *
 * @module appear-play.test
 */
import type {
  BlockDocument,
  BlockNode,
  BreakpointId,
  StyleState,
} from "@nextlyhq/blocks-engine";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AppearPlay } from "./appear-play";
import type { EditorState } from "../../editor-state";
import { StyleTargetContext } from "./style-field-surroundings";
import type { StyleTarget } from "./style-target";

const { playAppear } = vi.hoisted(() => ({ playAppear: vi.fn(() => true) }));
vi.mock("../../canvas/appear-replay", () => ({ playAppear }));

afterEach(() => {
  cleanup();
  playAppear.mockClear();
});

/** An editor holding blocks `a` and `b`, `a` animated as given. */
function editorWith(appear: Record<string, unknown> | undefined): EditorState {
  const node = (id: string, styles?: unknown): BlockNode =>
    ({
      id,
      type: "acme/box",
      version: 1,
      props: {},
      ...(styles === undefined ? {} : { styles }),
    }) as BlockNode;
  return {
    document: {
      formatVersion: 1,
      kind: "page",
      nodes: [
        node(
          "a",
          appear === undefined ? undefined : { base: { base: { appear } } }
        ),
        node("b"),
      ],
    } as BlockDocument,
  } as unknown as EditorState;
}

interface Shown {
  nodeId?: string;
  state?: StyleState;
  breakpoint?: BreakpointId;
  target?: StyleTarget;
  appear?: Record<string, unknown>;
}

function drawn({
  nodeId = "a",
  state = "base",
  breakpoint = "base",
  target,
  appear,
}: Shown): React.JSX.Element {
  // Always under a provider, so a switch of target redraws the same button
  // rather than mounting a new one.
  return (
    <StyleTargetContext.Provider value={target ?? BLOCK}>
      <AppearPlay
        nodeId={nodeId}
        state={state}
        breakpoint={breakpoint}
        editor={editorWith(appear)}
      />
    </StyleTargetContext.Provider>
  );
}

/** The block itself as the target, wearing no shared style. */
const BLOCK: StyleTarget = { kind: "block", worn: [] };

describe("Play beside the animation", () => {
  it("plays the block's animation on the canvas when pressed", () => {
    render(drawn({ appear: { effect: "rise" } }));
    expect(playAppear).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Play" }));

    expect(playAppear).toHaveBeenCalledTimes(1);
    expect(playAppear).toHaveBeenCalledWith(document, "a");
  });

  it("plays once when the animation changes, and not again until it changes", () => {
    const { rerender } = render(drawn({ appear: { effect: "fade-in" } }));
    rerender(drawn({ appear: { effect: "fade-in", duration: 1500 } }));
    expect(playAppear).toHaveBeenCalledTimes(1);
    expect(playAppear).toHaveBeenLastCalledWith(document, "a");

    // A redraw with the same value plays nothing.
    rerender(drawn({ appear: { effect: "fade-in", duration: 1500 } }));
    expect(playAppear).toHaveBeenCalledTimes(1);

    // Cleared is a change too: the block then has nothing to play, which the
    // canvas answers.
    rerender(drawn({}));
    expect(playAppear).toHaveBeenCalledTimes(2);
  });

  it("plays nothing as it is first drawn", () => {
    render(drawn({ appear: { effect: "rise" } }));
    expect(playAppear).not.toHaveBeenCalled();
  });

  it("plays nothing when the panel only looks somewhere else", () => {
    const { rerender } = render(drawn({ appear: { effect: "rise" } }));
    // Another device, another state, another block, another target: each
    // shows a different value without anyone changing one.
    rerender(drawn({ breakpoint: "mobile", appear: { effect: "rise" } }));
    rerender(drawn({ breakpoint: "mobile", state: "hover" }));
    rerender(drawn({ nodeId: "b", state: "hover" }));
    rerender(
      drawn({
        nodeId: "b",
        state: "hover",
        target: {
          kind: "shared",
          style: {
            id: "card",
            styles: { hover: { base: { appear: { effect: "zoom-in" } } } },
          },
        } as unknown as StyleTarget,
      })
    );
    expect(playAppear).not.toHaveBeenCalled();
  });
});
