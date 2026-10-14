/**
 * One-purpose secrets (`ctx.security.secrets`), on every dialect.
 *
 * A token or code is spent once, by one database write only one caller can
 * win, on every instance; a code's wrong tries are its own budget, which no
 * rollback gives back and no burst over two instances exceeds; a write joins
 * the plugin's transaction only when the plugin passes it, and is refused
 * when the calling flow has one open and passes none.
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { afterEach, describe, expect, it, vi } from "vitest";

import { NextlyError } from "../../../errors/nextly-error";
import { pluginSettingsSecrets } from "../../../domains/plugins/settings-service";
import { _resetEnvCache, env } from "../../../shared/lib/env";
import {
  bootTwoInstances,
  type TwoInstances,
} from "../../__tests__/helpers/two-instances";
import { definePlugin, type PluginContext } from "../../plugin-context";
import { getConfiguredTestDialects } from "../../test-nextly";
import { createOneTimeSecrets, type OneTimeSecrets } from "../one-time-secrets";

let current: TwoInstances | undefined;

afterEach(async () => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  _resetEnvCache();
  await current?.destroy();
  current = undefined;
});

describe.each(getConfiguredTestDialects())(
  "one-purpose secrets (%s)",
  dialect => {
    /** Boot two plugins; give back their contexts and a second instance's helper for the first. */
    async function boot(): Promise<{
      a: PluginContext;
      b: PluginContext;
      elsewhere: OneTimeSecrets;
      rows: () => Promise<Array<Record<string, unknown>>>;
    }> {
      const captured: Record<string, PluginContext> = {};
      const plugin = (name: string) =>
        definePlugin({
          name,
          version: "1.0.0",
          nextly: ">=0.0.0",
          init(ctx) {
            captured[name] = ctx;
          },
        });
      current = await bootTwoInstances(dialect, {
        plugins: [plugin("@test/secrets-a"), plugin("@test/secrets-b")],
      });
      const second = current.second;
      const a = captured["@test/secrets-a"];
      const b = captured["@test/secrets-b"];
      if (!a || !b) throw new Error("the plugins' init did not run");
      return {
        a,
        b,
        // The same plugin, on a second instance sharing the database.
        elsewhere: createOneTimeSecrets({
          owner: "@test/secrets-a",
          adapter: () => second,
          secrets: () => pluginSettingsSecrets(env),
        }),
        rows: () =>
          (current?.first.adapter as unknown as DrizzleAdapter).select(
            "nextly_one_time_secrets",
            {}
          ),
      };
    }

    const subject = "account-1";

    it("mints a token and spends it once; a read spends nothing", async () => {
      const { a } = await boot();
      const { token } = await a.security.secrets.mintToken({
        purpose: "verify-email",
        subject,
        expiresInMs: 60 * 60_000,
        data: { next: "/account" },
      });
      expect(Buffer.from(token, "base64url").length).toBeGreaterThanOrEqual(32);
      expect(
        await a.security.secrets.peekToken({ purpose: "verify-email", token })
      ).toMatchObject({ ok: true, subject, data: { next: "/account" } });
      expect(
        await a.security.secrets.consumeToken({
          purpose: "verify-email",
          token,
        })
      ).toEqual({ ok: true, subject, data: { next: "/account" } });
      expect(
        await a.security.secrets.consumeToken({
          purpose: "verify-email",
          token,
        })
      ).toEqual({ ok: false, reason: "spent" });
    });

    it("stores neither the token nor the code, only a keyed hash", async () => {
      const { a, rows } = await boot();
      const { token } = await a.security.secrets.mintToken({
        purpose: "verify-email",
        subject,
        expiresInMs: 60_000,
      });
      const { code } = await a.security.secrets.mintCode({
        purpose: "sign-in",
        subject,
        expiresInMs: 60_000,
        maxWrongTries: 3,
      });
      const stored = JSON.stringify(await rows());
      expect(stored).not.toContain(token);
      expect(stored).not.toContain(`"${code}"`);
    });

    it("refuses another purpose, another plugin, an expired, a spent and a voided token, changing nothing", async () => {
      const { a, b } = await boot();
      const mint = () =>
        a.security.secrets.mintToken({
          purpose: "verify-email",
          subject,
          expiresInMs: 60_000,
        });
      const first = await mint();
      expect(
        await a.security.secrets.consumeToken({
          purpose: "reset",
          token: first.token,
        })
      ).toEqual({ ok: false, reason: "invalid" });
      expect(
        await b.security.secrets.consumeToken({
          purpose: "verify-email",
          token: first.token,
        })
      ).toEqual({ ok: false, reason: "invalid" });
      // Neither refusal spent it.
      expect(
        await a.security.secrets.consumeToken({
          purpose: "verify-email",
          token: first.token,
        })
      ).toMatchObject({ ok: true });

      const voided = await mint();
      await a.security.secrets.voidFor({ subject, purposes: ["verify-email"] });
      expect(
        await a.security.secrets.consumeToken({
          purpose: "verify-email",
          token: voided.token,
        })
      ).toEqual({ ok: false, reason: "invalid" });

      const expiring = await mint();
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(Date.now() + 2 * 60_000);
      expect(
        await a.security.secrets.consumeToken({
          purpose: "verify-email",
          token: expiring.token,
        })
      ).toEqual({ ok: false, reason: "expired" });
    });

    it("counts a wrong code against its budget, and voids it at the end", async () => {
      const { a } = await boot();
      const { code } = await a.security.secrets.mintCode({
        purpose: "sign-in",
        subject,
        expiresInMs: 10 * 60_000,
        maxWrongTries: 2,
      });
      const wrong = code === "000000" ? "000001" : "000000";
      expect(
        await a.security.secrets.consumeCode({
          purpose: "sign-in",
          subject,
          code: wrong,
        })
      ).toEqual({ ok: false, reason: "wrong", triesLeft: 1 });
      expect(
        await a.security.secrets.consumeCode({
          purpose: "sign-in",
          subject,
          code: wrong,
        })
      ).toEqual({ ok: false, reason: "wrong", triesLeft: 0 });
      // Void now: the right code no longer works.
      expect(
        await a.security.secrets.consumeCode({
          purpose: "sign-in",
          subject,
          code,
        })
      ).toEqual({ ok: false, reason: "none" });
    });

    it("refuses a code inside an open transaction, so a rollback never gives a wrong try back", async () => {
      const { a } = await boot();
      const { code } = await a.security.secrets.mintCode({
        purpose: "sign-in",
        subject,
        expiresInMs: 10 * 60_000,
        maxWrongTries: 3,
      });
      const wrong = code === "000000" ? "000001" : "000000";
      await expect(
        a.db.transaction(async () => {
          await a.security.secrets.consumeCode({
            purpose: "sign-in",
            subject,
            code: wrong,
          });
        })
      ).rejects.toBeInstanceOf(NextlyError);

      // Charged outside, then the caller's own work rolls back each time.
      for (let attempt = 0; attempt < 3; attempt++) {
        const answer = await a.security.secrets.consumeCode({
          purpose: "sign-in",
          subject,
          code: wrong,
        });
        expect(answer).toMatchObject({ ok: false, reason: "wrong" });
        await a.db
          .transaction(async () => {
            throw new Error("the caller's work after a wrong answer failed");
          })
          .catch(() => undefined);
      }
      expect(
        await a.security.secrets.consumeCode({
          purpose: "sign-in",
          subject,
          code,
        })
      ).toEqual({ ok: false, reason: "none" });
    });

    it("voids the earlier code on a new one, and earlier tokens when asked", async () => {
      const { a } = await boot();
      const first = await a.security.secrets.mintCode({
        purpose: "sign-in",
        subject,
        expiresInMs: 10 * 60_000,
        maxWrongTries: 3,
      });
      const second = await a.security.secrets.mintCode({
        purpose: "sign-in",
        subject,
        expiresInMs: 10 * 60_000,
        maxWrongTries: 3,
      });
      if (first.code !== second.code) {
        expect(
          await a.security.secrets.consumeCode({
            purpose: "sign-in",
            subject,
            code: first.code,
          })
        ).toMatchObject({ ok: false, reason: "wrong" });
      }
      expect(
        await a.security.secrets.consumeCode({
          purpose: "sign-in",
          subject,
          code: second.code,
        })
      ).toMatchObject({ ok: true });

      const old = await a.security.secrets.mintToken({
        purpose: "reset",
        subject,
        expiresInMs: 60_000,
      });
      await a.security.secrets.mintToken({
        purpose: "reset",
        subject,
        expiresInMs: 60_000,
        voidEarlier: true,
      });
      expect(
        await a.security.secrets.consumeToken({
          purpose: "reset",
          token: old.token,
        })
      ).toEqual({ ok: false, reason: "invalid" });
    });

    it("voids and spends inside the plugin's transaction, rolling back and committing with it", async () => {
      const { a } = await boot();
      const mint = () =>
        a.security.secrets.mintToken({
          purpose: "reset",
          subject,
          expiresInMs: 60_000,
        });
      const kept = await mint();
      await a.db
        .transaction(async tx => {
          await a.security.secrets.voidFor({ subject }, { tx });
          throw new Error("roll back");
        })
        .catch(() => undefined);
      await a.db
        .transaction(async tx => {
          expect(
            await a.security.secrets.consumeToken(
              { purpose: "reset", token: kept.token },
              { tx }
            )
          ).toMatchObject({ ok: true });
          throw new Error("roll back the spend");
        })
        .catch(() => undefined);
      // Neither the void nor the spend survived.
      expect(
        await a.security.secrets.consumeToken({
          purpose: "reset",
          token: kept.token,
        })
      ).toMatchObject({ ok: true });

      const voidedInTx = await mint();
      await a.db.transaction(async tx => {
        await a.security.secrets.voidFor({ subject }, { tx });
      });
      expect(
        await a.security.secrets.consumeToken({
          purpose: "reset",
          token: voidedInTx.token,
        })
      ).toEqual({ ok: false, reason: "invalid" });
    });

    it("refuses a write made inside an open transaction that passes none", async () => {
      const { a } = await boot();
      await expect(
        a.db.transaction(async () => {
          await a.security.secrets.mintToken({
            purpose: "reset",
            subject,
            expiresInMs: 60_000,
          });
        })
      ).rejects.toBeInstanceOf(NextlyError);
    });

    it("accepts a token minted under the install's previous secret", async () => {
      vi.stubEnv(
        "NEXTLY_SECRET",
        "the-first-install-secret-long-enough-for-prod"
      );
      _resetEnvCache();
      const { a } = await boot();
      const { token } = await a.security.secrets.mintToken({
        purpose: "reset",
        subject,
        expiresInMs: 60_000,
      });
      vi.stubEnv("NEXTLY_SECRET", "the-rotated-install-secret-long-enough-too");
      vi.stubEnv(
        "NEXTLY_SECRET_PREVIOUS",
        "the-first-install-secret-long-enough-for-prod"
      );
      _resetEnvCache();
      expect(
        await a.security.secrets.consumeToken({ purpose: "reset", token })
      ).toMatchObject({ ok: true });
    });

    describe("on two instances at once", () => {
      it("lets exactly one of two spends of a token succeed", async () => {
        const { a, elsewhere } = await boot();
        for (let round = 0; round < 5; round++) {
          const { token } = await a.security.secrets.mintToken({
            purpose: "reset",
            subject,
            expiresInMs: 60_000,
          });
          const answers = await Promise.all([
            a.security.secrets.consumeToken({ purpose: "reset", token }),
            elsewhere.consumeToken({ purpose: "reset", token }),
          ]);
          expect(answers.filter(answer => answer.ok)).toHaveLength(1);
        }
      });

      it("lets exactly one of two right answers to a code succeed", async () => {
        const { a, elsewhere } = await boot();
        for (let round = 0; round < 5; round++) {
          const { code } = await a.security.secrets.mintCode({
            purpose: "sign-in",
            subject,
            expiresInMs: 60_000,
            maxWrongTries: 3,
          });
          const answers = await Promise.all([
            a.security.secrets.consumeCode({
              purpose: "sign-in",
              subject,
              code,
            }),
            elsewhere.consumeCode({ purpose: "sign-in", subject, code }),
          ]);
          expect(answers.filter(answer => answer.ok)).toHaveLength(1);
        }
      });

      it("spends no more than a code's budget under a burst of wrong tries", async () => {
        const { a, elsewhere, rows } = await boot();
        const { code } = await a.security.secrets.mintCode({
          purpose: "sign-in",
          subject,
          expiresInMs: 60_000,
          maxWrongTries: 3,
        });
        const wrong = code === "000000" ? "000001" : "000000";
        const answers = await Promise.all(
          Array.from({ length: 10 }, (_, index) =>
            (index % 2 === 0 ? a.security.secrets : elsewhere).consumeCode({
              purpose: "sign-in",
              subject,
              code: wrong,
            })
          )
        );
        expect(
          answers.filter(answer => !answer.ok && answer.reason === "wrong")
        ).toHaveLength(3);
        const [row] = await rows();
        expect(row).toMatchObject({ wrongTries: 3 });
        expect(
          await a.security.secrets.consumeCode({
            purpose: "sign-in",
            subject,
            code,
          })
        ).toEqual({ ok: false, reason: "none" });
      });

      it("leaves exactly one live code after two mints at once", async () => {
        const { a, elsewhere } = await boot();
        const minted = await Promise.all([
          a.security.secrets.mintCode({
            purpose: "sign-in",
            subject,
            expiresInMs: 60_000,
            maxWrongTries: 3,
          }),
          elsewhere.mintCode({
            purpose: "sign-in",
            subject,
            expiresInMs: 60_000,
            maxWrongTries: 3,
          }),
        ]);
        let works = 0;
        for (const { code } of minted) {
          const answer = await a.security.secrets.consumeCode({
            purpose: "sign-in",
            subject,
            code,
          });
          if (answer.ok) works++;
        }
        expect(works).toBe(1);
      });
    });
  }
);
