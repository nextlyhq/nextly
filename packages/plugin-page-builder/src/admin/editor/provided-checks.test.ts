// @vitest-environment jsdom

/**
 * Other plugins' page checks in the editor: each provider's answer turned
 * into a check beside the builder's own, its fix in the builder's terms, a
 * provider that didn't run named as not run, and the providers asked again
 * after a save and after Page settings closes.
 */
import { CORE_PAGE_CHECKS, runPageChecks } from "@nextlyhq/builder";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ProvidedChecksItem } from "../../page-checks-provided-contract";

import {
  providedCheck,
  providedResult,
  useProvidedChecks,
} from "./provided-checks";

const write = vi.fn();
let storedAt: string | null = null;

vi.mock("@nextlyhq/plugin-sdk/admin", () => ({
  writePluginRoute: (...args: unknown[]) => write(...args) as unknown,
  useDocumentActions: () => ({ storedAt }),
}));

beforeEach(() => {
  write.mockReset();
  storedAt = null;
});

const PAGE = { formatVersion: 1 as const, kind: "page" as const, nodes: [] };

const seo: ProvidedChecksItem = {
  provider: "seo",
  group: "search",
  ran: true,
  findings: [
    {
      what: "Title is too long",
      why: "Search results cut it short.",
      todo: "Shorten the title.",
      fix: { settingsTab: "seo-tab" },
    },
  ],
};

describe("a provider's answer as a check", () => {
  it("maps a settings tab fix and a block setting fix to the builder's terms", () => {
    expect(
      providedResult({
        what: "a",
        why: "b",
        todo: "c",
        fix: { settingsTab: "seo" },
      })
    ).toEqual({ what: "a", why: "b", todo: "c", settingsTab: "seo" });
    expect(
      providedResult({
        what: "a",
        why: "b",
        todo: "c",
        nodeId: "n",
        fix: { tab: "content", id: "alt" },
      })
    ).toEqual({
      what: "a",
      why: "b",
      todo: "c",
      nodeId: "n",
      fix: { tab: "content", id: "alt" },
    });
  });

  it("lists its findings in its group, and names one that didn't run", () => {
    const report = runPageChecks({ document: PAGE }, [
      providedCheck(seo),
      providedCheck({ ...seo, provider: "broken", ran: false, findings: [] }),
    ]);
    expect(report.findings).toEqual([
      expect.objectContaining({
        check: "provided:seo",
        group: "search",
        what: "Title is too long",
        settingsTab: "seo-tab",
      }),
    ]);
    expect(report.notRun).toEqual(["provided:broken"]);
  });
});

describe("useProvidedChecks", () => {
  const page = { collection: "pages", id: "p-1" };

  it("asks for the page, and runs the providers' checks after the builder's own", async () => {
    write.mockResolvedValue({ items: [seo] });
    const { result } = renderHook(() =>
      useProvidedChecks({
        page,
        document: PAGE,
        locale: "en",
        settingsClosed: 0,
      })
    );
    await waitFor(() =>
      expect(result.current).toHaveLength(CORE_PAGE_CHECKS.length + 1)
    );
    expect(write).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "POST",
        body: {
          collection: "pages",
          entryId: "p-1",
          locale: "en",
          document: PAGE,
        },
      })
    );
    expect(result.current.at(-1)?.id).toBe("provided:seo");
  });

  it("asks again once editing pauses, not on each keystroke", async () => {
    vi.useFakeTimers();
    try {
      write.mockResolvedValue({ items: [] });
      const { rerender } = renderHook(
        (props: { document: unknown }) =>
          useProvidedChecks({
            page,
            document: props.document,
            locale: undefined,
            settingsClosed: 0,
          }),
        { initialProps: { document: PAGE as unknown } }
      );
      await act(() => vi.advanceTimersByTimeAsync(0));
      expect(write).toHaveBeenCalledTimes(1);
      rerender({ document: { ...PAGE, nodes: [] } });
      await act(() => vi.advanceTimersByTimeAsync(500));
      rerender({ document: { ...PAGE, nodes: [] } });
      await act(() => vi.advanceTimersByTimeAsync(500));
      // Still typing: nothing asked yet.
      expect(write).toHaveBeenCalledTimes(1);
      await act(() => vi.advanceTimersByTimeAsync(1000));
      expect(write).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("asks again after a save and after Page settings closes", async () => {
    write.mockResolvedValue({ items: [] });
    const { rerender } = renderHook(
      (props: { document: unknown; closed: number }) =>
        useProvidedChecks({
          page,
          document: props.document,
          locale: undefined,
          settingsClosed: props.closed,
        }),
      { initialProps: { document: PAGE, closed: 0 } }
    );
    await waitFor(() => expect(write).toHaveBeenCalledTimes(1));
    storedAt = "2026-11-18T08:00:00Z";
    rerender({ document: PAGE, closed: 0 });
    await waitFor(() => expect(write).toHaveBeenCalledTimes(2));
    rerender({ document: PAGE, closed: 1 });
    await waitFor(() => expect(write).toHaveBeenCalledTimes(3));
  });

  it("asks nothing for a document that isn't a saved page, and keeps the built-in checks", () => {
    const { result } = renderHook(() =>
      useProvidedChecks({
        page: null,
        document: PAGE,
        locale: undefined,
        settingsClosed: 0,
      })
    );
    expect(write).not.toHaveBeenCalled();
    expect(result.current).toEqual(CORE_PAGE_CHECKS);
  });

  it("keeps the built-in checks where the route can't be asked", async () => {
    write.mockRejectedValue(new Error("offline"));
    const { result } = renderHook(() =>
      useProvidedChecks({
        page,
        document: PAGE,
        locale: undefined,
        settingsClosed: 0,
      })
    );
    await waitFor(() => expect(write).toHaveBeenCalled());
    expect(result.current).toEqual(CORE_PAGE_CHECKS);
  });
});
