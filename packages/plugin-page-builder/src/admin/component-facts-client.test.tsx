// @vitest-environment jsdom
/**
 * What the component editor is told about the component it edits.
 *
 * The property a plausible implementation gets wrong: handing the inspector
 * nothing while the read is out, which reads as "nothing to reserve" and lets
 * a new field take an id the live definition still uses. Until the read has
 * answered, adding a field waits, with the reason.
 *
 * @module admin/component-facts-client.test
 */
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@nextlyhq/plugin-sdk/admin", () => ({
  usePluginRoute: vi.fn(),
  useDocumentLocale: vi.fn(),
}));

import { useDocumentLocale, usePluginRoute } from "@nextlyhq/plugin-sdk/admin";

import type { ComponentFactsResponse } from "../library-contract";

import {
  FACTS_FAILED,
  FACTS_PENDING,
  FACTS_UNRECORDED,
  useComponentFacts,
} from "./component-facts-client";

const read = vi.mocked(usePluginRoute);
const documentLocale = vi.mocked(useDocumentLocale);

function answering(
  data: ComponentFactsResponse | undefined,
  error: Error | null = null
): void {
  read.mockReturnValue({
    data,
    error,
    pending: data === undefined && error === null,
    refetch: () => {},
  } as unknown as ReturnType<typeof usePluginRoute<ComponentFactsResponse>>);
}

beforeEach(() => {
  read.mockReset();
  documentLocale.mockReturnValue(null);
});

describe("the component's facts", () => {
  it("make adding a field wait while the read is out", () => {
    answering(undefined);
    const { result } = renderHook(() => useComponentFacts("hero"));
    expect(result.current).toEqual({
      reserved: { unavailable: FACTS_PENDING },
    });
  });

  it("keep it waiting, with the reason, when the read failed", () => {
    answering(undefined, new Error("Forbidden"));
    const { result } = renderHook(() => useComponentFacts("hero"));
    expect(result.current).toEqual({ reserved: { unavailable: FACTS_FAILED } });
  });

  it("trust no earlier answer while a read failed", () => {
    answering(
      {
        live: { properties: ["title"], slots: [] },
        retired: { properties: [], slots: [] },
        reach: null,
        pages: null,
      },
      new Error("Forbidden")
    );
    const { result } = renderHook(() => useComponentFacts("hero"));
    expect(result.current).toEqual({ reserved: { unavailable: FACTS_FAILED } });
  });

  it("are read under a key of this mount's own, so no cached answer stands in", () => {
    answering(undefined);
    renderHook(() => useComponentFacts("hero"));
    renderHook(() => useComponentFacts("hero"));
    const paths = read.mock.calls.map(call => call[0].path);
    expect(new Set(paths).size).toBe(2);
  });

  it("make adding wait for good where the store records no retirements", () => {
    answering({
      live: { properties: ["title"], slots: [] },
      retired: null,
      reach: null,
      pages: { count: 3, complete: true },
    });
    const { result } = renderHook(() => useComponentFacts("hero"));
    // The page count still travels: the banner says it whatever the ids.
    expect(result.current).toEqual({
      reserved: { unavailable: FACTS_UNRECORDED },
      pages: { count: 3, complete: true },
    });
  });

  it("reserve the live and retired ids and carry the count once answered", () => {
    answering({
      live: { properties: ["title"], slots: [] },
      retired: { properties: ["subtitle"], slots: ["aside"] },
      reach: { count: 2, complete: false },
      pages: { count: 5, complete: false },
    });
    const { result } = renderHook(() => useComponentFacts("hero"));
    expect(result.current).toEqual({
      reserved: { properties: ["title", "subtitle"], slots: ["aside"] },
      reach: { count: 2, complete: false },
      pages: { count: 5, complete: false },
    });
  });

  it("are read in the language being edited", () => {
    documentLocale.mockReturnValue({ code: "de" } as never);
    answering(undefined);
    renderHook(() => useComponentFacts("hero"));
    expect(read.mock.calls[0]?.[0]).toMatchObject({
      path: expect.stringMatching(
        /^\/component-facts\?id=hero&locale=de&mount=/
      ),
      enabled: true,
    });
  });

  it("are not read for a document with no live definition", () => {
    answering(undefined);
    const { result } = renderHook(() => useComponentFacts(undefined));
    expect(result.current).toBeUndefined();
    expect(read.mock.calls[0]?.[0]).toMatchObject({ enabled: false });
  });
});
