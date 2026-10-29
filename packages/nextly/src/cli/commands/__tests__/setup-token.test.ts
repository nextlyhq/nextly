/**
 * `nextly setup-token`: what it prints and what it changes, driven through
 * its decisions against an in-memory `nextly_meta` row.
 */
import { describe, expect, it } from "vitest";

import {
  SETUP_TOKEN_ENV,
  SETUP_TOKEN_META_KEY,
  ensureSetupTokenAtBoot,
  operatorSetupToken,
  readSetupTokenRecord,
  verifySetupToken,
  type SetupTokenMeta,
} from "../../../auth/setup-token/setup-token";
import { claimFirstSetup } from "../../../auth/setup-token/setup-gate";
import {
  setupTokenCommand,
  type SetupTokenCommandResult,
} from "../setup-token";

/** The lines a run that succeeded prints; a refusal fails the test with its error. */
function printed(result: SetupTokenCommandResult): string[] {
  if (!result.ok) throw result.error;
  return result.lines;
}

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

const token = (line: string) => /TOKEN (\S+) /.exec(line)?.[1] ?? "";
const accepts = (meta: SetupTokenMeta, presented: string, env = {}) =>
  verifySetupToken({
    presented,
    readRecord: () => readSetupTokenRecord(meta),
    env,
  });

describe("nextly setup-token", () => {
  it("prints a new token that setup accepts, and the previous one stops working", async () => {
    const meta = memoryMeta();
    const start = await ensureSetupTokenAtBoot({
      meta,
      hasAdministrator: async () => false,
      env: {},
    });
    const old = token(start.kind === "printed" ? start.line : "");

    const result = await setupTokenCommand({
      generate: false,
      meta,
      hasAdministrator: async () => false,
      env: {},
    });
    expect(result.ok).toBe(true);
    const fresh = token(printed(result)[0]);
    expect(await accepts(meta, fresh)).toBe("valid");
    expect(await accepts(meta, old)).toBe("invalid");
  });

  it("refuses, changing nothing, while the operator's variable sets the token", async () => {
    const meta = memoryMeta();
    const env = {
      [SETUP_TOKEN_ENV]: printed(
        await setupTokenCommand({ generate: true })
      )[0].split("=")[1],
    };
    const result = await setupTokenCommand({
      generate: false,
      meta,
      hasAdministrator: async () => false,
      env,
    });
    expect(result).toMatchObject({
      ok: false,
      error: {
        code: "SETUP_TOKEN_SET_BY_ENV",
        next: expect.stringMatching(/Change the variable where it is set/),
      },
    });
    expect(meta.rows.has(SETUP_TOKEN_META_KEY)).toBe(false);
    expect(await accepts(meta, env[SETUP_TOKEN_ENV], env)).toBe("valid");
  });

  it("refuses, changing nothing, while a setup holds the claim", async () => {
    const meta = memoryMeta();
    const first = await setupTokenCommand({
      generate: false,
      meta,
      hasAdministrator: async () => false,
      env: {},
    });
    const held = await claimFirstSetup(meta);
    expect(held).not.toBeNull();

    const during = await setupTokenCommand({
      generate: false,
      meta,
      hasAdministrator: async () => false,
      env: {},
    });
    expect(during).toMatchObject({
      ok: false,
      error: {
        code: "SETUP_IN_PROGRESS",
        what: expect.stringMatching(/setup is in progress/),
      },
    });
    // The token the setup is using still opens setup.
    expect(await accepts(meta, token(printed(first)[0]))).toBe("valid");
    await held?.release();
  });

  it("refuses once the install has an administrator", async () => {
    const meta = memoryMeta();
    const result = await setupTokenCommand({
      generate: false,
      meta,
      hasAdministrator: async () => true,
      env: {},
    });
    expect(result).toMatchObject({
      ok: false,
      error: { code: "SETUP_ALREADY_COMPLETE" },
    });
    expect(meta.rows.size).toBe(0);
  });

  it("prints, with --generate, a value the variable accepts, touching nothing", async () => {
    const result = await setupTokenCommand({ generate: true });
    const [assignment] = printed(result);
    expect(assignment.startsWith(`${SETUP_TOKEN_ENV}=`)).toBe(true);
    const value = assignment.slice(SETUP_TOKEN_ENV.length + 1);
    expect(operatorSetupToken({ [SETUP_TOKEN_ENV]: value }).kind).toBe("set");
  });
});
