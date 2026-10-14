/**
 * Asking for a password reset on each dialect: one answer whatever the
 * address, a link only for an active account, and the limits per address,
 * per client and per known browser.
 *
 * @module flows/reset-request.integration.test
 */
import {
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
import { afterEach, describe, expect, it } from "vitest";

import { accountById, writeAtVersion } from "../storage/accounts";
import { knownBrowserOf, makeAccount } from "../test-support/accounts";
import { bootAccounts, TEST_ORIGIN } from "../test-support/boot";
import { flowDeps } from "../test-support/flow-deps";
import { commitBeforeFirstTransaction } from "../test-support/race";

import { PURPOSES } from "./purposes";
import { requestPasswordReset } from "./reset-request";

const MINUTE = 60_000;
const ACCEPTED = { status: "accepted" };

describe.each(getConfiguredTestDialects())(
  "asking for a password reset (%s)",
  (dialect: TestDialect) => {
    let current: TestNextly | undefined;

    afterEach(async () => {
      await current?.destroy();
      current = undefined;
    });

    async function boot() {
      const booted = await bootAccounts(dialect);
      current = booted.nextly;
      const made = flowDeps(booted.ctx);
      const ask = (
        address: string,
        extra: { client?: string | null; knownTokens?: string[] } = {}
      ) => requestPasswordReset(made.deps, { address, client: null, ...extra });
      const resetsTo = (address: string) =>
        made.mail.ofKind("reset-password").filter(email => email.to === address)
          .length;
      return { ...made, ask, resetsTo };
    }

    it("answers alike for an active account, a deactivated one and none, and links only the active one", async () => {
      const { deps, core, mail, ask } = await boot();
      const dana = await makeAccount(deps, "dana@example.com");
      await makeAccount(deps, "gone@example.com", { deactivated: true });

      for (const address of [
        "DANA@example.com",
        "gone@example.com",
        "nobody@example.com",
      ]) {
        expect(await ask(address)).toEqual(ACCEPTED);
      }
      const [email] = mail.ofKind("reset-password");
      expect(mail.queued).toHaveLength(1);
      expect(email).toMatchObject({ accountId: dana, to: "dana@example.com" });
      const link = new URL(email?.link ?? "");
      expect(`${link.origin}${link.pathname}`).toBe(
        `${TEST_ORIGIN}/account/reset`
      );
      const token = link.searchParams.get("token") ?? "";
      expect(
        await core.secrets.peekToken({ purpose: PURPOSES.reset, token })
      ).toMatchObject({ ok: true, subject: dana });
      core.clock.advance(60 * MINUTE);
      expect(
        await core.secrets.peekToken({ purpose: PURPOSES.reset, token })
      ).toEqual({ ok: false, reason: "expired" });
    });

    it("mints no link once a deactivation commits after the account was read", async () => {
      const { deps, resetsTo } = await boot();
      const id = await makeAccount(deps, "dana@example.com");
      const raced = {
        ...deps,
        db: commitBeforeFirstTransaction(deps.db, async () => {
          const fresh = await accountById(deps.db, id);
          if (fresh !== null)
            await writeAtVersion(
              deps.db,
              fresh,
              { deactivatedAt: new Date() },
              { endsSessions: true }
            );
        }),
      };

      expect(
        await requestPasswordReset(raced, {
          address: "dana@example.com",
          client: null,
        })
      ).toEqual({ status: "accepted" });
      expect(resetsTo("dana@example.com")).toBe(0);
    });

    it("refuses a fourth request for one address in 15 minutes, whether or not it has an account", async () => {
      const { deps, ask } = await boot();
      await makeAccount(deps, "dana@example.com");
      for (const address of ["dana@example.com", "nobody@example.com"]) {
        for (let n = 0; n < 3; n += 1)
          expect(await ask(address)).toEqual(ACCEPTED);
        expect(await ask(address.toUpperCase())).toMatchObject({
          status: "refused",
          reason: "too-many-requests",
        });
      }
    });

    it("still emails the owner's known browser once strangers have used up the address's day", async () => {
      const { deps, core, ask, resetsTo } = await boot();
      await makeAccount(deps, "dana@example.com");
      const owner = await knownBrowserOf(deps, "dana@example.com");
      for (let n = 0; n < 10; n += 1) {
        await ask("dana@example.com", { client: `198.51.100.${n}` });
        if (n % 3 === 2) core.clock.advance(15 * MINUTE);
      }
      expect(
        await ask("dana@example.com", { client: "198.51.100.99" })
      ).toMatchObject({ reason: "too-many-requests" });
      const before = resetsTo("dana@example.com");

      expect(
        await ask("dana@example.com", {
          client: "192.0.2.1",
          knownTokens: [owner],
        })
      ).toEqual(ACCEPTED);
      expect(resetsTo("dana@example.com")).toBe(before + 1);
    });

    it("holds a known browser's own requests to the same numbers, from any number of clients", async () => {
      const { deps, ask } = await boot();
      await makeAccount(deps, "dana@example.com");
      const owner = await knownBrowserOf(deps, "dana@example.com");
      for (let n = 0; n < 3; n += 1) {
        expect(
          await ask(`any${n}@example.com`, {
            client: `198.51.100.${n}`,
            knownTokens: [owner],
          })
        ).toEqual(ACCEPTED);
      }

      expect(
        await ask("dana@example.com", {
          client: "198.51.100.9",
          knownTokens: [owner],
        })
      ).toMatchObject({
        reason: "too-many-requests",
      });
    });

    it("answers a known browser alike for its own address, another's used-up address and none, emailing only its own", async () => {
      const { deps, ask, resetsTo } = await boot();
      await makeAccount(deps, "dana@example.com");
      await makeAccount(deps, "lee@example.com");
      const danaBrowser = await knownBrowserOf(deps, "dana@example.com");
      for (let n = 0; n < 3; n += 1)
        await ask("lee@example.com", { client: `198.51.100.${n}` });
      const leeEmails = resetsTo("lee@example.com");

      for (const address of [
        "dana@example.com",
        "lee@example.com",
        "nobody@example.com",
      ]) {
        expect(
          await ask(address, {
            client: "192.0.2.1",
            knownTokens: [danaBrowser],
          })
        ).toEqual(ACCEPTED);
      }
      expect(resetsTo("dana@example.com")).toBe(1);
      expect(resetsTo("lee@example.com")).toBe(leeEmails);
    });

    it("counts a request against every token it carries, and refuses once either is at its limit", async () => {
      const { deps, ask } = await boot();
      await makeAccount(deps, "dana@example.com");
      await makeAccount(deps, "lee@example.com");
      const dana = await knownBrowserOf(deps, "dana@example.com");
      const lee = await knownBrowserOf(deps, "lee@example.com");
      for (let n = 0; n < 2; n += 1)
        await ask("x@example.com", {
          client: `198.51.100.${n}`,
          knownTokens: [dana],
        });
      expect(
        await ask("y@example.com", {
          client: "198.51.100.5",
          knownTokens: [dana, lee],
        })
      ).toEqual(ACCEPTED);

      expect(
        await ask("z@example.com", {
          client: "198.51.100.6",
          knownTokens: [lee, dana],
        })
      ).toMatchObject({
        reason: "too-many-requests",
      });
      expect(
        await ask("z@example.com", {
          client: "198.51.100.7",
          knownTokens: [lee],
        })
      ).toEqual(ACCEPTED);
    });

    it("sends a stranger's address no more resets than its own limits allow, whatever tokens the requests carry", async () => {
      const { deps, ask, resetsTo } = await boot();
      await makeAccount(deps, "stranger@example.com");
      const tokens: string[] = [];
      for (let n = 0; n < 5; n += 1) {
        await makeAccount(deps, `self${n}@example.com`);
        tokens.push(await knownBrowserOf(deps, `self${n}@example.com`));
      }
      for (const [n, token] of tokens.entries()) {
        expect(
          await ask("stranger@example.com", {
            client: `198.51.100.${n}`,
            knownTokens: [token],
          })
        ).toEqual(ACCEPTED);
      }

      expect(resetsTo("stranger@example.com")).toBe(3);
    });

    it("sends a deactivated account's own known browser the same answer and no email", async () => {
      const { deps, mail, ask } = await boot();
      const id = await makeAccount(deps, "dana@example.com");
      const owner = await knownBrowserOf(deps, "dana@example.com");
      const account = await accountById(deps.db, id);
      if (account === null) throw new Error("expected the account");
      await writeAtVersion(
        deps.db,
        account,
        { deactivatedAt: new Date() },
        { endsSessions: true }
      );

      expect(await ask("dana@example.com", { knownTokens: [owner] })).toEqual(
        ACCEPTED
      );
      expect(mail.ofKind("reset-password")).toEqual([]);
    });
  }
);
