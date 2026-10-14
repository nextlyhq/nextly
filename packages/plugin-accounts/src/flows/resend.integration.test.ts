/**
 * Resending the verification email on each dialect: the same answer for an
 * address with no account, an unverified one and a verified one, an email
 * only for the unverified one, and the address's and the client's limits.
 *
 * @module flows/resend.integration.test
 */
import {
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
import { afterEach, describe, expect, it } from "vitest";

import type { AccountsOptions } from "../settings";
import { accountByAddress, writeAtVersion } from "../storage/accounts";
import { knownBrowserOf, makeAccount } from "../test-support/accounts";
import { bootAccounts } from "../test-support/boot";
import { flowDeps } from "../test-support/flow-deps";
import { commitBeforeFirstTransaction } from "../test-support/race";

import { resendVerification } from "./resend";
import { signUp } from "./sign-up";
import { verifyByCode } from "./verify";

const client = "203.0.113.9";

describe.each(getConfiguredTestDialects())(
  "resending the verification email (%s)",
  (dialect: TestDialect) => {
    let current: TestNextly | undefined;

    afterEach(async () => {
      await current?.destroy();
      current = undefined;
    });

    async function boot(options: Partial<AccountsOptions> = {}) {
      const booted = await bootAccounts(dialect);
      current = booted.nextly;
      return { ctx: booted.ctx, ...flowDeps(booted.ctx, options) };
    }

    async function signUpAs(
      deps: Parameters<typeof signUp>[0],
      address: string
    ) {
      const answer = await signUp(deps, {
        name: "A",
        address,
        password: "a long passphrase",
        client: null,
      });
      if (answer.status !== "accepted")
        throw new Error("expected the sign-up to be accepted");
      return answer;
    }

    it("answers alike for no account, an unverified one and a verified one, emailing only the unverified", async () => {
      const { ctx, deps, mail } = await boot();
      await signUpAs(deps, "pending@example.com");
      await signUpAs(deps, "done@example.com");
      const done = await accountByAddress(ctx.db, "done@example.com");
      if (done === null) throw new Error("expected the account");
      await writeAtVersion(ctx.db, done, {
        verifiedAt: new Date(),
        verifiedBy: "link",
      });
      mail.queued.length = 0;

      const answers = await Promise.all(
        ["nobody@example.com", "PENDING@example.com", "done@example.com"].map(
          address => resendVerification(deps, { address, client })
        )
      );
      expect(answers).toEqual([
        { status: "accepted" },
        { status: "accepted" },
        { status: "accepted" },
      ]);
      expect(mail.queued.map(email => [email.kind, email.to])).toEqual([
        ["verify-address", "pending@example.com"],
      ]);
    });

    it("sends nothing once the address's verification commits after the account was read", async () => {
      const { ctx, deps, mail } = await boot();
      await signUpAs(deps, "pending@example.com");
      mail.queued.length = 0;
      const raced = {
        ...deps,
        db: commitBeforeFirstTransaction(deps.db, async () => {
          const pending = await accountByAddress(ctx.db, "pending@example.com");
          if (pending !== null)
            await writeAtVersion(ctx.db, pending, {
              verifiedAt: new Date(),
              verifiedBy: "link",
            });
        }),
      };

      expect(
        await resendVerification(raced, {
          address: "pending@example.com",
          client,
        })
      ).toEqual({ status: "accepted" });
      expect(mail.queued).toEqual([]);
    });

    it("sends a fresh code that voids the earlier one, in the browser that signed up", async () => {
      const { deps, mail } = await boot();
      const { browserToken } = await signUpAs(deps, "pending@example.com");
      await resendVerification(deps, {
        address: "pending@example.com",
        client,
      });
      const [first, fresh] = mail.ofKind("verify-address");
      if (first === undefined || fresh === undefined)
        throw new Error("expected two emails");

      if (first.code !== fresh.code) {
        expect(
          await verifyByCode(deps, {
            address: "pending@example.com",
            code: first.code,
            browserToken,
          })
        ).toMatchObject({ status: "refused" });
      }
      expect(
        await verifyByCode(deps, {
          address: "pending@example.com",
          code: fresh.code,
          browserToken,
        })
      ).toMatchObject({ status: "verified" });
    });

    it("refuses a fourth resend for one address in 15 minutes, whether or not it has an account", async () => {
      const { deps } = await boot();
      for (const address of ["nobody@example.com", "pending@example.com"]) {
        if (address === "pending@example.com") await signUpAs(deps, address);
        for (let n = 0; n < 3; n += 1) {
          expect(
            await resendVerification(deps, { address, client: null })
          ).toEqual({ status: "accepted" });
        }
        expect(
          await resendVerification(deps, {
            address: address.toUpperCase(),
            client: null,
          })
        ).toMatchObject({
          status: "refused",
          reason: "too-many-requests",
        });
      }
    });

    it("sends a verified account's own known browser the same answer and no email", async () => {
      const { deps, mail } = await boot();
      await makeAccount(deps, "done@example.com");
      const owner = await knownBrowserOf(deps, "done@example.com");

      expect(
        await resendVerification(deps, {
          address: "done@example.com",
          client,
          knownTokens: [owner],
        })
      ).toEqual({
        status: "accepted",
      });
      expect(mail.queued).toEqual([]);
    });

    it("counts resends and sign-ups together against the client", async () => {
      const { deps } = await boot();
      for (let n = 0; n < 10; n += 1) {
        expect(
          await signUp(deps, {
            name: "A",
            address: `v${n}@example.com`,
            password: "a long passphrase",
            client,
          })
        ).toMatchObject({ status: "accepted" });
        expect(
          await resendVerification(deps, {
            address: `v${n}@example.com`,
            client,
          })
        ).toEqual({
          status: "accepted",
        });
      }

      expect(
        await resendVerification(deps, { address: "other@example.com", client })
      ).toMatchObject({
        status: "refused",
        reason: "too-many-requests",
      });
    });
  }
);
