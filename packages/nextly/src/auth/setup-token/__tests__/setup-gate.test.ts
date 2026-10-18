/**
 * The request-time pieces of setup: the claim one setup holds at a time, and
 * what a production start says about the token.
 */
import { describe, expect, it, vi } from "vitest";

import {
  SETUP_CLAIM_STALE_MS,
  claimFirstSetup,
  issueSetupTokenAtBoot,
} from "../setup-gate";
import {
  SETUP_TOKEN_ENV,
  SETUP_TOKEN_LOG_PREFIX,
  SETUP_TOKEN_META_KEY,
  type SetupTokenMeta,
} from "../setup-token";

function memoryMeta(): SetupTokenMeta {
  const rows = new Map<string, string>();
  return {
    async getEntry<T>(key: string) {
      const raw = rows.get(key);
      return raw === undefined
        ? { present: false as const }
        : { present: true as const, value: JSON.parse(raw) as T };
    },
    async insertIfAbsent(key, value) {
      if (!rows.has(key)) rows.set(key, JSON.stringify(value));
    },
    async compareAndSet(key, expected, next) {
      if (rows.get(key) !== JSON.stringify(expected)) return false;
      rows.set(key, JSON.stringify(next));
      return true;
    },
    async delete(key) {
      rows.delete(key);
    },
  };
}

describe("the setup claim", () => {
  it("lets one setup hold it, and frees it on release", async () => {
    const meta = memoryMeta();
    const first = await claimFirstSetup(meta);
    expect(first).not.toBeNull();
    expect(await claimFirstSetup(meta)).toBeNull();
    await first?.release();
    expect(await claimFirstSetup(meta)).not.toBeNull();
  });

  it("is never taken over while its holder is still running, however long that takes", async () => {
    vi.useFakeTimers();
    try {
      const meta = memoryMeta();
      const held = await claimFirstSetup(meta);
      expect(held).not.toBeNull();
      // Twice the stale age, with the holder renewing all along.
      await vi.advanceTimersByTimeAsync(SETUP_CLAIM_STALE_MS * 2);
      expect(await claimFirstSetup(meta)).toBeNull();
      await held?.release();
      expect(await claimFirstSetup(meta)).not.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("is taken over once it is stale, so a setup that stopped halfway does not close setup", async () => {
    const meta = memoryMeta();
    const t0 = 1_000_000;
    expect(await claimFirstSetup(meta, () => t0)).not.toBeNull();
    expect(
      await claimFirstSetup(meta, () => t0 + SETUP_CLAIM_STALE_MS - 1)
    ).toBeNull();
    expect(
      await claimFirstSetup(meta, () => t0 + SETUP_CLAIM_STALE_MS)
    ).not.toBeNull();
  });
});

describe("what a production start says", () => {
  const logger = () => ({ warn: vi.fn(), info: vi.fn() });

  it("issues and prints nothing while `next build` prerenders", async () => {
    const log = logger();
    const meta = memoryMeta();
    await issueSetupTokenAtBoot({
      meta,
      hasAdministrator: async () => false,
      logger: log,
      env: { NEXT_PHASE: "phase-production-build" },
    });
    expect(log.warn).not.toHaveBeenCalled();
    expect(log.info).not.toHaveBeenCalled();
    expect(await meta.getEntry(SETUP_TOKEN_META_KEY)).toEqual({
      present: false,
    });
  });

  it("prints a new token as a warning, so it shows in every host's logs", async () => {
    const log = logger();
    await issueSetupTokenAtBoot({
      meta: memoryMeta(),
      hasAdministrator: async () => false,
      logger: log,
      env: {},
    });
    expect(log.warn).toHaveBeenCalledTimes(1);
    expect(
      String(log.warn.mock.calls[0][0]).startsWith(`${SETUP_TOKEN_LOG_PREFIX} `)
    ).toBe(true);
  });

  it("says a weak variable keeps setup closed, without echoing it", async () => {
    const log = logger();
    await issueSetupTokenAtBoot({
      meta: memoryMeta(),
      hasAdministrator: async () => false,
      logger: log,
      env: { [SETUP_TOKEN_ENV]: "weak-value" },
    });
    const message = String(log.warn.mock.calls[0][0]);
    expect(message).toMatch(/too weak/);
    expect(message).not.toContain("weak-value");
  });

  it("points at the earlier line, and the command, when a token was already issued", async () => {
    const meta = memoryMeta();
    await issueSetupTokenAtBoot({
      meta,
      hasAdministrator: async () => false,
      logger: logger(),
      env: {},
    });
    const log = logger();
    await issueSetupTokenAtBoot({
      meta,
      hasAdministrator: async () => false,
      logger: log,
      env: {},
    });
    expect(log.warn).not.toHaveBeenCalled();
    expect(String(log.info.mock.calls[0][0])).toMatch(/nextly setup-token/);
  });

  it("never throws, and says setup stays closed, when the token's row cannot be reached", async () => {
    const log = logger();
    const broken = {
      ...memoryMeta(),
      getEntry: async () => {
        throw new Error("db down");
      },
    };
    await expect(
      issueSetupTokenAtBoot({
        meta: broken,
        hasAdministrator: async () => false,
        logger: log,
        env: {},
      })
    ).resolves.toBeUndefined();
    expect(String(log.warn.mock.calls[0][0])).toMatch(/stays closed/);
  });

  it("says nothing once the install has an administrator", async () => {
    const log = logger();
    await issueSetupTokenAtBoot({
      meta: memoryMeta(),
      hasAdministrator: async () => true,
      logger: log,
      env: {},
    });
    expect(log.warn).not.toHaveBeenCalled();
    expect(log.info).not.toHaveBeenCalled();
  });
});
