// @vitest-environment jsdom

/**
 * "Hide on": each device's state as a visitor gets it, a press that changes
 * that device alone, and the line saying where a block is hidden.
 *
 * The case that separates it from a control reading the stored values: a
 * block hidden from Desktop down stores nothing for Tablet, and must still
 * show Tablet as hidden.
 *
 * @module hide-on.test
 */
import {
  deviceVisibility,
  findNode,
  type BlockDocument,
  type BreakpointSet,
} from "@nextlyhq/blocks-engine";
import { act, cleanup, render, screen } from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useEditorState, type EditorState } from "./editor-state";
import { HiddenStatus, HideOn } from "./hide-on";

afterEach(cleanup);

const SITE: BreakpointSet = {
  viewport: [
    { id: "tablet", label: "Tablet", maxWidth: 1024 },
    { id: "mobile", label: "Mobile", maxWidth: 640 },
  ],
  container: [],
};

let editorRef: EditorState | null = null;

function Host({
  document,
  status = "ready",
  heldBy,
}: {
  document: BlockDocument;
  status?: "loading" | "unavailable" | "ready";
  heldBy?: string;
}): React.JSX.Element {
  const editor = useEditorState({ initialDocument: document });
  editorRef = editor;
  return (
    <HideOn
      editor={editor}
      nodeId="a"
      breakpoints={SITE}
      editing="tablet"
      status={status}
      heldBy={heldBy}
    />
  );
}

function withDevices(
  devices: Record<string, boolean> | undefined,
  locked = false
): BlockDocument {
  return {
    formatVersion: 1,
    kind: "page",
    nodes: [
      {
        id: "a",
        type: "core/heading",
        version: 1,
        props: {},
        ...(devices === undefined ? {} : { visibility: { devices } }),
        ...(locked ? { locked: true } : {}),
      },
    ],
  } as BlockDocument;
}

function toggle(device: string): HTMLElement {
  return screen.getByRole("button", { name: `Hide on ${device}` });
}

function pressed(): Record<string, string | null> {
  return Object.fromEntries(
    ["Desktop", "Tablet", "Mobile"].map(name => [
      name,
      toggle(name).getAttribute("aria-pressed"),
    ])
  );
}

describe("HideOn", () => {
  it('is "Hide on", one toggle per device, each named and showing its name', () => {
    render(<Host document={withDevices(undefined)} />);
    expect(screen.getByRole("group", { name: "Hide on" })).toBeTruthy();
    const names = screen
      .getAllByRole("button")
      .map(button => button.getAttribute("aria-label"));
    expect(names).toEqual([
      "Hide on Desktop",
      "Hide on Tablet",
      "Hide on Mobile",
    ]);
    // Each toggle carries its device's name in words beside its icon.
    expect(toggle("Desktop").textContent).toBe("Desktop");
    expect(toggle("Tablet").textContent).toBe("Tablet");
    expect(toggle("Mobile").textContent).toBe("Mobile");
    expect(toggle("Desktop").querySelector("svg")).not.toBeNull();
    expect(
      screen.getByText("Hides only on the devices you pick, not smaller ones.")
    ).toBeTruthy();
    // Nothing hidden: nothing pressed.
    expect(pressed()).toEqual({
      Desktop: "false",
      Tablet: "false",
      Mobile: "false",
    });
  });

  it("presses each device the block is hidden on, as a visitor gets it", () => {
    render(<Host document={withDevices({ base: false, mobile: true })} />);
    // Hidden from Desktop down, shown again on Mobile: Tablet stores nothing
    // and is hidden all the same.
    expect(pressed()).toEqual({
      Desktop: "true",
      Tablet: "true",
      Mobile: "false",
    });
  });

  it("hides the pressed device alone: Desktop hidden, Tablet and Mobile still showing", () => {
    render(<Host document={withDevices(undefined)} />);
    act(() => toggle("Desktop").click());
    const node = findNode(editorRef?.document.nodes ?? [], "a");
    expect(
      Object.fromEntries(
        deviceVisibility(node?.visibility, SITE).map(d => [d.id, d.visible])
      )
    ).toEqual({ base: false, tablet: true, mobile: true });
    expect(pressed()).toEqual({
      Desktop: "true",
      Tablet: "false",
      Mobile: "false",
    });
    // Pressed again, it shows on Desktop again and stores nothing.
    act(() => toggle("Desktop").click());
    expect(
      findNode(editorRef?.document.nodes ?? [], "a")?.visibility
    ).toBeUndefined();
  });

  it("marks the device being edited", () => {
    render(<Host document={withDevices(undefined)} />);
    expect(toggle("Tablet").hasAttribute("data-editing")).toBe(true);
    expect(toggle("Mobile").hasAttribute("data-editing")).toBe(false);
  });

  it("is held until the site's breakpoints are read", () => {
    render(<Host document={withDevices(undefined)} status="loading" />);
    expect(toggle("Desktop").hasAttribute("disabled")).toBe(true);
    expect(screen.getByText("Reading the site's breakpoints…")).toBeTruthy();
  });

  it("says so when the site's breakpoints could not be read, rather than that they are loading", () => {
    render(<Host document={withDevices(undefined)} status="unavailable" />);
    expect(toggle("Desktop").hasAttribute("disabled")).toBe(true);
    expect(screen.getByText(/could not be read/)).toBeTruthy();
    expect(screen.queryByText("Reading the site's breakpoints…")).toBeNull();
  });

  it("is held on a locked block", () => {
    render(<Host document={withDevices(undefined, true)} heldBy="Locked." />);
    expect(toggle("Desktop").hasAttribute("disabled")).toBe(true);
  });
});

function StatusHost({
  document,
  onChoose,
}: {
  document: BlockDocument;
  onChoose?: (tab: "advanced") => void;
}): React.JSX.Element {
  const editor = useEditorState({ initialDocument: document });
  return (
    <HiddenStatus
      editor={editor}
      nodeId="a"
      breakpoints={SITE}
      onChoose={onChoose}
    />
  );
}

describe("HiddenStatus", () => {
  it("says nothing while the block shows on every device", () => {
    const { container } = render(
      <StatusHost document={withDevices(undefined)} />
    );
    expect(container.textContent).toBe("");
  });

  it("names the one device, and that its visitors won't see it", () => {
    render(<StatusHost document={withDevices({ mobile: false })} />);
    expect(
      screen.getByText(
        "Hidden on Mobile. Visitors on that device won't see it."
      )
    ).toBeTruthy();
  });

  it("names every device, as a visitor gets it, and speaks of those devices", () => {
    render(
      <StatusHost
        document={withDevices({ tablet: false })}
        onChoose={vi.fn()}
      />
    );
    expect(
      screen.getByText(
        "Hidden on Tablet and Mobile. Visitors on those devices won't see it.",
        { exact: false }
      )
    ).toBeTruthy();
  });

  it('offers "Change" only where it is given another tab to go to', () => {
    const onChoose = vi.fn();
    const { rerender } = render(
      <StatusHost document={withDevices({ mobile: false })} />
    );
    expect(screen.queryByRole("button", { name: "Change" })).toBeNull();
    rerender(
      <StatusHost
        document={withDevices({ mobile: false })}
        onChoose={onChoose}
      />
    );
    act(() => screen.getByRole("button", { name: "Change" }).click());
    expect(onChoose).toHaveBeenCalledWith("advanced");
  });
});
