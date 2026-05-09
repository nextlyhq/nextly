import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { setNextlyLogger, getNextlyLogger, type NextlyLogger } from "./logger";

describe("NextlyLogger seam", () => {
  let originalConsoleError: typeof console.error;
  let originalConsoleWarn: typeof console.warn;
  let originalConsoleInfo: typeof console.info;
  let originalConsoleDebug: typeof console.debug;

  beforeEach(() => {
    originalConsoleError = console.error;
    originalConsoleWarn = console.warn;
    originalConsoleInfo = console.info;
    originalConsoleDebug = console.debug;
    console.error = vi.fn();
    console.warn = vi.fn();
    console.info = vi.fn();
    console.debug = vi.fn();
  });

  afterEach(() => {
    console.error = originalConsoleError;
    console.warn = originalConsoleWarn;
    console.info = originalConsoleInfo;
    console.debug = originalConsoleDebug;
    setNextlyLogger(undefined);
  });

  it("default logger writes JSON to console.error on .error()", () => {
    const log = getNextlyLogger();
    log.error({ kind: "test", value: 42 });

    expect(console.error).toHaveBeenCalledOnce();
    const arg = (console.error as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as string;
    const parsed = JSON.parse(arg);
    expect(parsed.level).toBe("error");
    expect(parsed.kind).toBe("test");
    expect(parsed.value).toBe(42);
    expect(parsed.ts).toBeDefined();
  });

  it("default logger routes warn/info/debug correctly", () => {
    const log = getNextlyLogger();
    log.warn({ kind: "w" });
    log.info({ kind: "i" });
    log.debug({ kind: "d" });

    expect(console.warn).toHaveBeenCalledOnce();
    expect(console.info).toHaveBeenCalledOnce();
    expect(console.debug).toHaveBeenCalledOnce();

    const warnPayload = JSON.parse(
      (console.warn as ReturnType<typeof vi.fn>).mock.calls[0][0]
    );
    expect(warnPayload.level).toBe("warn");
    expect(warnPayload.kind).toBe("w");
  });

  it("setNextlyLogger replaces the default", () => {
    const custom: NextlyLogger = {
      error: vi.fn(),
      warn: vi.fn(),
      info: vi.fn(),
      debug: vi.fn(),
    };
    setNextlyLogger(custom);

    const log = getNextlyLogger();
    log.error({ kind: "x" });

    expect(custom.error).toHaveBeenCalledWith({ kind: "x" });
    expect(console.error).not.toHaveBeenCalled();
  });

  it("setNextlyLogger(undefined) restores the default", () => {
    const custom: NextlyLogger = {
      error: vi.fn(),
      warn: vi.fn(),
      info: vi.fn(),
      debug: vi.fn(),
    };
    setNextlyLogger(custom);
    setNextlyLogger(undefined);

    getNextlyLogger().error({ kind: "after-reset" });
    expect(custom.error).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledOnce();
  });
});
