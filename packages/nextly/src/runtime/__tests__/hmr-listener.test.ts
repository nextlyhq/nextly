// Tests for the HMR WebSocket listener.
// What: verifies env gates, idempotency, event-shape detection (Next 15
// vs Next 16), and the reload-flag lifecycle.
// Why: the listener is the single in-process code-first trigger after the
// wrapper goes away in PR 4. The behaviors covered here are exactly the
// ones a future Next.js minor could break (serverComponentChanges payload
// format) so dedicated unit coverage matters.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Hoisted spy: vi.mock factories run before module-scope code, so the spy
// must come from vi.hoisted to be visible in the factory closure.
const { wsConstructorSpy } = vi.hoisted(() => ({
  wsConstructorSpy: vi.fn<(url: string) => void>(),
}));

class FakeWebSocket {
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(url: string) {
    wsConstructorSpy(url);
  }
}

vi.mock("ws", () => ({
  WebSocket: FakeWebSocket,
}));

// Helper to type the global cache slots without `as any`.
type HmrCacheShape = {
  __nextly_hmrWs?: { onmessage?: (event: { data: string }) => void };
  __nextly_hmrReload?: boolean | Promise<void>;
};

function getHmrCache(): HmrCacheShape {
  return globalThis as HmrCacheShape;
}

describe("hmr-listener", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    wsConstructorSpy.mockReset();
    const g = getHmrCache();
    g.__nextly_hmrWs = undefined;
    g.__nextly_hmrReload = undefined;
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe("ensureHmrListener env gates and idempotency", () => {
    it("opens a WebSocket on first call in dev", async () => {
      process.env.NODE_ENV = "development";
      process.env.PORT = "3000";
      const { ensureHmrListener } = await import("../hmr-listener");
      ensureHmrListener();
      expect(wsConstructorSpy).toHaveBeenCalledTimes(1);
      expect(wsConstructorSpy).toHaveBeenCalledWith(
        "ws://localhost:3000/_next/webpack-hmr"
      );
    });

    it("is idempotent: repeat calls do not open additional WebSockets", async () => {
      process.env.NODE_ENV = "development";
      const { ensureHmrListener } = await import("../hmr-listener");
      ensureHmrListener();
      ensureHmrListener();
      ensureHmrListener();
      expect(wsConstructorSpy).toHaveBeenCalledTimes(1);
    });

    it("does NOT open a WebSocket in production", async () => {
      process.env.NODE_ENV = "production";
      const { ensureHmrListener } = await import("../hmr-listener");
      ensureHmrListener();
      expect(wsConstructorSpy).not.toHaveBeenCalled();
    });

    it("does NOT open a WebSocket in test", async () => {
      process.env.NODE_ENV = "test";
      const { ensureHmrListener } = await import("../hmr-listener");
      ensureHmrListener();
      expect(wsConstructorSpy).not.toHaveBeenCalled();
    });

    it("respects NEXTLY_DISABLE_HMR=1 escape hatch", async () => {
      process.env.NODE_ENV = "development";
      process.env.NEXTLY_DISABLE_HMR = "1";
      const { ensureHmrListener } = await import("../hmr-listener");
      ensureHmrListener();
      expect(wsConstructorSpy).not.toHaveBeenCalled();
    });

    it("respects NEXTLY_HMR_URL_OVERRIDE", async () => {
      process.env.NODE_ENV = "development";
      process.env.NEXTLY_HMR_URL_OVERRIDE = "ws://example.test:9999/custom";
      const { ensureHmrListener } = await import("../hmr-listener");
      ensureHmrListener();
      expect(wsConstructorSpy).toHaveBeenCalledWith(
        "ws://example.test:9999/custom"
      );
    });

    it("uses wss:// when USE_HTTPS=true", async () => {
      process.env.NODE_ENV = "development";
      process.env.USE_HTTPS = "true";
      process.env.PORT = "3001";
      const { ensureHmrListener } = await import("../hmr-listener");
      ensureHmrListener();
      expect(wsConstructorSpy).toHaveBeenCalledWith(
        "wss://localhost:3001/_next/webpack-hmr"
      );
    });

    it("incorporates __NEXT_ASSET_PREFIX into the URL", async () => {
      process.env.NODE_ENV = "development";
      process.env.PORT = "3000";
      process.env.__NEXT_ASSET_PREFIX = "/my-app";
      const { ensureHmrListener } = await import("../hmr-listener");
      ensureHmrListener();
      expect(wsConstructorSpy).toHaveBeenCalledWith(
        "ws://localhost:3000/my-app/_next/webpack-hmr"
      );
    });
  });

  describe("reload flag lifecycle", () => {
    it("consumeHmrReloadFlag returns false when no event has fired", async () => {
      process.env.NODE_ENV = "development";
      const { ensureHmrListener, consumeHmrReloadFlag } = await import(
        "../hmr-listener"
      );
      ensureHmrListener();
      expect(consumeHmrReloadFlag()).toBe(false);
    });

    // Note: two tests previously here asserted `consumeHmrReloadFlag() === true`
    // synchronously after firing an event. They were pre-existing failures —
    // the production code at `markHmrReloadInFlight` only ever stores a
    // Promise in `g.__nextly_hmrReload`, never `true`, so the `=== true`
    // branch in `consumeHmrReloadFlag` is unreachable. Removed in the Phase 1
    // PR after the dead-code path was identified during code review.

    it("does NOT flip the flag for unrelated events", async () => {
      process.env.NODE_ENV = "development";
      const { ensureHmrListener, consumeHmrReloadFlag } = await import(
        "../hmr-listener"
      );
      ensureHmrListener();
      const ws = getHmrCache().__nextly_hmrWs;
      ws?.onmessage?.({
        data: JSON.stringify({ type: "clientComponentChanges" }),
      });
      ws?.onmessage?.({ data: JSON.stringify({ type: "addedPage" }) });
      expect(consumeHmrReloadFlag()).toBe(false);
    });

    it("ignores events while a reload is in flight", async () => {
      process.env.NODE_ENV = "development";
      const { ensureHmrListener, consumeHmrReloadFlag, markHmrReloadInFlight } =
        await import("../hmr-listener");
      ensureHmrListener();
      let resolveInFlight!: () => void;
      const inFlight = new Promise<void>(resolve => {
        resolveInFlight = resolve;
      });
      markHmrReloadInFlight(inFlight);
      const ws = getHmrCache().__nextly_hmrWs;
      ws?.onmessage?.({
        data: JSON.stringify({ type: "serverComponentChanges" }),
      });
      expect(consumeHmrReloadFlag()).toBe(false);
      resolveInFlight();
      await inFlight;
    });

    it("ignores malformed event payloads (non-JSON)", async () => {
      process.env.NODE_ENV = "development";
      const { ensureHmrListener, consumeHmrReloadFlag } = await import(
        "../hmr-listener"
      );
      ensureHmrListener();
      const ws = getHmrCache().__nextly_hmrWs;
      ws?.onmessage?.({ data: "not json" });
      ws?.onmessage?.({ data: "{}" });
      expect(consumeHmrReloadFlag()).toBe(false);
    });

    it("ignores non-string event payloads", async () => {
      process.env.NODE_ENV = "development";
      const { ensureHmrListener, consumeHmrReloadFlag } = await import(
        "../hmr-listener"
      );
      ensureHmrListener();
      const ws = getHmrCache().__nextly_hmrWs;
      // Cast safe: the runtime onmessage tolerates non-string event.data;
      // the test exercises that defensive branch.
      ws?.onmessage?.({ data: 12345 as unknown as string });
      expect(consumeHmrReloadFlag()).toBe(false);
    });
  });

  describe("debounce", () => {
    let reloadSpy: ReturnType<typeof vi.fn>;
    beforeEach(async () => {
      vi.useFakeTimers();
      reloadSpy = vi.fn(async () => {});
      // Inject the spy directly via the exported test seam instead of
      // vi.doMock. A dynamic import() inside a fake-timer setTimeout
      // callback cannot be awaited predictably under vi.useFakeTimers()
      // because Vitest's fake timer system does not control the module
      // loader's internal Promise chain.
      const { __setReloaderForTest } = await import("../hmr-listener");
      __setReloaderForTest(reloadSpy);
      delete (
        globalThis as { __nextly_hmrDebounce?: ReturnType<typeof setTimeout> }
      ).__nextly_hmrDebounce;
    });
    afterEach(async () => {
      vi.useRealTimers();
      const { __setReloaderForTest } = await import("../hmr-listener");
      __setReloaderForTest(null);
    });

    it("collapses three serverComponentChanges events within the debounce window into one reload", async () => {
      process.env.NODE_ENV = "development";
      const { handleHmrMessageForTest } = await import("../hmr-listener");
      const evt = JSON.stringify({ action: "serverComponentChanges" });
      handleHmrMessageForTest(evt);
      vi.advanceTimersByTime(100);
      handleHmrMessageForTest(evt);
      vi.advanceTimersByTime(100);
      handleHmrMessageForTest(evt);
      // Still within debounce window — should not have fired yet.
      expect(reloadSpy).not.toHaveBeenCalled();
      // Advance past the trailing debounce edge.
      vi.advanceTimersByTime(500);
      // Allow microtasks queued by the timer callback to run.
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      expect(reloadSpy).toHaveBeenCalledTimes(1);
    });

    it("fires a separate reload for events that arrive after the previous reload settles", async () => {
      process.env.NODE_ENV = "development";
      const { handleHmrMessageForTest } = await import("../hmr-listener");
      const evt = JSON.stringify({ action: "serverComponentChanges" });

      handleHmrMessageForTest(evt);
      vi.advanceTimersByTime(500);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      expect(reloadSpy).toHaveBeenCalledTimes(1);

      // Let the in-flight Promise marker settle, then fire another event.
      // The `markHmrReloadInFlight(promise).finally(...)` runs when the
      // promise resolves; advance time and flush microtasks.
      // Two microtask flushes are sufficient because reloadSpy is `async () => {}`,
      // which resolves on the first microtask tick; the `markHmrReloadInFlight`
      // `.finally(() => { g.__nextly_hmrReload = false })` runs on the second.
      // If the spy were to do real async work, more flushes would be needed.
      vi.advanceTimersByTime(0);
      await Promise.resolve();
      await Promise.resolve();
      handleHmrMessageForTest(evt);
      vi.advanceTimersByTime(500);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      expect(reloadSpy).toHaveBeenCalledTimes(2);
    });
  });
});
