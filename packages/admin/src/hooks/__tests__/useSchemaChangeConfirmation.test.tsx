// The state between previewing a schema change and applying it. Each builder
// page used to hold this as four separate variables, and the flag that tells
// the fetcher "this tab is the one applying" was raised and lowered by hand in
// six places.
import { act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { renderHook } from "@admin/__tests__/utils";
import type { SchemaPreviewResponse } from "@admin/services/schemaApi";

import { useSchemaChangeConfirmation } from "../useSchemaChangeConfirmation";

function preview(schemaVersion = 3): SchemaPreviewResponse {
  return {
    hasChanges: true,
    hasDestructiveChanges: false,
    classification: "safe",
    changes: { added: [], removed: [], changed: [], unchanged: [] },
    warnings: [],
    interactiveFields: [],
    ddlPreview: [],
    schemaVersion,
    renamed: [],
  };
}

beforeEach(() => {
  delete window.__nextlySchemaApplying;
});

afterEach(() => {
  delete window.__nextlySchemaApplying;
});

describe("useSchemaChangeConfirmation", () => {
  it("starts with nothing pending", () => {
    const { result } = renderHook(() => useSchemaChangeConfirmation());
    expect(result.current.preview).toBeNull();
    expect(result.current.isOpen).toBe(false);
    expect(result.current.isApplying).toBe(false);
  });

  it("puts a previewed change in front of the user", () => {
    const { result } = renderHook(() => useSchemaChangeConfirmation());
    act(() => result.current.request(preview(7)));
    expect(result.current.preview?.schemaVersion).toBe(7);
    expect(result.current.isOpen).toBe(true);
  });

  // Dismissing is not the same as applying: the preview survives so the page
  // still knows which change the user walked away from.
  it("keeps the preview when the dialog is dismissed", () => {
    const { result } = renderHook(() => useSchemaChangeConfirmation());
    act(() => result.current.request(preview()));
    act(() => result.current.setOpen(false));
    expect(result.current.isOpen).toBe(false);
    expect(result.current.preview).not.toBeNull();
  });

  // Once applied, the preview describes a schema that no longer exists, so a
  // retry has to preview again rather than re-confirm the stale one.
  it("forgets the preview once the apply settles", () => {
    const { result } = renderHook(() => useSchemaChangeConfirmation());
    act(() => result.current.request(preview()));
    act(() => result.current.settle());
    expect(result.current.isOpen).toBe(false);
    expect(result.current.preview).toBeNull();
  });

  // The fetcher announces a schema version it did not expect. Without this
  // flag our own apply looks exactly like a code-first edit or another tab,
  // and the page reacts to itself.
  it("raises and lowers the flag that tells the fetcher this tab is applying", () => {
    const { result } = renderHook(() => useSchemaChangeConfirmation());

    act(() => result.current.beginApply());
    expect(result.current.isApplying).toBe(true);
    expect(window.__nextlySchemaApplying).toBe(true);

    act(() => result.current.endApply());
    expect(result.current.isApplying).toBe(false);
    expect(window.__nextlySchemaApplying).toBe(false);
  });

  // The appliers list this object in their dependency arrays, so an identity
  // that changed on every render would rebuild them on every render.
  it("keeps a stable identity while nothing changes", () => {
    const { result, rerender } = renderHook(() =>
      useSchemaChangeConfirmation()
    );
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });
});
