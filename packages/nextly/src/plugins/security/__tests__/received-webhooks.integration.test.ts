/**
 * Claiming received webhooks once, on every dialect: a duplicate, the key's
 * scope, the plugin's transaction, two claims at once, a timestamp-less
 * scheme's replay, a lease run out, and pruning.
 *
 * Two instances share the database where the dialect allows it (on SQLite the
 * second is the boot's own adapter), so "at once" means two connections.
 * Deliveries are signed for real and verified through `ctx.security.webhooks`:
 * nothing here builds a verified answer by hand.
 *
 * @module plugins/security/__tests__/received-webhooks.integration.test
 */
import { createHmac } from "node:crypto";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { afterEach, describe, expect, it, vi } from "vitest";

import { container } from "../../../di/container";
import { buildSignatureHeaders } from "../../../domains/webhooks/signing";
import { NextlyError } from "../../../errors/nextly-error";
import {
  bootTwoInstances,
  type TwoInstances,
} from "../../__tests__/helpers/two-instances";
import { definePlugin, type PluginContext } from "../../plugin-context";
import { getConfiguredTestDialects } from "../../test-nextly";
import {
  standardWebhooks,
  type DeliveryClaimResult,
  type InboundWebhookScheme,
  type PluginReceivedWebhooks,
  type VerifiedWebhook,
} from "../inbound-webhooks";
import { createPluginReceivedWebhooks } from "../received-webhooks";
import { pruneReceivedWebhooks } from "../received-webhooks-prune";

let current: TwoInstances | undefined;

afterEach(async () => {
  vi.useRealTimers();
  await current?.destroy();
  current = undefined;
});

const SECRET = Buffer.from("current-key-material-0123456789").toString(
  "base64"
);
const MINUTE = 60_000;
/**
 * The retention the docs promise, written out rather than read from the
 * sweep's constant, so a changed constant fails here instead of moving with it.
 */
const THIRTY_DAYS = 30 * 24 * 60 * MINUTE;
/** A whole second, so SQLite's second-precision times read back exactly. */
const T0 = new Date("2026-10-15T00:00:00.000Z");

/** Standard Webhooks, as a provider sends it: retries keep the id, re-sign the time. */
function standardRequest(id: string, body = `{"id":"${id}"}`): Request {
  const headers = buildSignatureHeaders({
    id,
    timestamp: String(Math.floor(Date.now() / 1000)),
    body,
    secrets: [SECRET],
  });
  return new Request("https://example.test/hook", {
    method: "POST",
    headers,
    body,
  });
}

const UNTIMED_SECRET = "provider-secret";

/**
 * A provider that signs no time and sends no id: `sha256=<hex>`, an HMAC of
 * the body alone.
 */
const untimed: InboundWebhookScheme = {
  read({ headers, bytes }) {
    const header = headers.get("x-untimed-signature");
    if (header === null) return null;
    const hex = header.startsWith("sha256=") ? header.slice(7) : "";
    return {
      signatures: [Buffer.from(hex, "hex")],
      signed: bytes,
      timestamp: "none",
    };
  },
  sign: (secret, signed) =>
    createHmac("sha256", secret).update(signed).digest(),
};

/**
 * The timestamp-less scheme, with the delivery's id read from its body, as a
 * provider that puts it there is read. JSON can carry any character in it.
 */
const idInBody: InboundWebhookScheme = {
  read(delivery) {
    const reading = untimed.read(delivery);
    if (reading === null) return null;
    const id = (
      JSON.parse(new TextDecoder().decode(delivery.bytes)) as { id?: string }
    ).id;
    return id === undefined ? reading : { ...reading, deliveryId: id };
  },
  sign: untimed.sign,
};

/** A delivery in the timestamp-less scheme, signed as its provider signs it. */
function untimedRequest(body: string): Request {
  const hex = createHmac("sha256", UNTIMED_SECRET).update(body).digest("hex");
  return new Request("https://example.test/hook", {
    method: "POST",
    headers: { "x-untimed-signature": `sha256=${hex}` },
    body,
  });
}

async function verified(
  webhooks: PluginReceivedWebhooks,
  request: Request
): Promise<VerifiedWebhook> {
  const answer = await webhooks.verify(request, {
    scheme: standardWebhooks,
    secrets: [SECRET],
  });
  if (!answer.verified) throw new Error(`not verified: ${answer.reason}`);
  return answer;
}

function statusOf(result: DeliveryClaimResult): string {
  return result.status;
}

describe.each(getConfiguredTestDialects())(
  "claiming received webhooks (%s)",
  dialect => {
    /** Two plugins, and the first plugin's helper on a second instance. */
    async function boot(): Promise<{
      a: PluginContext;
      b: PluginContext;
      elsewhere: PluginReceivedWebhooks;
      rows: () => Promise<Array<Record<string, unknown>>>;
      adapter: DrizzleAdapter;
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
        plugins: [plugin("@test/hooks-a"), plugin("@test/hooks-b")],
      });
      const second = current.second;
      const a = captured["@test/hooks-a"];
      const b = captured["@test/hooks-b"];
      if (!a || !b) throw new Error("the plugins' init did not run");
      const adapter = current.first.adapter as unknown as DrizzleAdapter;
      expect(adapter.dialect).toBe(dialect);
      return {
        a,
        b,
        elsewhere: createPluginReceivedWebhooks({
          owner: "@test/hooks-a",
          adapter: () => second,
        }),
        rows: () => adapter.select("nextly_received_webhooks", {}),
        adapter,
      };
    }

    it("a delivery is claimed once; the same one again is a duplicate", async () => {
      const { a, rows } = await boot();
      const hooks = a.security.webhooks;
      const first = await hooks.claimDelivery(
        await verified(hooks, standardRequest("msg_once")),
        { provider: "acme" }
      );
      expect(first.status).toBe("first");
      if (first.status !== "first") return;
      expect(await first.claim.complete()).toEqual({ completed: true });
      const [recorded] = await rows();

      // The provider's retry: the same id, a new time and signature.
      const again = await hooks.claimDelivery(
        await verified(hooks, standardRequest("msg_once")),
        { provider: "acme" }
      );
      expect(again).toEqual({ status: "duplicate" });
      // The duplicate wrote nothing: one row, exactly as it was.
      expect(await rows()).toEqual([recorded]);
      expect(recorded).toMatchObject({
        owner: "@test/hooks-a",
        provider: "acme",
        deliveryId: "msg_once",
        status: "completed",
        freshness: "checked",
      });
    });

    it("a delivery id is its plugin's and provider's, compared byte for byte", async () => {
      const { a, b } = await boot();
      const delivery = () => standardRequest("msg_scope");
      const claim = async (
        ctx: PluginContext,
        options: { provider: string; id?: string }
      ) =>
        statusOf(
          await ctx.security.webhooks.claimDelivery(
            await verified(ctx.security.webhooks, delivery()),
            options
          )
        );
      expect(await claim(a, { provider: "acme" })).toBe("first");
      // Another plugin, another provider: deliveries of their own.
      expect(await claim(b, { provider: "acme" })).toBe("first");
      expect(await claim(a, { provider: "other" })).toBe("first");
      // Ids that a case- or accent-insensitive collation would join.
      for (const id of ["Order-1", "order-1", "café", "cafe"]) {
        expect(await claim(a, { provider: "acme", id })).toBe("first");
      }
      expect(await claim(a, { provider: "acme", id: "Order-1" })).toBe(
        "in-progress"
      );
    });

    it("a claim in a transaction that rolls back leaves the delivery unclaimed", async () => {
      const { a, rows } = await boot();
      const hooks = a.security.webhooks;
      const failed = new Error("the handler failed");
      await expect(
        a.db.transaction(async tx => {
          const result = await hooks.claimDelivery(
            await verified(hooks, standardRequest("msg_tx")),
            { provider: "acme", tx }
          );
          expect(result.status).toBe("first");
          throw failed;
        })
      ).rejects.toBe(failed);
      expect(await rows()).toEqual([]);

      // The provider's retry is processed, and committing records it done.
      await a.db.transaction(async tx => {
        const result = await hooks.claimDelivery(
          await verified(hooks, standardRequest("msg_tx")),
          { provider: "acme", tx }
        );
        expect(result.status).toBe("first");
      });
      expect(
        await hooks.claimDelivery(
          await verified(hooks, standardRequest("msg_tx")),
          { provider: "acme" }
        )
      ).toEqual({ status: "duplicate" });
    });

    it("refuses a claim beside an open transaction that passes none", async () => {
      const { a, rows } = await boot();
      const hooks = a.security.webhooks;
      const answer = await verified(hooks, standardRequest("msg_beside"));
      await expect(
        a.db.transaction(async () => {
          await hooks.claimDelivery(answer, { provider: "acme" });
        })
      ).rejects.toBeInstanceOf(NextlyError);
      expect(await rows()).toEqual([]);
    });

    it("two claims of one delivery at once: exactly one is first", async () => {
      const { a, elsewhere } = await boot();
      const hooks = a.security.webhooks;
      for (let round = 0; round < 5; round++) {
        const id = `msg_race_${round}`;
        const results = await Promise.all([
          hooks.claimDelivery(await verified(hooks, standardRequest(id)), {
            provider: "acme",
          }),
          elsewhere.claimDelivery(
            await verified(elsewhere, standardRequest(id)),
            { provider: "acme" }
          ),
        ]);
        expect(results.map(statusOf).sort()).toEqual(["first", "in-progress"]);
      }
      // One in the plugin's transaction, one beside it on another instance.
      for (let round = 0; round < 5; round++) {
        const id = `msg_race_tx_${round}`;
        const inTx = verified(hooks, standardRequest(id));
        const beside = verified(elsewhere, standardRequest(id));
        const [first, second] = await Promise.all([
          a.db.transaction(async tx =>
            hooks.claimDelivery(await inTx, { provider: "acme", tx })
          ),
          elsewhere.claimDelivery(await beside, { provider: "acme" }),
        ]);
        const statuses = [first, second].map(statusOf);
        expect(statuses.filter(status => status === "first")).toHaveLength(1);
      }
    });

    it("a replay of a timestamp-less delivery is a duplicate while its record is kept", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(T0);
      const { a, adapter } = await boot();
      const hooks = a.security.webhooks;
      const options = { scheme: untimed, secrets: [UNTIMED_SECRET] };
      const send = untimedRequest;
      const claim = async (body: string) => {
        const answer = await hooks.verify(send(body), options);
        if (!answer.verified) throw new Error(answer.reason);
        expect(answer.freshness).toBe("unchecked");
        return hooks.claimDelivery(answer, { provider: "untimed" });
      };

      const first = await claim('{"amount":10}');
      expect(first.status).toBe("first");
      if (first.status === "first") await first.claim.complete();
      // The same bytes, captured and sent again a week later.
      vi.setSystemTime(T0.getTime() + 7 * 24 * 60 * MINUTE);
      expect(await claim('{"amount":10}')).toEqual({ status: "duplicate" });
      // A different body is a different delivery.
      expect((await claim('{"amount":11}')).status).toBe("first");

      // Once its record is pruned, the same bytes are new again: the window
      // the docs state, and no longer.
      vi.setSystemTime(T0.getTime() + THIRTY_DAYS + MINUTE);
      await pruneReceivedWebhooks(adapter, new Date());
      expect((await claim('{"amount":10}')).status).toBe("first");
    });

    it("a verified result changed after verify still claims the delivery that was verified", async () => {
      const { a } = await boot();
      const hooks = a.security.webhooks;
      const options = { scheme: untimed, secrets: [UNTIMED_SECRET] };
      const send = untimedRequest;
      const original = '{"amount":10}';
      const other = '{"amount":99}';
      const answer = await hooks.verify(send(original), options);
      if (!answer.verified) throw new Error(answer.reason);
      // The answer is frozen, but its bytes are a buffer anyone holding it can
      // write into: overwrite them with another body's.
      answer.bytes.set(new TextEncoder().encode(other));
      const first = await hooks.claimDelivery(answer, { provider: "untimed" });
      expect(first.status).toBe("first");
      if (first.status === "first") await first.claim.complete();

      // The claim was the original's: its replay is a duplicate, and the body
      // written in is a delivery no one has claimed.
      const replay = await hooks.verify(send(original), options);
      const written = await hooks.verify(send(other), options);
      if (!replay.verified || !written.verified) throw new Error("unverified");
      expect(
        await hooks.claimDelivery(replay, { provider: "untimed" })
      ).toEqual({ status: "duplicate" });
      expect(
        (await hooks.claimDelivery(written, { provider: "untimed" })).status
      ).toBe("first");
    });

    it("a handler that fails after claiming, without tx, still has the provider's retry processed", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(T0);
      const { a } = await boot();
      const hooks = a.security.webhooks;
      const deliver = async () =>
        hooks.claimDelivery(await verified(hooks, standardRequest("msg_pay")), {
          provider: "acme",
        });

      // The handler claims, then dies before completing: no complete, no release.
      expect((await deliver()).status).toBe("first");

      // A retry inside the lease: someone holds it, so answer "try again".
      vi.setSystemTime(T0.getTime() + MINUTE);
      expect(await deliver()).toEqual({ status: "in-progress" });

      // A retry after the lease is processed, not answered as a duplicate.
      vi.setSystemTime(T0.getTime() + 6 * MINUTE);
      const retry = await deliver();
      expect(retry.status).toBe("first");
      if (retry.status !== "first") return;
      expect(await retry.claim.complete()).toEqual({ completed: true });

      // Processed now: the next retry is a duplicate.
      vi.setSystemTime(T0.getTime() + 7 * MINUTE);
      expect(await deliver()).toEqual({ status: "duplicate" });
    });

    it("a released claim is first again at once", async () => {
      const { a, rows } = await boot();
      const hooks = a.security.webhooks;
      const deliver = async () =>
        hooks.claimDelivery(
          await verified(hooks, standardRequest("msg_release")),
          { provider: "acme" }
        );
      const first = await deliver();
      if (first.status !== "first") throw new Error(first.status);
      expect(await first.claim.release()).toEqual({ released: true });
      expect(await rows()).toEqual([]);
      const again = await deliver();
      expect(again.status).toBe("first");
      // Released twice is released once: the second finds nothing it holds.
      expect(await first.claim.release()).toEqual({ released: false });
      expect(await rows()).toHaveLength(1);
    });

    it("release never undoes a processed delivery", async () => {
      const { a, rows } = await boot();
      const hooks = a.security.webhooks;
      const deliver = async (id: string) =>
        hooks.claimDelivery(await verified(hooks, standardRequest(id)), {
          provider: "acme",
        });

      // Completed, then released, as a handler does that saw `complete`
      // throw after it had in fact committed.
      const done = await deliver("msg_done_then_released");
      if (done.status !== "first") throw new Error(done.status);
      expect(await done.claim.complete()).toEqual({ completed: true });
      expect(await done.claim.release()).toEqual({ released: false });
      expect(await deliver("msg_done_then_released")).toEqual({
        status: "duplicate",
      });

      // Claimed in the plugin's transaction, so processed at once.
      let inTx: DeliveryClaimResult | undefined;
      await a.db.transaction(async tx => {
        inTx = await hooks.claimDelivery(
          await verified(hooks, standardRequest("msg_tx_then_released")),
          { provider: "acme", tx }
        );
      });
      if (inTx?.status !== "first") throw new Error(String(inTx?.status));
      expect(await inTx.claim.release()).toEqual({ released: false });
      expect(await deliver("msg_tx_then_released")).toEqual({
        status: "duplicate",
      });
      expect(await rows()).toHaveLength(2);
    });

    it("a scheme's id that no dialect can store is kept out of the record, and still claims its delivery", async () => {
      const { a, rows } = await boot();
      const hooks = a.security.webhooks;
      const options = { scheme: idInBody, secrets: [UNTIMED_SECRET] };
      // NUL, which PostgreSQL's text cannot hold, and one past the width.
      for (const id of ["evt\u0000nul", "e".repeat(192)]) {
        const body = JSON.stringify({ id });
        const claim = async () => {
          const answer = await hooks.verify(untimedRequest(body), options);
          if (!answer.verified) throw new Error(answer.reason);
          expect(answer.deliveryId).toBe(id);
          return hooks.claimDelivery(answer, { provider: "acme" });
        };
        const first = await claim();
        expect(first.status).toBe("first");
        if (first.status === "first") await first.claim.complete();
        // Keyed by the id all the same: the replay is a duplicate.
        expect(await claim()).toEqual({ status: "duplicate" });
      }
      // Recorded, with no id kept for either.
      expect((await rows()).map(row => row.deliveryId ?? null)).toEqual([
        null,
        null,
      ]);
    });

    it("an empty delivery id is no id: deliveries are told apart by their body", async () => {
      const { a } = await boot();
      const hooks = a.security.webhooks;
      const claim = async (body: string) =>
        statusOf(
          await hooks.claimDelivery(
            await verified(hooks, standardRequest("", body)),
            { provider: "acme" }
          )
        );
      expect(await claim('{"event":1}')).toBe("first");
      // Another delivery with the same empty id is not a duplicate of it.
      expect(await claim('{"event":2}')).toBe("first");
      // The same body again still is.
      expect(await claim('{"event":1}')).toBe("in-progress");
    });

    it("a claim that waited on the database holds its whole lease from when it won", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(T0);
      const { a, adapter } = await boot();
      const hooks = a.security.webhooks;
      const answer = await verified(hooks, standardRequest("msg_waited"));
      // A helper of the same plugin whose insert waited ten seconds on the
      // database: its clock reads the start of the attempt first, and ten
      // seconds later every time after.
      let reads = 0;
      const waited = createPluginReceivedWebhooks({
        owner: "@test/hooks-a",
        adapter: () => adapter,
        now: () => ((reads += 1) === 1 ? T0 : new Date(T0.getTime() + 10_000)),
      });
      const first = await waited.claimDelivery(answer, {
        provider: "acme",
        leaseSeconds: 1,
      });
      expect(first.status).toBe("first");

      // A retry half a second after the claim was won: its one-second lease
      // is live, counted from then, not from before the wait.
      vi.setSystemTime(T0.getTime() + 10_500);
      expect(
        await hooks.claimDelivery(
          await verified(hooks, standardRequest("msg_waited")),
          { provider: "acme", leaseSeconds: 1 }
        )
      ).toEqual({ status: "in-progress" });
    });

    it("a lease is never shorter than asked, on every dialect", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      // Most of a second past a whole second: a lease end kept in whole
      // seconds would otherwise lose most of the second asked for.
      vi.setSystemTime(T0.getTime() + 900);
      const { a } = await boot();
      const hooks = a.security.webhooks;
      const deliver = async () =>
        hooks.claimDelivery(
          await verified(hooks, standardRequest("msg_short_lease")),
          { provider: "acme", leaseSeconds: 1 }
        );
      expect((await deliver()).status).toBe("first");
      // Six tenths of a second later: within the second asked for.
      vi.setSystemTime(T0.getTime() + 1500);
      expect(await deliver()).toEqual({ status: "in-progress" });
      // Past it, and past the whole second it was rounded up to.
      vi.setSystemTime(T0.getTime() + 2100);
      expect((await deliver()).status).toBe("first");
    });

    it("complete after the lease was taken over is refused, and two takeovers of one expired lease give one first", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(T0);
      const { a, elsewhere, rows } = await boot();
      const hooks = a.security.webhooks;
      const deliver = async (
        on: PluginReceivedWebhooks,
        id: string
      ): Promise<DeliveryClaimResult> =>
        on.claimDelivery(await verified(on, standardRequest(id)), {
          provider: "acme",
        });

      const slow = await deliver(hooks, "msg_slow");
      if (slow.status !== "first") throw new Error(slow.status);
      vi.setSystemTime(T0.getTime() + 6 * MINUTE);
      const taker = await deliver(hooks, "msg_slow");
      if (taker.status !== "first") throw new Error(taker.status);
      // The first handler finishes late: its claim is no longer its own.
      expect(await slow.claim.complete()).toEqual({ completed: false });
      expect(await slow.claim.release()).toEqual({ released: false });
      expect(await rows()).toMatchObject([{ status: "pending" }]);
      expect(await taker.claim.complete()).toEqual({ completed: true });
      // Completing again changes nothing, and still says completed.
      expect(await taker.claim.complete()).toEqual({ completed: true });

      // Two retries racing for one run-out lease, on two instances.
      for (let round = 0; round < 3; round++) {
        const id = `msg_takeover_${round}`;
        vi.setSystemTime(T0.getTime() + (10 + round * 10) * MINUTE);
        expect((await deliver(hooks, id)).status).toBe("first");
        vi.setSystemTime(T0.getTime() + (16 + round * 10) * MINUTE);
        const racing = await Promise.all([
          deliver(hooks, id),
          deliver(elsewhere, id),
        ]);
        expect(racing.map(statusOf).sort()).toEqual(["first", "in-progress"]);
      }
    });

    it("pruning removes records older than 30 days and keeps the rest", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(T0);
      const { a, adapter, rows } = await boot();
      const hooks = a.security.webhooks;
      const deliver = async (id: string) =>
        hooks.claimDelivery(await verified(hooks, standardRequest(id)), {
          provider: "acme",
        });

      // Processed at T0; abandoned at T0 (its lease ends five minutes on).
      const done = await deliver("msg_old_done");
      if (done.status === "first") await done.claim.complete();
      expect((await deliver("msg_old_abandoned")).status).toBe("first");
      // Processed a day later.
      vi.setSystemTime(T0.getTime() + 24 * 60 * MINUTE);
      const recent = await deliver("msg_recent");
      if (recent.status === "first") await recent.claim.complete();

      // 30 days after T0 and a minute: the processed one is past it, the
      // abandoned lease (ended at T0 + 5 minutes) not yet.
      const cutoff = T0.getTime() + THIRTY_DAYS;
      vi.setSystemTime(cutoff + MINUTE);
      expect((await pruneReceivedWebhooks(adapter, new Date())).removed).toBe(
        1
      );
      expect((await rows()).map(row => row.deliveryId).sort()).toEqual([
        "msg_old_abandoned",
        "msg_recent",
      ]);

      // Past the abandoned lease's end too: it goes, the recent one stays.
      vi.setSystemTime(cutoff + 6 * MINUTE);
      expect((await pruneReceivedWebhooks(adapter, new Date())).removed).toBe(
        1
      );
      expect((await rows()).map(row => row.deliveryId)).toEqual(["msg_recent"]);

      // A live lease is never pruned, however the sweep is timed.
      const live = await deliver("msg_live");
      expect(live.status).toBe("first");
      await pruneReceivedWebhooks(adapter, new Date());
      expect((await rows()).map(row => row.deliveryId).sort()).toEqual([
        "msg_live",
        "msg_recent",
      ]);
    });

    it("hands the scheduled drain the sweep, so a quiet install still prunes", async () => {
      await boot();
      expect(
        container.get<{ receivedWebhooks?: boolean } | undefined>(
          "webhookRetentionDeps"
        )
      ).toMatchObject({ receivedWebhooks: true });
    });
  }
);
