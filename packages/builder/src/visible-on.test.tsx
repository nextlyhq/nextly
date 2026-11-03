// @vitest-environment jsdom

/**
 * "Visible on": each device's state as a visitor gets it, and a press that
 * changes that device alone.
 *
 * The case that separates it from a control reading the stored values: a
 * block hidden from Desktop down stores nothing for Tablet, and must still
 * show Tablet as hidden.
 *
 * @module visible-on.test
 */
import {
  deviceVisibility,
  findNode,
  type BlockDocument,
  type BreakpointSet,
} from "@nextlyhq/blocks-engine";
import { act, cleanup, render, screen } from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, it } from "vitest";

import { useEditorState, type EditorState } from "./editor-state";
import { VisibleOn } from "./visible-on";

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
    <VisibleOn
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

function pressed(): Record<string, string | null> {
  return Object.fromEntries(
    ["Desktop", "Tablet", "Mobile"].map(name => [
      name,
      screen.getByRole("button", { name }).getAttribute("aria-pressed"),
    ])
  );
}

describe("VisibleOn", () => {
  it("shows each device's resolved state, and says it in words", () => {
    render(<Host document={withDevices({ base: false, mobile: true })} />);
    expect(pressed()).toEqual({
      Desktop: "false",
      Tablet: "false",
      Mobile: "true",
    });
    expect(screen.getByText("Hidden on Desktop and Tablet.")).toBeTruthy();
  });

  it("changes the pressed device alone", () => {
    render(<Host document={withDevices(undefined)} />);
    expect(screen.getByText("Shown on every device.")).toBeTruthy();
    act(() => screen.getByRole("button", { name: "Desktop" }).click());
    const node = findNode(editorRef?.document.nodes ?? [], "a");
    expect(
      Object.fromEntries(
        deviceVisibility(node?.visibility, SITE).map(d => [d.id, d.visible])
      )
    ).toEqual({ base: false, tablet: true, mobile: true });
    expect(pressed()).toEqual({
      Desktop: "false",
      Tablet: "true",
      Mobile: "true",
    });
  });

  it("marks the device being edited", () => {
    render(<Host document={withDevices(undefined)} />);
    expect(
      screen
        .getByRole("button", { name: "Tablet" })
        .hasAttribute("data-editing")
    ).toBe(true);
  });

  it("is held until the site's breakpoints are read", () => {
    render(<Host document={withDevices(undefined)} status="loading" />);
    expect(
      screen.getByRole("button", { name: "Desktop" }).hasAttribute("disabled")
    ).toBe(true);
    expect(screen.getByText("Reading the site's breakpoints…")).toBeTruthy();
  });

  it("says so when the site's breakpoints could not be read, rather than that they are loading", () => {
    render(<Host document={withDevices(undefined)} status="unavailable" />);
    expect(
      screen.getByRole("button", { name: "Desktop" }).hasAttribute("disabled")
    ).toBe(true);
    expect(screen.getByText(/could not be read/)).toBeTruthy();
    expect(screen.queryByText("Reading the site's breakpoints…")).toBeNull();
  });

  it("is held on a locked block", () => {
    render(<Host document={withDevices(undefined, true)} heldBy="Locked." />);
    expect(
      screen.getByRole("button", { name: "Desktop" }).hasAttribute("disabled")
    ).toBe(true);
  });
});
