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

  describe("email addresses outside development and test", () => {
    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it("masks them in what the default logger writes", () => {
      vi.stubEnv("NODE_ENV", "production");
      getNextlyLogger().error({
        kind: "email.failed",
        detail: { cause: "550 <john@example.com>: user unknown" },
      });
      const written = (console.error as ReturnType<typeof vi.fn>).mock
        .calls[0][0] as string;
      expect(written).not.toContain("john@example.com");
      expect(written).toContain("j***@example.com");
    });

    it("masks them before an installed logger receives the payload", () => {
      // The app's own logger is where the line ends up, so the payload is
      // masked before it is handed over, not only in the default writer.
      vi.stubEnv("NODE_ENV", undefined);
      const custom: NextlyLogger = {
        error: vi.fn(),
        warn: vi.fn(),
        info: vi.fn(),
        debug: vi.fn(),
      };
      setNextlyLogger(custom);
      getNextlyLogger().warn({ to: ["jane@example.com"] });
      expect(custom.warn).toHaveBeenCalledWith({ to: ["j***@example.com"] });
    });

    it("restores a logger saved from the getter, still masking once", () => {
      // What the getter hands out is the masking wrapper, so saving it and
      // installing it again must put back the logger behind it: installing
      // the wrapper itself would make it call itself.
      vi.stubEnv("NODE_ENV", "production");
      const saved: NextlyLogger = {
        error: vi.fn(),
        warn: vi.fn(),
        info: vi.fn(),
        debug: vi.fn(),
      };
      setNextlyLogger(saved);
      const held = getNextlyLogger();
      setNextlyLogger({
        error: vi.fn(),
        warn: vi.fn(),
        info: vi.fn(),
        debug: vi.fn(),
      });
      setNextlyLogger(held);
      expect(getNextlyLogger()).toBe(held);
      getNextlyLogger().error({ to: "jane@example.com" });
      expect(saved.error).toHaveBeenCalledTimes(1);
      expect(saved.error).toHaveBeenCalledWith({ to: "j***@example.com" });
    });

    it("leaves them whole in development", () => {
      vi.stubEnv("NODE_ENV", "development");
      getNextlyLogger().info({ to: "jane@example.com" });
      const written = (console.info as ReturnType<typeof vi.fn>).mock
        .calls[0][0] as string;
      expect(written).toContain("jane@example.com");
    });
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
