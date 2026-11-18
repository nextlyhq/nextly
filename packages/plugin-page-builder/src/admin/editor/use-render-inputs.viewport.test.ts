// @vitest-environment jsdom

/**
 * The canvas's viewport: the device being edited, the width the frame lays
 * the page out at, and which breakpoints the inspector reads as live there.
 *
 * A width previewed in place of the device's own changes the layout width
 * and the live breakpoints, and never the device an edit goes to. It is
 * session state: a device choice or a device change clears it.
 *
 * @module admin/editor/use-render-inputs.viewport.test
 */
import type { BreakpointSet } from "@nextlyhq/blocks-engine";
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { useCanvasViewport, type CanvasRender } from "./use-render-inputs";

const breakpoints: BreakpointSet = {
  viewport: [
    { id: "tablet", label: "Tablet", maxWidth: 1023 },
    { id: "mobile", label: "Mobile", maxWidth: 767 },
  ],
  container: [],
};

/** The render context the viewport reads its breakpoints from. */
const canvasRender = {
  styleContext: { breakpoints },
} as CanvasRender["canvasRender"];

function viewport() {
  return renderHook(() =>
    useCanvasViewport({ canvasRender, siteStyleCurrent: true })
  );
}

describe("a width previewed in place of the device's own", () => {
  it("lays the frame out at it, keeping the device being edited", () => {
    const { result } = viewport();
    expect(result.current.editedBreakpoint).toBe("base");
    expect(result.current.frameWidth).toBe(1280);
    act(() => result.current.setPreviewWidth(900));
    expect(result.current.previewWidth).toBe(900);
    expect(result.current.frameWidth).toBe(900);
    expect(result.current.deviceWidth).toBe(1280);
    // Every edit still goes to Desktop.
    expect(result.current.editedBreakpoint).toBe("base");
    expect(result.current.deviceRequest).toBeUndefined();
  });

  it("reads the live breakpoints at the width laid out", () => {
    const { result } = viewport();
    expect(result.current.liveBreakpoints).not.toContain("tablet");
    act(() => result.current.setPreviewWidth(900));
    expect(result.current.liveBreakpoints).toContain("tablet");
    expect(result.current.liveBreakpoints).not.toContain("mobile");
  });

  it("goes when a device is chosen, even the one being edited", () => {
    const { result } = viewport();
    act(() => result.current.setPreviewWidth(900));
    act(() => result.current.chooseDevice("base"));
    expect(result.current.previewWidth).toBeNull();
    expect(result.current.frameWidth).toBe(1280);
  });

  it("goes when the shell reports another device", () => {
    const { result } = viewport();
    act(() => result.current.setPreviewWidth(900));
    act(() => result.current.setChosenDevice("tablet"));
    expect(result.current.previewWidth).toBeNull();
    expect(result.current.frameWidth).toBe(1023);
  });

  it("stays gone when the shell reports the first device back", () => {
    const { result } = viewport();
    act(() => result.current.setPreviewWidth(900));
    act(() => result.current.setChosenDevice("tablet"));
    act(() => result.current.setChosenDevice(null));
    expect(result.current.editedBreakpoint).toBe("base");
    expect(result.current.previewWidth).toBeNull();
    expect(result.current.frameWidth).toBe(1280);
  });

  it("goes on Reset", () => {
    const { result } = viewport();
    act(() => result.current.setPreviewWidth(900));
    act(() => result.current.setPreviewWidth(null));
    expect(result.current.previewWidth).toBeNull();
    expect(result.current.frameWidth).toBe(1280);
  });

  it("starts at the device's own width, with nothing kept from before", () => {
    const first = viewport();
    act(() => first.result.current.setPreviewWidth(900));
    first.unmount();
    // A page switch or a reload mounts the editor afresh.
    const { result } = viewport();
    expect(result.current.previewWidth).toBeNull();
    expect(result.current.frameWidth).toBe(1280);
  });
});
