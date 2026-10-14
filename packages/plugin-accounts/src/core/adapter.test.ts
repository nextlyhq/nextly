import { NextlyError } from "@nextlyhq/plugin-sdk";
import { describe, expect, it } from "vitest";

import { fakeAccountsCore } from "../testing";

import { assertLimitsShared, coreOnContext, readAccountsCore } from "./adapter";

/** The refusal's code and the members it names, or undefined when read. */
function refusalOf(
  context: object
): { code: string; missing: string[] } | undefined {
  try {
    readAccountsCore(context);
  } catch (error) {
    if (!NextlyError.is(error)) throw error;
    const missing =
      (error.logContext as { missing?: string[] } | undefined)?.missing ?? [];
    return { code: String(error.code), missing };
  }
  return undefined;
}

/** A context carrying a complete core, with one helper's members changed. */
function contextWith(
  helper: "passwords" | "secrets" | "opaque" | "limits",
  change: object
): object {
  const core = fakeAccountsCore();
  const changed = Object.assign(Object.create(core[helper]) as object, change);
  return coreOnContext({ ...core, [helper]: changed });
}

describe("readAccountsCore", () => {
  it("reads the very helpers core hangs on the context", () => {
    const core = fakeAccountsCore();
    const read = readAccountsCore(core.context);

    expect(read.passwords).toBe(core.passwords);
    expect(read.secrets).toBe(core.secrets);
    expect(read.opaque).toBe(core.opaque);
    expect(read.limits).toBe(core.limits);
  });

  it("refuses a core that lends none of them, naming each", () => {
    expect(refusalOf({})).toEqual({
      code: "ACCOUNTS_CORE_MISSING",
      missing: [
        "security.passwords",
        "security.secrets",
        "security.opaque",
        "limits",
      ],
    });
  });

  it("refuses a helper missing one method, naming that method alone", () => {
    expect(
      refusalOf(contextWith("secrets", { consumeCode: undefined }))
    ).toEqual({
      code: "ACCOUNTS_CORE_MISSING",
      missing: ["security.secrets.consumeCode"],
    });
  });

  it("refuses a password helper with no ceiling, and a limiter with no store", () => {
    expect(
      refusalOf(contextWith("passwords", { ceiling: undefined }))?.missing
    ).toEqual(["security.passwords.ceiling"]);
    expect(
      refusalOf(contextWith("limits", { store: { shared: true } }))?.missing
    ).toEqual(["limits.store"]);
  });
});

describe("assertLimitsShared", () => {
  const store = (shared: boolean, singleInstance: boolean) => ({
    store: { shared, singleInstance },
  });

  it("refuses production on a store one instance keeps alone", () => {
    expect(() => assertLimitsShared(store(false, false), true)).toThrow(
      expect.objectContaining({ code: "ACCOUNTS_LIMITS_NOT_SHARED" })
    );
  });

  it("starts on a shared store, a declared single instance, or outside production", () => {
    expect(() => assertLimitsShared(store(true, false), true)).not.toThrow();
    expect(() => assertLimitsShared(store(false, true), true)).not.toThrow();
    expect(() => assertLimitsShared(store(false, false), false)).not.toThrow();
  });
});
