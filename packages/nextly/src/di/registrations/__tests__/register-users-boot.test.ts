/**
 * The registration refuses a digester that declares no reach contract at
 * BOOT, not at first use: the assert lives in `registerUserServices`
 * itself, so a refactor that drops or moves it fails here rather than at an
 * app's first password.
 */
import { describe, expect, it } from "vitest";

import { registerUserServices } from "../register-users";
import type { RegistrationContext } from "../types";

function contextWith(passwordHasher: unknown): RegistrationContext {
  return {
    adapter: {},
    adapterDrizzleDb: {},
    logger: { error() {}, info() {}, debug() {}, warn() {} },
    config: {},
    basePath: "",
    storage: null,
    mediaStorage: {},
    imageProcessor: {},
    passwordHasher,
  } as unknown as RegistrationContext;
}

describe("registerUserServices and the digester's reach contract", () => {
  it("refuses to register a digester that declares no reach contract", () => {
    expect(() =>
      registerUserServices(
        contextWith({
          hash: async () => "",
          verify: async () => true,
        })
      )
    ).toThrowError(/must declare its reach contract/);
  });

  it("registers when the declared contract is sound, and publishes the configured minimum", () => {
    expect(() =>
      registerUserServices(
        contextWith({
          hash: async () => "",
          verify: async () => true,
          reach: 72,
        })
      )
    ).not.toThrow();
  });
});
