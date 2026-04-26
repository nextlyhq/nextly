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

    it("flips the flag on serverComponentChanges (Next 16 shape: data.type)", async () => {
      process.env.NODE_ENV = "development";
      const { ensureHmrListener, consumeHmrReloadFlag } = await import(
        "../hmr-listener"
      );
      ensureHmrListener();
      const ws = getHmrCache().__nextly_hmrWs;
      ws?.onmessage?.({
        data: JSON.stringify({ type: "serverComponentChanges" }),
      });
      expect(consumeHmrReloadFlag()).toBe(true);
      // After consume, the flag clears.
      expect(consumeHmrReloadFlag()).toBe(false);
    });

    it("flips the flag on serverComponentChanges (Next 15 shape: data.action)", async () => {
      process.env.NODE_ENV = "development";
      const { ensureHmrListener, consumeHmrReloadFlag } = await import(
        "../hmr-listener"
      );
      ensureHmrListener();
      const ws = getHmrCache().__nextly_hmrWs;
      ws?.onmessage?.({
        data: JSON.stringify({ action: "serverComponentChanges" }),
      });
      expect(consumeHmrReloadFlag()).toBe(true);
    });

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
});
