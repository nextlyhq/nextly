/**
 * A queued email's one-time link is never at rest in core's jobs table: not
 * in the job's input when it is queued, not after it is sent, and not in the
 * error a failed send leaves on the row, however many times it fails. Nor
 * in a log line along the way. The plugin runs as a site boots it, on
 * core's own secrets and core's own job runner, on each dialect; only the
 * email provider is a stand-in, which hands the test the link a person
 * would be sent.
 *
 * @module wiring/queued-secrets.integration.test
 */
import type { PluginContext } from "@nextlyhq/plugin-sdk";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
import { runJobsPass } from "nextly";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { accounts } from "../plugin";
import { createAccount } from "../storage/accounts";
import { accountsServices } from "../server/installed";
import { TEST_ORIGIN } from "../test-support/boot";

import { SEND_EMAIL_JOB } from "./jobs";

/** What one send was handed, and how the stand-in provider answers it. */
interface Send {
  slug: string;
  variables: Record<string, unknown>;
}

/** Every line logged while a test runs, by core, the plugin or the console. */
const logged: string[] = [];

/** A logger that keeps every line, with its context, as text. */
function keepingLogger(prefix: string) {
  const keep =
    (level: string) => (message: string, meta?: Record<string, unknown>) => {
      logged.push(
        `${prefix} ${level} ${message} ${JSON.stringify(meta ?? {})}`
      );
    };
  return {
    debug: keep("debug"),
    info: keep("info"),
    warn: keep("warn"),
    error: keep("error"),
  };
}

/** The token a link carries. */
function tokenIn(link: unknown): string {
  const token = new URL(String(link)).searchParams.get("token");
  if (token === null || token.length < 20)
    throw new Error(`no token in ${String(link)}`);
  return token;
}

describe.each(getConfiguredTestDialects())(
  "a queued email's one-time link, never at rest in the jobs table (%s)",
  (dialect: TestDialect) => {
    let current: TestNextly | undefined;
    const sends: Send[] = [];
    /** How the provider answers each send in turn: sent, or a thrown error that echoes the email. */
    let answers: Array<"sent" | "throws"> = [];

    beforeEach(() => {
      logged.length = 0;
      sends.length = 0;
      answers = [];
      for (const level of ["log", "info", "warn", "error", "debug"] as const)
        vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
          logged.push(`console ${level} ${args.map(String).join(" ")}`);
        });
    });

    afterEach(async () => {
      vi.restoreAllMocks();
      await current?.destroy();
      current = undefined;
    });

    /**
     * Boots the plugin on core's own secrets and job runner. The plugin's
     * context is the one core built, but for its email service's
     * `sendWithTemplate`, which records the send in place of a provider,
     * and its logger, which keeps every line.
     */
    async function boot(): Promise<{
      ctx: PluginContext;
      nextly: TestNextly;
    }> {
      const plugin = accounts({ origin: TEST_ORIGIN });
      let captured: PluginContext | undefined;
      const nextly = await createTestNextly({
        dialect,
        logger: keepingLogger("core"),
        plugins: [
          {
            ...plugin,
            init: async (ctx: PluginContext) => {
              const email = Object.create(ctx.services.email, {
                sendWithTemplate: {
                  value: async (
                    slug: string,
                    _to: string,
                    variables: Record<string, unknown>
                  ) => {
                    sends.push({ slug, variables });
                    if ((answers.shift() ?? "sent") === "throws")
                      throw new Error(
                        `The provider refused: ${JSON.stringify(variables)}`
                      );
                    return { success: true };
                  },
                },
              }) as PluginContext["services"]["email"];
              const services = Object.create(ctx.services, {
                email: { value: email },
              }) as PluginContext["services"];
              const watched = Object.create(ctx, {
                services: { value: services },
                logger: { value: keepingLogger("plugin") },
              }) as PluginContext;
              await plugin.init?.(watched);
              captured = watched;
            },
          },
        ],
      });
      current = nextly;
      if (captured === undefined) throw new Error("the plugin did not start");
      return { ctx: captured, nextly };
    }

    /** One pass of core's job runner, at `offsetMs` past now, keeping every finished row. */
    async function runJobs(nextly: TestNextly, offsetMs: number) {
      await runJobsPass(
        nextly.adapter as Parameters<typeof runJobsPass>[0],
        nextly.getService("jobRegistry") as Parameters<typeof runJobsPass>[1],
        {
          now: () => new Date(Date.now() + offsetMs),
          retentionMs: null,
          maxDurationMs: 10_000,
        }
      );
    }

    /** The plugin's email jobs, every column of every row, as text. */
    async function emailJobs(nextly: TestNextly) {
      const rows = await nextly.adapter.select<Record<string, unknown>>(
        "nextly_jobs",
        {
          where: {
            and: [{ column: "slug", op: "=", value: SEND_EMAIL_JOB }],
          },
        }
      );
      return { rows, text: JSON.stringify(rows) };
    }

    it("keeps an invitation's link out of its job's row and every log, queued, failed and sent", async () => {
      const { ctx, nextly } = await boot();
      const service = accountsServices(ctx);

      const issued = await service.invite({
        address: "ayesha@example.com",
        name: "Ayesha Khan",
      });
      const token = tokenIn(issued.link);

      // Queued: the row exists, and names no secret.
      const queued = await emailJobs(nextly);
      expect(queued.rows).toHaveLength(1);
      expect(queued.text).not.toContain(token);

      // The first send fails with an error that echoes the whole email.
      answers = ["throws"];
      await runJobs(nextly, 0);
      const failed = await emailJobs(nextly);
      expect(failed.rows[0]).toMatchObject({ state: "pending" });
      expect(String(failed.rows[0]?.lastError)).toContain("provider refused");
      expect(failed.text).not.toContain(token);

      // Its retry sends the link the invitation was issued with.
      await runJobs(nextly, 60_000);
      expect(sends.map(send => send.slug)).toEqual([
        "accounts-invitation",
        "accounts-invitation",
      ]);
      expect(sends.map(send => tokenIn(send.variables.link))).toEqual([
        token,
        token,
      ]);
      const sent = await emailJobs(nextly);
      expect(sent.rows[0]).toMatchObject({ state: "done" });
      expect(sent.text).not.toContain(token);

      expect(logged.filter(line => line.includes(token))).toEqual([]);
    });

    it("sends no link that was replaced before its email went, and the newer one as issued", async () => {
      const { ctx, nextly } = await boot();
      const service = accountsServices(ctx);

      await service.invite({ address: "ayesha@example.com", name: "Ayesha" });
      const newer = await service.invite({
        address: "ayesha@example.com",
        name: "Ayesha",
      });
      await runJobs(nextly, 0);

      // The first invitation's link was voided by the second: its email is
      // not sent, as its link would be refused, and its job ends.
      expect(sends.map(send => tokenIn(send.variables.link))).toEqual([
        tokenIn(newer.link),
      ]);
      const jobs = await emailJobs(nextly);
      expect(jobs.rows.map(row => row.state)).toEqual(["done", "done"]);
      expect(
        logged.filter(line => line.includes("can no longer be used"))
      ).toHaveLength(1);
    });

    it("keeps a reset link out of its job's row and every log, through every failed attempt to the failed job", async () => {
      const { ctx, nextly } = await boot();
      const made = await createAccount(ctx.db, ctx.dialect, {
        address: "dana@example.com",
        name: "Dana Reyes",
        passwordHash: null,
        verified: { at: new Date(), by: "test" },
      });
      if (made.status !== "created") throw new Error("expected an account");
      const service = accountsServices(ctx);

      await service.requestPasswordReset({
        visitor: {
          client: null,
          sessionToken: null,
          knownTokens: [],
          signUpToken: null,
        },
        address: "dana@example.com",
      });
      expect(await emailJobs(nextly)).toMatchObject({
        rows: [expect.anything()],
      });

      // Every attempt fails, each with an error that echoes the email, until
      // the runner gives up on the job.
      answers = Array.from({ length: 10 }, () => "throws" as const);
      for (let pass = 0; pass < 5; pass += 1)
        await runJobs(nextly, pass * 30_000);
      expect(sends).toHaveLength(5);
      const token = tokenIn(sends[0]?.variables.link);
      expect(sends.map(send => tokenIn(send.variables.link))).toEqual(
        Array.from({ length: 5 }, () => token)
      );

      const gaveUp = await emailJobs(nextly);
      expect(gaveUp.rows[0]).toMatchObject({ state: "failed" });
      expect(String(gaveUp.rows[0]?.lastError)).toContain("provider refused");
      expect(gaveUp.text).not.toContain(token);
      expect(logged.filter(line => line.includes(token))).toEqual([]);
    });
  }
);
