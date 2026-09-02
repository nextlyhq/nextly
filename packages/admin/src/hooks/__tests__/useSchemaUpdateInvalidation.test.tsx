/**
 * The listener that re-reads the workspace declarations when the schema
 * changes outside this tab.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import {
  SCHEMA_UPDATED_EVENT,
  useSchemaUpdateInvalidation,
} from "../useSchemaUpdateInvalidation";

function mounted() {
  const client = new QueryClient();
  const spy = vi.spyOn(client, "invalidateQueries").mockResolvedValue();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const view = renderHook(() => useSchemaUpdateInvalidation(), { wrapper });
  const keys = () =>
    spy.mock.calls.map(call => (call[0] as { queryKey: unknown[] }).queryKey);
  return { view, keys };
}

describe("useSchemaUpdateInvalidation", () => {
  it("re-reads admin-meta, which carries the widget declarations", () => {
    // 🔴 The workspace payload is cached for five minutes while the layout
    // endpoint answers fresh, so a collection created a moment ago is offered
    // in the picker under its raw id — and adding it saves a placement the grid
    // skips for want of a declaration to draw.
    const { keys } = mounted();

    window.dispatchEvent(new Event(SCHEMA_UPDATED_EVENT));

    expect(keys()).toEqual([["admin-meta"]]);
  });

  it("does nothing until the event actually fires", () => {
    // The control. Without it the assertion above is satisfied by a hook that
    // invalidates on mount and never listens for anything.
    const { keys } = mounted();
    expect(keys()).toEqual([]);
  });

  it("stops listening when it unmounts", () => {
    // A listener that outlives its provider invalidates into a detached cache
    // on every later schema change.
    const { view, keys } = mounted();
    view.unmount();

    window.dispatchEvent(new Event(SCHEMA_UPDATED_EVENT));

    expect(keys()).toEqual([]);
  });
});
