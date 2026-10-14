/**
 * The holder changing their address, on each dialect.
 *
 * @module flows/address-change.integration.test
 */
import {
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
import { afterEach, describe, expect, it } from "vitest";

import { pendingAddressChanges } from "../schema/tables";
import { accountById, writeAtVersion } from "../storage/accounts";
import { sweepPendingChanges } from "../storage/pending-changes";
import { makeAccount, TEST_PASSWORD } from "../test-support/accounts";
import { bootAccounts } from "../test-support/boot";
import { flowDeps } from "../test-support/flow-deps";

import {
  cancelAddressChange,
  confirmAddressChangeByCode,
  confirmAddressChangeByLink,
  requestAddressChange,
} from "./address-change";
import { completePasswordReset } from "./reset";
import { requestPasswordReset } from "./reset-request";
import { sessionAccount } from "./sessions";
import { signIn } from "./sign-in";

const DAY = 24 * 60 * 60 * 1000;

function tokenOf(link: string | undefined): string {
  const token =
    link === undefined ? null : new URL(link).searchParams.get("token");
  if (token === null) throw new Error("expected a link with a token");
  return token;
}

describe.each(getConfiguredTestDialects())(
  "changing the address (%s)",
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
      const id = await makeAccount(made.deps, "dana@example.com");
      const browser = async () => {
        const result = await signIn(made.deps, {
          address: "dana@example.com",
          password: TEST_PASSWORD,
          client: null,
        });
        if (result.status !== "signed-in")
          throw new Error("expected a sign-in");
        return result.session.token;
      };
      const ask = (
        sessionToken: string,
        newAddress: string,
        currentPassword = TEST_PASSWORD
      ) =>
        requestAddressChange(made.deps, {
          sessionToken,
          currentPassword,
          newAddress,
          client: null,
        });
      const address = async () =>
        (await accountById(booted.ctx.db, id))?.address;
      return { db: booted.ctx.db, ...made, id, browser, ask, address };
    }

    it("asks alike for a free and a taken new address, telling the old address with a link to cancel", async () => {
      const { db, deps, mail, browser, ask, address } = await boot();
      await makeAccount(deps, "lee@example.com");
      const session = await browser();

      expect(await ask(session, "new@example.com")).toEqual({
        status: "accepted",
      });
      expect(await ask(session, "LEE@example.com")).toEqual({
        status: "accepted",
      });
      expect(
        mail
          .ofKind("address-change-asked")
          .map(email => [email.to, email.newAddress])
      ).toEqual([
        ["dana@example.com", "new@example.com"],
        ["dana@example.com", "LEE@example.com"],
      ]);
      expect(mail.ofKind("confirm-new-address").map(email => email.to)).toEqual(
        ["new@example.com"]
      );
      expect(mail.ofKind("address-in-use").map(email => email.to)).toEqual([
        "lee@example.com",
      ]);
      expect(
        (await db.select(pendingAddressChanges).all()).map(
          row => row.newAddressNormalised
        )
      ).toEqual(["lee@example.com"]);
      expect(await address()).toBe("dana@example.com");
    });

    it("changes the address by its link inside the session, ending the other sessions and telling the old address", async () => {
      const { deps, mail, browser, ask, address } = await boot();
      const here = await browser();
      const elsewhere = await browser();
      await ask(here, "new@example.com");
      const link = tokenOf(mail.ofKind("confirm-new-address")[0]?.link);

      expect(
        await confirmAddressChangeByLink(deps, {
          sessionToken: elsewhere,
          token: "x",
        })
      ).toMatchObject({
        status: "refused",
      });
      expect(
        await confirmAddressChangeByLink(deps, {
          sessionToken: here,
          token: link,
        })
      ).toEqual({ status: "changed" });
      expect(await address()).toBe("new@example.com");
      expect(await sessionAccount(deps, { sessionToken: here })).not.toBeNull();
      expect(
        await sessionAccount(deps, { sessionToken: elsewhere })
      ).toBeNull();
      expect(
        mail
          .ofKind("address-changed")
          .map(email => [email.to, email.newAddress])
      ).toEqual([["dana@example.com", "new@example.com"]]);
      expect(
        (
          await signIn(deps, {
            address: "new@example.com",
            password: TEST_PASSWORD,
            client: null,
          })
        ).status
      ).toBe("signed-in");
    });

    it("asks for a session of the account that asked, and changes nothing without one", async () => {
      const { deps, mail, browser, ask, address } = await boot();
      await makeAccount(deps, "lee@example.com");
      await ask(await browser(), "new@example.com");
      const link = tokenOf(mail.ofKind("confirm-new-address")[0]?.link);
      const lee = await signIn(deps, {
        address: "lee@example.com",
        password: TEST_PASSWORD,
        client: null,
      });
      if (lee.status !== "signed-in") throw new Error("expected a sign-in");

      expect(
        await confirmAddressChangeByLink(deps, {
          sessionToken: "no-session",
          token: link,
        })
      ).toEqual({
        status: "sign-in-needed",
      });
      expect(
        await confirmAddressChangeByLink(deps, {
          sessionToken: lee.session.token,
          token: link,
        })
      ).toEqual({
        status: "sign-in-needed",
      });
      expect(await address()).toBe("dana@example.com");
    });

    it("changes the address by its code, counting a wrong one", async () => {
      const { deps, mail, browser, ask, address } = await boot();
      const session = await browser();
      await ask(session, "new@example.com");
      const code = mail.ofKind("confirm-new-address")[0]?.code ?? "";
      const wrong = code === "000000" ? "000001" : "000000";

      expect(
        await confirmAddressChangeByCode(deps, {
          sessionToken: session,
          code: wrong,
        })
      ).toMatchObject({
        reason: "wrong-code",
      });
      expect(
        await confirmAddressChangeByCode(deps, { sessionToken: session, code })
      ).toEqual({ status: "changed" });
      expect(await address()).toBe("new@example.com");
    });

    it("lets the old address cancel the change, after which the link changes nothing", async () => {
      const { db, deps, mail, browser, ask, address } = await boot();
      const session = await browser();
      await ask(session, "new@example.com");
      const link = tokenOf(mail.ofKind("confirm-new-address")[0]?.link);
      const cancel = tokenOf(
        mail.ofKind("address-change-asked")[0]?.cancelLink
      );

      expect(await cancelAddressChange(deps, { token: cancel })).toEqual({
        status: "cancelled",
      });
      expect(await db.select(pendingAddressChanges).all()).toEqual([]);
      expect(
        await confirmAddressChangeByLink(deps, {
          sessionToken: session,
          token: link,
        })
      ).toMatchObject({
        status: "refused",
      });
      expect(await address()).toBe("dana@example.com");
    });

    it("lets one of a confirmation and a cancellation at once win, never both", async () => {
      const { deps, mail, browser, ask, address } = await boot();
      const session = await browser();
      await ask(session, "new@example.com");
      const link = tokenOf(mail.ofKind("confirm-new-address")[0]?.link);
      const cancel = tokenOf(
        mail.ofKind("address-change-asked")[0]?.cancelLink
      );

      const [confirmed, cancelled] = await Promise.all([
        confirmAddressChangeByLink(deps, {
          sessionToken: session,
          token: link,
        }),
        cancelAddressChange(deps, { token: cancel }),
      ]);
      expect(
        [
          confirmed.status === "changed",
          cancelled.status === "cancelled",
        ].filter(Boolean)
      ).toHaveLength(1);
      expect(await address()).toBe(
        confirmed.status === "changed" ? "new@example.com" : "dana@example.com"
      );
    });

    it("refuses a new address another account has taken since, keeping the old one", async () => {
      const { deps, mail, browser, ask, address } = await boot();
      const session = await browser();
      await ask(session, "new@example.com");
      const link = tokenOf(mail.ofKind("confirm-new-address")[0]?.link);
      await makeAccount(deps, "NEW@example.com");

      expect(
        await confirmAddressChangeByLink(deps, {
          sessionToken: session,
          token: link,
        })
      ).toEqual({
        status: "refused",
        reason: "taken",
      });
      expect(await address()).toBe("dana@example.com");
    });

    it("lets a change expire, and the sweep remove it", async () => {
      const { db, deps, core, mail, browser, ask, address } = await boot();
      const session = await browser();
      await ask(session, "new@example.com");
      const link = tokenOf(mail.ofKind("confirm-new-address")[0]?.link);
      core.clock.advance(DAY);

      expect(
        await confirmAddressChangeByLink(deps, {
          sessionToken: session,
          token: link,
        })
      ).toMatchObject({
        status: "refused",
      });
      expect(await address()).toBe("dana@example.com");
      expect(await sweepPendingChanges(db, deps.now())).toBe(1);
    });

    it("never applies a confirmation that commits past the change's expiry", async () => {
      const { deps, mail, browser, ask, address } = await boot();
      const session = await browser();
      await ask(session, "new@example.com");
      const link = tokenOf(mail.ofKind("confirm-new-address")[0]?.link);
      // The confirmation's checks pass now; by its commit, the change has expired.
      let calls = 0;
      const late = {
        ...deps,
        now: () => new Date(deps.now().getTime() + (calls++ === 0 ? 0 : DAY)),
      };

      expect(
        await confirmAddressChangeByLink(late, {
          sessionToken: session,
          token: link,
        })
      ).toEqual({
        status: "refused",
        reason: "expired",
      });
      expect(await address()).toBe("dana@example.com");
    });

    it("is cancelled by a reset completed since it was asked for", async () => {
      const { deps, mail, browser, ask, address } = await boot();
      const session = await browser();
      await ask(session, "new@example.com");
      const link = tokenOf(mail.ofKind("confirm-new-address")[0]?.link);
      await requestPasswordReset(deps, {
        address: "dana@example.com",
        client: null,
      });
      await completePasswordReset(deps, {
        token: tokenOf(mail.ofKind("reset-password")[0]?.link),
        password: "a brand new passphrase",
      });

      expect(
        await confirmAddressChangeByLink(deps, {
          sessionToken: session,
          token: link,
        })
      ).not.toEqual({
        status: "changed",
      });
      expect(await address()).toBe("dana@example.com");
    });

    it("asks for nothing once a change that ended the session commits after the password was proven", async () => {
      const { db, deps, mail, id, browser } = await boot();
      const session = await browser();
      // A password change commits between the proven password and the
      // request's own counts: the version moves and the session ends.
      const raced = {
        ...deps,
        core: {
          ...deps.core,
          limits: new Proxy(deps.core.limits, {
            get(target, key) {
              const member = Reflect.get(target, key) as unknown;
              if (key !== "reserve")
                return typeof member === "function"
                  ? (member as (...args: unknown[]) => unknown).bind(target)
                  : member;
              return async (entries: Parameters<typeof target.reserve>[0]) => {
                if (entries.some(e => e.rule === "address-change-account")) {
                  const fresh = await accountById(db, id);
                  if (fresh !== null)
                    await writeAtVersion(db, fresh, {}, { endsSessions: true });
                }
                return target.reserve(entries);
              };
            },
          }),
        },
      };

      expect(
        await requestAddressChange(raced, {
          sessionToken: session,
          currentPassword: TEST_PASSWORD,
          newAddress: "new@example.com",
          client: null,
        })
      ).toEqual({ status: "refused", reason: "try-again" });
      expect(await db.select(pendingAddressChanges).all()).toEqual([]);
      expect(mail.ofKind("address-change-asked")).toEqual([]);
      expect(mail.ofKind("confirm-new-address")).toEqual([]);
    });

    it("settles a proven password before refusing the same address, so the holder's browser is never capped", async () => {
      const { deps, browser } = await boot();
      const session = await browser();
      const known = await signIn(deps, {
        address: "dana@example.com",
        password: TEST_PASSWORD,
        client: null,
      });
      if (known.status !== "signed-in") throw new Error("expected a sign-in");
      const knownTokens = [known.knownBrowserToken];
      const ask = (newAddress: string) =>
        requestAddressChange(deps, {
          sessionToken: session,
          currentPassword: TEST_PASSWORD,
          newAddress,
          client: null,
          knownTokens,
        });

      for (let n = 0; n < 12; n += 1)
        expect(await ask(" DANA@example.com ")).toEqual({
          status: "refused",
          reason: "same-address",
        });
      expect(await ask("new@example.com")).toEqual({ status: "accepted" });
    });

    it("counts a wrong current password as a failed sign-in, and asks for nothing more", async () => {
      const { deps, mail, browser, ask } = await boot();
      const session = await browser();

      expect(await ask(session, "new@example.com", "wrong")).toEqual({
        status: "refused",
        reason: "wrong-credentials",
      });
      expect(mail.queued).toEqual([]);
      expect(
        (
          await accountById(
            deps.db,
            (await sessionAccount(deps, { sessionToken: session }))?.id ?? ""
          )
        )?.failuresInARow
      ).toBe(1);
    });

    it("refuses a fourth change in an hour for one account", async () => {
      const { browser, ask } = await boot();
      const session = await browser();
      for (let n = 0; n < 3; n += 1)
        expect(await ask(session, `new${n}@example.com`)).toEqual({
          status: "accepted",
        });

      expect(await ask(session, "new9@example.com")).toMatchObject({
        status: "refused",
        reason: "too-many-requests",
      });
    });
  }
);
