/**
 * The setup token's lifecycle: who prints it, how long it lasts, what replaces
 * it, and what opens setup. Driven through an in-memory stand-in for the one
 * `nextly_meta` row, which compares stored values as `MetaService` does: by
 * their JSON, so a write expecting an older value loses.
 */
import { describe, expect, it } from "vitest";

import {
  SETUP_TOKEN_ENV,
  SETUP_TOKEN_LIFETIME_MS,
  SETUP_TOKEN_LOG_PREFIX,
  SETUP_TOKEN_META_KEY,
  SETUP_TOKEN_PRINT_GRACE_MS,
  cachedRecordReader,
  ensureSetupTokenAtBoot,
  generateSetupToken,
  operatorSetupToken,
  readSetupTokenRecord,
  replaceSetupToken,
  setupTokenDigest,
  verifySetupToken,
  type SetupTokenMeta,
} from "../setup-token";

function memoryMeta(): SetupTokenMeta & { rows: Map<string, string> } {
  const rows = new Map<string, string>();
  return {
    rows,
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

const NO_ADMIN = async () => false;
const T0 = Date.UTC(2026, 9, 18, 9, 0, 0);
const at = (ms: number) => () => ms;

/** The token a printed line carries. */
function tokenIn(line: string): string {
  const match = new RegExp(`^\\${SETUP_TOKEN_LOG_PREFIX} (\\S+) `).exec(line);
  if (!match) throw new Error(`no token in: ${line}`);
  return match[1];
}

async function accepted(
  meta: SetupTokenMeta,
  token: string,
  env: Record<string, string | undefined> = {},
  now = T0
) {
  return verifySetupToken({
    presented: token,
    readRecord: () => readSetupTokenRecord(meta),
    env,
    now: at(now),
  });
}

describe("the operator's token", () => {
  it.each([
    [undefined, "absent"],
    ["", "weak"],
    ["a".repeat(42), "weak"],
    ["a".repeat(43), "weak"],
  ])("reads %j as %s", (value, kind) => {
    expect(operatorSetupToken({ [SETUP_TOKEN_ENV]: value }).kind).toBe(kind);
  });

  it("accepts a generated value, and a generated value is 43 characters", () => {
    const value = generateSetupToken();
    expect(value).toHaveLength(43);
    expect(operatorSetupToken({ [SETUP_TOKEN_ENV]: value })).toEqual({
      kind: "set",
      value,
    });
  });
});

describe("a production start", () => {
  it("prints one token, after storing only its digest, with the prefix and the setup address", async () => {
    const meta = memoryMeta();
    const outcome = await ensureSetupTokenAtBoot({
      meta,
      hasAdministrator: NO_ADMIN,
      env: { VERCEL_PROJECT_PRODUCTION_URL: "cms.example.com" },
      now: at(T0),
    });
    expect(outcome.kind).toBe("printed");
    const line = outcome.kind === "printed" ? outcome.line : "";
    expect(line.startsWith(SETUP_TOKEN_LOG_PREFIX)).toBe(true);
    expect(line).toContain("https://cms.example.com/admin/setup");
    const token = tokenIn(line);
    const stored = meta.rows.get(SETUP_TOKEN_META_KEY) ?? "";
    expect(stored).not.toContain(token);
    expect(JSON.parse(stored).digest).toBe(setupTokenDigest(token));
    expect(await accepted(meta, token)).toBe("valid");
  });

  it("prints nothing new on a later start while the token is valid", async () => {
    const meta = memoryMeta();
    await ensureSetupTokenAtBoot({
      meta,
      hasAdministrator: NO_ADMIN,
      env: {},
      now: at(T0),
    });
    const again = await ensureSetupTokenAtBoot({
      meta,
      hasAdministrator: NO_ADMIN,
      env: {},
      now: at(T0 + 1000),
    });
    expect(again).toEqual({ kind: "already-issued" });
  });

  it("prints exactly one token when two instances start at once", async () => {
    const meta = memoryMeta();
    const outcomes = await Promise.all(
      [1, 2].map(() =>
        ensureSetupTokenAtBoot({
          meta,
          hasAdministrator: NO_ADMIN,
          env: {},
          now: at(T0),
        })
      )
    );
    const printed = outcomes.filter(o => o.kind === "printed");
    expect(printed).toHaveLength(1);
    const token = tokenIn(printed[0].kind === "printed" ? printed[0].line : "");
    expect(await accepted(meta, token)).toBe("valid");
  });

  it("refuses a token once it is 24 hours old, and the next start replaces it", async () => {
    const meta = memoryMeta();
    const first = await ensureSetupTokenAtBoot({
      meta,
      hasAdministrator: NO_ADMIN,
      env: {},
      now: at(T0),
    });
    const old = tokenIn(first.kind === "printed" ? first.line : "");
    const later = T0 + SETUP_TOKEN_LIFETIME_MS;
    expect(await accepted(meta, old, {}, later)).toBe("invalid");

    const next = await ensureSetupTokenAtBoot({
      meta,
      hasAdministrator: NO_ADMIN,
      env: {},
      now: at(later),
    });
    expect(next.kind).toBe("printed");
    const fresh = tokenIn(next.kind === "printed" ? next.line : "");
    expect(await accepted(meta, fresh, {}, later)).toBe("valid");
    expect(await accepted(meta, old, {}, later)).toBe("invalid");
  });

  it("discards the token once an administrator exists", async () => {
    const meta = memoryMeta();
    await ensureSetupTokenAtBoot({
      meta,
      hasAdministrator: NO_ADMIN,
      env: {},
      now: at(T0),
    });
    const outcome = await ensureSetupTokenAtBoot({
      meta,
      hasAdministrator: async () => true,
      env: {},
      now: at(T0),
    });
    expect(outcome).toEqual({ kind: "administrator-exists" });
    expect(meta.rows.has(SETUP_TOKEN_META_KEY)).toBe(false);
  });

  it("never revives a printed token after the operator's variable was set and removed", async () => {
    const meta = memoryMeta();
    const first = await ensureSetupTokenAtBoot({
      meta,
      hasAdministrator: NO_ADMIN,
      env: {},
      now: at(T0),
    });
    const a = tokenIn(first.kind === "printed" ? first.line : "");
    const operator = { [SETUP_TOKEN_ENV]: generateSetupToken() };

    await ensureSetupTokenAtBoot({
      meta,
      hasAdministrator: NO_ADMIN,
      env: operator,
      now: at(T0),
    });
    expect(await accepted(meta, a, operator)).toBe("invalid");

    const unset = await ensureSetupTokenAtBoot({
      meta,
      hasAdministrator: NO_ADMIN,
      env: {},
      now: at(T0),
    });
    expect(await accepted(meta, a)).toBe("invalid");
    expect(unset.kind).toBe("printed");
  });

  it("keeps setup closed, printing no token, while the operator's variable is weak", async () => {
    const meta = memoryMeta();
    const weak = { [SETUP_TOKEN_ENV]: "short" };
    const outcome = await ensureSetupTokenAtBoot({
      meta,
      hasAdministrator: NO_ADMIN,
      env: weak,
      now: at(T0),
    });
    expect(outcome).toEqual({ kind: "operator-token-weak" });
    expect(await accepted(meta, "short", weak)).toBe("closed");
  });
});

describe("the replacement command", () => {
  it("prints a new token that setup accepts, and the previous one stops working", async () => {
    const meta = memoryMeta();
    const first = await ensureSetupTokenAtBoot({
      meta,
      hasAdministrator: NO_ADMIN,
      env: {},
      now: at(T0),
    });
    const old = tokenIn(first.kind === "printed" ? first.line : "");
    const outcome = await replaceSetupToken({
      meta,
      env: {},
      now: at(T0 + 60_000),
    });
    expect(outcome.kind).toBe("printed");
    const fresh = tokenIn(outcome.kind === "printed" ? outcome.line : "");
    expect(await accepted(meta, fresh)).toBe("valid");
    expect(await accepted(meta, old)).toBe("invalid");
  });

  it("refuses, and changes nothing, while the operator's variable sets the token", async () => {
    const meta = memoryMeta();
    const operator = { [SETUP_TOKEN_ENV]: generateSetupToken() };
    expect(
      await replaceSetupToken({ meta, env: operator, now: at(T0) })
    ).toEqual({
      kind: "operator-token",
    });
    expect(meta.rows.size).toBe(0);
    expect(await accepted(meta, operator[SETUP_TOKEN_ENV], operator)).toBe(
      "valid"
    );
  });

  it("waits for a start that has stored but not printed, so the token printed last is the valid one", async () => {
    const meta = memoryMeta();
    // A start that stored its token and has not yet marked it printed.
    const pending = {
      digest: setupTokenDigest("from-start"),
      createdAt: T0,
      printed: false,
    };
    await meta.insertIfAbsent(SETUP_TOKEN_META_KEY, pending);
    let printedByStart = false;
    const outcome = await replaceSetupToken({
      meta,
      env: {},
      now: at(T0 + 1000),
      // While the command waits, the start marks its token printed.
      wait: async () => {
        await meta.compareAndSet(SETUP_TOKEN_META_KEY, pending, {
          ...pending,
          printed: true,
        });
        printedByStart = true;
      },
    });
    expect(printedByStart).toBe(true);
    const fresh = tokenIn(outcome.kind === "printed" ? outcome.line : "");
    expect(await accepted(meta, fresh)).toBe("valid");
    expect(await accepted(meta, "from-start")).toBe("invalid");
  });

  it("recovers a token stored but never printed, without waiting for it to expire", async () => {
    const meta = memoryMeta();
    await meta.insertIfAbsent(SETUP_TOKEN_META_KEY, {
      digest: setupTokenDigest("lost"),
      createdAt: T0,
      printed: false,
    });
    let waited = false;
    const outcome = await replaceSetupToken({
      meta,
      env: {},
      now: at(T0 + SETUP_TOKEN_PRINT_GRACE_MS),
      wait: async () => {
        waited = true;
      },
    });
    expect(waited).toBe(false);
    const fresh = tokenIn(outcome.kind === "printed" ? outcome.line : "");
    expect(await accepted(meta, fresh)).toBe("valid");
  });

  it("makes a start that loses the race print nothing", async () => {
    const meta = memoryMeta();
    // The start stores its record, then the command replaces it before the
    // start marks it printed: the start's mark loses, so it prints nothing.
    const realCas = meta.compareAndSet.bind(meta);
    let replaced = false;
    meta.compareAndSet = async (key, expected, next) => {
      const exp = expected as { printed?: boolean };
      const nxt = next as { printed?: boolean };
      if (!replaced && exp.printed === false && nxt.printed === true) {
        replaced = true;
        const current = JSON.parse(meta.rows.get(key) ?? "null");
        await realCas(key, current, {
          digest: setupTokenDigest("from-command"),
          createdAt: T0,
          printed: true,
        });
      }
      return realCas(key, expected, next);
    };
    const outcome = await ensureSetupTokenAtBoot({
      meta,
      hasAdministrator: NO_ADMIN,
      env: {},
      now: at(T0),
    });
    expect(outcome).toEqual({ kind: "already-issued" });
    expect(await accepted(meta, "from-command")).toBe("valid");
  });
});

describe("judging a presented token", () => {
  it("answers wrong, missing and non-string tokens alike", async () => {
    const meta = memoryMeta();
    await ensureSetupTokenAtBoot({
      meta,
      hasAdministrator: NO_ADMIN,
      env: {},
      now: at(T0),
    });
    for (const presented of ["wrong", "", undefined, 42]) {
      expect(
        await verifySetupToken({
          presented,
          readRecord: () => readSetupTokenRecord(meta),
          env: {},
          now: at(T0),
        })
      ).toBe("invalid");
    }
  });

  it("checks the operator's token, not a stored one, while the variable is set", async () => {
    const meta = memoryMeta();
    const value = generateSetupToken();
    const env = { [SETUP_TOKEN_ENV]: value };
    expect(await accepted(meta, value, env)).toBe("valid");
    expect(await accepted(meta, `${value}x`, env)).toBe("invalid");
  });

  it("makes one read for a burst of callers arriving while the cache is empty", async () => {
    const meta = memoryMeta();
    let reads = 0;
    const getEntry = meta.getEntry.bind(meta);
    meta.getEntry = key => {
      reads += 1;
      return getEntry(key);
    };
    const read = cachedRecordReader(meta, 1000, () => T0);
    await Promise.all(Array.from({ length: 20 }, () => read()));
    expect(reads).toBe(1);
  });

  it("sees a replacement within a second through the cached reader", async () => {
    const meta = memoryMeta();
    let clock = T0;
    const read = cachedRecordReader(meta, 1000, () => clock);
    const first = await ensureSetupTokenAtBoot({
      meta,
      hasAdministrator: NO_ADMIN,
      env: {},
      now: at(T0),
    });
    const old = tokenIn(first.kind === "printed" ? first.line : "");
    const judge = (token: string) =>
      verifySetupToken({
        presented: token,
        readRecord: read,
        env: {},
        now: () => clock,
      });
    expect(await judge(old)).toBe("valid");

    await replaceSetupToken({ meta, env: {}, now: at(T0 + 100) });
    clock = T0 + 1000;
    expect(await judge(old)).toBe("invalid");
  });
});
