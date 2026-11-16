// The pool defaults and the pool attaching both adapters use on Vercel. The
// adapters' own tests hold that each one wires these in; these hold what the
// shared pieces answer, the warning for a missing package included.
import { describe, expect, it, vi } from "vitest";

import {
  SERVERLESS_POOL_DEFAULTS,
  isVercelFunction,
  loadVercelPoolAttacher,
} from "../serverless";

const onVercel = { VERCEL: "1" };

function recordingLogger() {
  return { warn: vi.fn(), info: vi.fn() };
}

describe("isVercelFunction", () => {
  it("is true when Vercel sets VERCEL", () => {
    expect(isVercelFunction({ VERCEL: "1" })).toBe(true);
  });

  it("is false when VERCEL is unset or empty", () => {
    expect(isVercelFunction({})).toBe(false);
    expect(isVercelFunction({ VERCEL: "" })).toBe(false);
  });
});

describe("SERVERLESS_POOL_DEFAULTS", () => {
  it("is a small pool that keeps no connection open and closes idle ones after 5 s", () => {
    expect(SERVERLESS_POOL_DEFAULTS).toEqual({
      max: 3,
      min: 0,
      idleTimeoutMs: 5000,
    });
  });
});

describe("loadVercelPoolAttacher", () => {
  it("loads nothing and attaches nothing off Vercel", async () => {
    const load = vi.fn();
    const logger = recordingLogger();

    const attach = await loadVercelPoolAttacher({
      load,
      dialect: "PostgreSQL",
      logger,
      env: {},
    });

    expect(attach).toBeUndefined();
    expect(load).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("hands the pool to attachDatabasePool on Vercel", async () => {
    const attachDatabasePool = vi.fn();
    const pool = { on: () => {} };

    const attach = await loadVercelPoolAttacher({
      load: () => Promise.resolve({ attachDatabasePool }),
      dialect: "PostgreSQL",
      env: onVercel,
    });
    attach?.(pool);

    expect(attachDatabasePool).toHaveBeenCalledTimes(1);
    expect(attachDatabasePool).toHaveBeenCalledWith(pool);
  });

  it("reads attachDatabasePool from a CommonJS default export", async () => {
    const attachDatabasePool = vi.fn();

    const attach = await loadVercelPoolAttacher({
      load: () => Promise.resolve({ default: { attachDatabasePool } }),
      dialect: "PostgreSQL",
      env: onVercel,
    });
    attach?.({});

    expect(attachDatabasePool).toHaveBeenCalledTimes(1);
  });

  it("warns once, naming the package to install, when it is not installed", async () => {
    const logger = recordingLogger();
    const missing = Object.assign(
      new Error("Cannot find package '@vercel/functions'"),
      { code: "ERR_MODULE_NOT_FOUND" }
    );

    const attach = await loadVercelPoolAttacher({
      load: () => Promise.reject(missing),
      dialect: "PostgreSQL",
      logger,
      env: onVercel,
    });

    expect(attach).toBeUndefined();
    expect(logger.warn).toHaveBeenCalledTimes(1);
    const [message] = logger.warn.mock.calls[0] ?? [];
    expect(message).toContain("@vercel/functions");
    expect(message).toContain("PostgreSQL");
    expect(message).toContain("Cannot find package '@vercel/functions'");
  });

  it("warns on the console when the adapter was given no logger", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const attach = await loadVercelPoolAttacher({
        load: () => Promise.reject(new Error("not installed")),
        dialect: "MySQL",
        env: onVercel,
      });

      expect(attach).toBeUndefined();
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0]?.[0])).toContain("@vercel/functions");
    } finally {
      warn.mockRestore();
    }
  });

  it("warns when the installed version has no attachDatabasePool", async () => {
    const logger = recordingLogger();

    const attach = await loadVercelPoolAttacher({
      load: () => Promise.resolve({ waitUntil: () => {} }),
      dialect: "PostgreSQL",
      logger,
      env: onVercel,
    });

    expect(attach).toBeUndefined();
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn.mock.calls[0]?.[0]).toContain("attachDatabasePool");
  });

  it("warns rather than throws when attachDatabasePool refuses the pool", async () => {
    const logger = recordingLogger();
    const attach = await loadVercelPoolAttacher({
      load: () =>
        Promise.resolve({
          attachDatabasePool: () => {
            throw new Error("Unsupported database pool type");
          },
        }),
      dialect: "MySQL",
      logger,
      env: onVercel,
    });

    expect(() => attach?.({})).not.toThrow();
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn.mock.calls[0]?.[0]).toContain(
      "Unsupported database pool type"
    );
  });
});
