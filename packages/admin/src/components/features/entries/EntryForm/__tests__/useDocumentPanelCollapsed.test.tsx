/**
 * The document panel steps aside while history is open, and the author's own
 * choice comes back once it closes.
 */
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { useDocumentPanelCollapsed } from "../useDocumentPanelCollapsed";

const at = (address: string) => window.history.replaceState(null, "", address);

beforeEach(() => window.localStorage.clear());
afterEach(() => at("/"));

describe("useDocumentPanelCollapsed", () => {
  it("shows the panel while history is closed and the author has not collapsed it", () => {
    at("/admin/collections/posts/e1");
    const { result } = renderHook(() => useDocumentPanelCollapsed());
    expect(result.current.collapsed).toBe(false);
  });

  it("puts the panel out of the way while history is open", () => {
    at("/admin/collections/posts/e1?history=1");
    const { result } = renderHook(() => useDocumentPanelCollapsed());
    expect(result.current.collapsed).toBe(true);
  });

  it("keeps the author's choice to collapse it, history open or not", () => {
    at("/admin/collections/posts/e1");
    const { result } = renderHook(() => useDocumentPanelCollapsed());
    act(() => result.current.toggle());
    expect(result.current.collapsed).toBe(true);
  });
});
