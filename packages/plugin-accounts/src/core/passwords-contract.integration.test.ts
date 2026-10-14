/**
 * Core's password helper, as a booted plugin's context lends it, against the
 * stand-in every other test runs the flows on: the two must answer alike, or
 * the flows' tests prove nothing about a site.
 *
 * @module core/passwords-contract.integration.test
 */
import {
  PasswordTooLongError,
  type PasswordHelper,
  type PasswordRules,
} from "@nextlyhq/plugin-sdk";
import {
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
import { afterEach, describe, expect, it } from "vitest";

import { bootAccounts } from "../test-support/boot";
import { FakePasswordHelper } from "../testing/fake-passwords";

import { readAccountsCore } from "./adapter";

/** New passwords and the rules they are checked under; the breached source is left out, since only a site configures it. */
const CHECKS: ReadonlyArray<[string, PasswordRules]> = [
  ["a long passphrase", {}],
  ["short", {}],
  ["seven77", {}],
  ["eight888", {}],
  ["password", {}],
  ["Password", {}],
  ["a long passphrase", { minLength: 20 }],
  ["x".repeat(128), {}],
  ["x".repeat(129), {}],
  ["x".repeat(200), { maxLength: 256 }],
  ["é".repeat(8), {}],
  ["é".repeat(8), {}],
];

describe.each(getConfiguredTestDialects())(
  "core's password helper and the stand-in (%s)",
  (dialect: TestDialect) => {
    let current: TestNextly | undefined;

    afterEach(async () => {
      await current?.destroy();
      current = undefined;
    });

    /** Core's helper, found where the plugin's adapter looks for it. */
    async function corePasswords(): Promise<PasswordHelper> {
      const booted = await bootAccounts(dialect);
      current = booted.nextly;
      return booted.ctx.security.passwords;
    }

    it("judge every new password alike", async () => {
      const real = await corePasswords();
      const fake = new FakePasswordHelper();

      for (const [password, rules] of CHECKS) {
        expect(await fake.check(password, rules), password).toEqual(
          await real.check(password, rules)
        );
      }
    });

    it("share the ceiling, and refuse past it with core's own error", async () => {
      const real = await corePasswords();
      const fake = new FakePasswordHelper();

      expect(fake.ceiling).toBe(real.ceiling);
      for (const helper of [real, fake]) {
        await expect(
          helper.hash("x".repeat(real.ceiling + 1))
        ).rejects.toBeInstanceOf(PasswordTooLongError);
      }
    });

    it("verify their own hashes alike, and refuse a decoy and a foreign hash", async () => {
      const real = await corePasswords();
      const fake = new FakePasswordHelper();

      for (const helper of [real, fake]) {
        const hash = await helper.hash("a long passphrase");
        expect(hash.length).toBeLessThanOrEqual(255);
        expect(await helper.verify("a long passphrase", hash)).toBe(true);
        expect(await helper.verify("a long passphrasE", hash)).toBe(false);
        expect(await helper.verify("a long passphrase", null)).toBe(false);
        expect(helper.needsRehash(hash)).toBe(false);
        expect(helper.needsRehash("$2b$10$not.one.of.its.own")).toBe(true);
        expect(await helper.verify("x", "$2b$10$not.one.of.its.own")).toBe(
          false
        );
      }
    });
  }
);

describe("the adapter on a core that lends only its password helper", () => {
  it("still refuses to start, naming every helper not yet lent", () => {
    const fake = new FakePasswordHelper();
    let missing: unknown;
    try {
      readAccountsCore({ security: { passwords: fake } });
    } catch (error) {
      missing = (error as { logContext?: { missing?: unknown } }).logContext
        ?.missing;
    }
    expect(missing).toEqual(["security.secrets", "security.opaque", "limits"]);
  });
});
