/**
 * Core's one-purpose secrets, as a booted plugin's context lends them,
 * against the stand-in every other test runs the flows on. One scenario runs
 * on both, and the two must answer it alike, or the flows' tests prove
 * nothing about a site.
 *
 * @module core/secrets-contract.integration.test
 */
import type { OneTimeSecrets, PluginContext } from "@nextlyhq/plugin-sdk";
import {
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
import { afterEach, describe, expect, it } from "vitest";

import { bootAccounts } from "../test-support/boot";
import { fakeAccountsCore } from "../testing";

const HOUR = 60 * 60 * 1000;

/** Ends a transaction with a rollback, as a flow's refusal does. */
class RolledBack extends Error {}

/** An answer with what differs by run left out: the secrets themselves and the times. */
function answer(value: object): object {
  const {
    expiresAt: _expiresAt,
    token: _token,
    ...rest
  } = value as {
    expiresAt?: unknown;
    token?: unknown;
  };
  return rest;
}

/**
 * Every answer the scenario gets, in order: tokens peeked, spent and spent
 * again; another purpose's and an unknown token; a subject's secrets voided;
 * a code's wrong tries running out; a new code voiding the earlier one; and
 * a secret minted in a transaction that rolls back, and in one that commits.
 */
async function transcript(
  secrets: OneTimeSecrets,
  db: PluginContext["db"]
): Promise<unknown[]> {
  const log: unknown[] = [];
  const link = { purpose: "verify-link", subject: "s1", expiresInMs: HOUR };

  const { token } = await secrets.mintToken({
    ...link,
    data: { change: "c1" },
  });
  log.push(answer(await secrets.peekToken({ purpose: "verify-link", token })));
  log.push(
    answer(await secrets.consumeToken({ purpose: "verify-link", token }))
  );
  log.push(
    answer(await secrets.consumeToken({ purpose: "verify-link", token }))
  );
  log.push(answer(await secrets.peekToken({ purpose: "reset", token })));
  log.push(
    answer(await secrets.peekToken({ purpose: "verify-link", token: "nope" }))
  );

  const voided = await secrets.mintToken({ ...link, subject: "s2" });
  log.push(await secrets.voidFor({ subject: "s2" }));
  log.push(
    answer(
      await secrets.peekToken({ purpose: "verify-link", token: voided.token })
    )
  );

  const code = { purpose: "verify-code", subject: "s3", expiresInMs: HOUR };
  const first = await secrets.mintCode({ ...code, maxWrongTries: 2 });
  const wrong = first.code === "000000" ? "000001" : "000000";
  log.push(await secrets.consumeCode({ ...code, code: wrong }));
  log.push(await secrets.consumeCode({ ...code, code: wrong }));
  log.push(await secrets.consumeCode({ ...code, code: first.code }));
  const earlier = await secrets.mintCode({ ...code, maxWrongTries: 5 });
  const later = await secrets.mintCode({ ...code, maxWrongTries: 5 });
  // A new code never repeats the one it replaced, so the earlier code is
  // always a wrong try against the later one.
  log.push(await secrets.consumeCode({ ...code, code: earlier.code }));
  log.push(await secrets.consumeCode({ ...code, code: later.code }));

  let rolledBack = "";
  await db
    .transaction(async tx => {
      rolledBack = (await secrets.mintToken({ ...link, subject: "s4" }, { tx }))
        .token;
      throw new RolledBack();
    })
    .catch((error: unknown) => {
      if (!(error instanceof RolledBack)) throw error;
    });
  log.push(
    answer(
      await secrets.peekToken({ purpose: "verify-link", token: rolledBack })
    )
  );
  const committed = await db.transaction(
    async tx =>
      (await secrets.mintToken({ ...link, subject: "s5" }, { tx })).token
  );
  log.push(
    answer(
      await secrets.peekToken({ purpose: "verify-link", token: committed })
    )
  );

  return log;
}

describe.each(getConfiguredTestDialects())(
  "core's one-purpose secrets and the stand-in (%s)",
  (dialect: TestDialect) => {
    let current: TestNextly | undefined;

    afterEach(async () => {
      await current?.destroy();
      current = undefined;
    });

    it("answer one scenario alike, step by step", async () => {
      const booted = await bootAccounts(dialect);
      current = booted.nextly;
      const fake = fakeAccountsCore();

      const real = await transcript(booted.ctx.security.secrets, booted.ctx.db);
      expect(real).toHaveLength(14);
      expect(await transcript(fake.secrets, fake.watch(booted.ctx.db))).toEqual(
        real
      );
    });
  }
);
