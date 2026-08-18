// The editor's language state, and the seed that has to survive a switch.
//
// The pairing is the whole point: a switch refetches the document and tears the
// editor's subtree down, so a seed recorded inside it is gone before anything
// can act on it. These tests pin the rules that make the pair safe to carry —
// a seed never outlives the switch that asked for it, and returning to the
// default abandons it.
import { renderHook, act } from "@testing-library/react";
import { describe, it, expect } from "vitest";

import { useEditorLocale } from "../useEditorLocale";

describe("useEditorLocale", () => {
  it("starts on the app default, with nothing to seed", () => {
    const { result } = renderHook(() => useEditorLocale());
    expect(result.current.locale).toBeUndefined();
    expect(result.current.seedFromLocale).toBeUndefined();
  });

  it("carries the seed alongside the language it was asked for", () => {
    const { result } = renderHook(() => useEditorLocale());
    act(() => result.current.changeLocale("de", { seedFrom: "en" }));
    expect(result.current.locale).toBe("de");
    expect(result.current.seedFromLocale).toBe("en");
  });

  it("switches without a seed when none was asked for", () => {
    const { result } = renderHook(() => useEditorLocale());
    act(() => result.current.changeLocale("de"));
    expect(result.current.locale).toBe("de");
    expect(result.current.seedFromLocale).toBeUndefined();
  });

  it("drops a previous seed on the next plain switch", () => {
    // Otherwise a copy the author asked for two languages ago is re-offered in
    // a language they never asked it for.
    const { result } = renderHook(() => useEditorLocale());
    act(() => result.current.changeLocale("de", { seedFrom: "en" }));
    act(() => result.current.changeLocale("fr"));
    expect(result.current.locale).toBe("fr");
    expect(result.current.seedFromLocale).toBeUndefined();
  });

  it("clears the seed once the editor has offered it, keeping the language", () => {
    const { result } = renderHook(() => useEditorLocale());
    act(() => result.current.changeLocale("de", { seedFrom: "en" }));
    act(() => result.current.clearSeed());
    expect(result.current.seedFromLocale).toBeUndefined();
    expect(result.current.locale).toBe("de");
  });

  it("abandons a pending seed when returning to the default language", () => {
    // The seed names a target that is no longer being edited, so acting on it
    // would fill the default language from a copy meant for another one.
    const { result } = renderHook(() => useEditorLocale());
    act(() => result.current.changeLocale("de", { seedFrom: "en" }));
    act(() => result.current.resetLocale());
    expect(result.current.locale).toBeUndefined();
    expect(result.current.seedFromLocale).toBeUndefined();
  });
});
