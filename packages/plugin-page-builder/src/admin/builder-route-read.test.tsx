// @vitest-environment jsdom

/**
 * A read the builder opens on shows its start-up answer and sends nothing,
 * and is `usePluginRoute` itself otherwise: with no start-up read, once the
 * hook asks again, for a read the start-up request could not answer, and for
 * a mount made long after the builder opened.
 *
 * @module admin/builder-route-read.test
 */
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

/** Every request `usePluginRoute` was handed, in order. */
const routeAsked: Array<Record<string, unknown>> = [];

vi.mock("@nextlyhq/plugin-sdk/admin", () => ({
  readPluginRoute: vi.fn(),
  usePluginRoute: (request: Record<string, unknown>) => {
    routeAsked.push(request);
    const enabled = request.enabled ?? true;
    return {
      data: enabled ? { from: "route" } : undefined,
      pending: false,
      error: null,
      refetch: vi.fn(),
      fetching: false,
    };
  },
}));

import { useBuilderRoute } from "./builder-route-read";
import {
  forgetStartedReads,
  STARTED_READ_HANDOFF_MS,
  startBuilderReads,
} from "./startup-reads";

const PLUGIN = "@nextlyhq/plugin-page-builder";

afterEach(() => {
  cleanup();
  forgetStartedReads();
  routeAsked.length = 0;
  vi.useRealTimers();
});

/** The last request `usePluginRoute` was handed. */
const lastAsked = () => routeAsked.at(-1);

/** A start-up request that answers when `answer` is called. */
function deferredStartup() {
  let answer: (reads: Record<string, unknown>) => void = () => {};
  const ask = () =>
    new Promise<never>(resolve => {
      answer = resolve as never;
    });
  return { ask, answer: (reads: Record<string, unknown>) => answer(reads) };
}

describe("a read the builder opens on", () => {
  it("is usePluginRoute itself when no start-up read was sent", () => {
    const request = { plugin: PLUGIN, path: "/capability", staleTime: 0 };
    const { result } = renderHook(() => useBuilderRoute(request));
    expect(lastAsked()).toBe(request);
    expect(result.current.data).toEqual({ from: "route" });
  });

  it("waits for the start-up answer, shows it, and sends nothing of its own", async () => {
    const startup = deferredStartup();
    startBuilderReads("ada", ["/capability"], startup.ask as never);
    const { result } = renderHook(() =>
      useBuilderRoute({ plugin: PLUGIN, path: "/capability", staleTime: 0 })
    );
    expect(result.current).toMatchObject({ data: undefined, pending: true });
    expect(lastAsked()?.enabled).toBe(false);

    await act(async () => {
      startup.answer({
        "/capability": { status: 200, body: { from: "start-up" } },
      });
    });
    expect(result.current).toMatchObject({
      data: { from: "start-up" },
      pending: false,
      error: null,
    });
    expect(routeAsked.every(asked => asked.enabled === false)).toBe(true);

    // A second mount made as the builder opens shows the same answer.
    const second = renderHook(() =>
      useBuilderRoute({ plugin: PLUGIN, path: "/capability", staleTime: 0 })
    );
    expect(second.result.current.data).toEqual({ from: "start-up" });
  });

  it("reads its route once it asks again", async () => {
    startBuilderReads("ada", ["/site/style"], async () => ({
      "/site/style": { status: 200, body: { from: "start-up" } },
    }));
    const { result } = renderHook(() =>
      useBuilderRoute({ plugin: PLUGIN, path: "/site/style" })
    );
    await act(async () => {});
    expect(result.current.data).toEqual({ from: "start-up" });
    act(() => result.current.refetch());
    expect(lastAsked()).toEqual({ plugin: PLUGIN, path: "/site/style" });
    expect(result.current.data).toEqual({ from: "route" });
  });

  it("reads its route when the start-up request could not answer it", async () => {
    startBuilderReads("ada", ["/layouts/choices"], async () => ({
      "/layouts/choices": { status: 403 },
    }));
    const { result } = renderHook(() =>
      useBuilderRoute({ plugin: PLUGIN, path: "/layouts/choices" })
    );
    await act(async () => {});
    expect(lastAsked()).toEqual({ plugin: PLUGIN, path: "/layouts/choices" });
    expect(result.current.data).toEqual({ from: "route" });
  });

  it("reads its route on a mount made long after the builder opened", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    startBuilderReads("ada", ["/capability"], async () => ({
      "/capability": { status: 200, body: { from: "start-up" } },
    }));
    await act(async () => {});
    vi.setSystemTime(Date.now() + STARTED_READ_HANDOFF_MS + 1);
    const { result } = renderHook(() =>
      useBuilderRoute({ plugin: PLUGIN, path: "/capability", staleTime: 0 })
    );
    expect(result.current.data).toEqual({ from: "route" });
  });

  it("shows nothing read for a person once another signs in", async () => {
    startBuilderReads("ada", ["/capability"], async () => ({
      "/capability": { status: 200, body: { from: "ada's start-up" } },
    }));
    await act(async () => {});
    startBuilderReads("grace", ["/other"], async () => ({}));
    const { result } = renderHook(() =>
      useBuilderRoute({ plugin: PLUGIN, path: "/capability" })
    );
    expect(result.current.data).toEqual({ from: "route" });
  });

  it("reads nothing while the caller holds the read", () => {
    startBuilderReads("ada", ["/capability"], async () => ({}));
    const request = { plugin: PLUGIN, path: "/capability", enabled: false };
    renderHook(() => useBuilderRoute(request));
    expect(lastAsked()).toBe(request);
  });
});
