/**
 * A participant's fingerprint changes after a start that ran without it.
 *
 * A plugin keeping a record of who holds each public address misses every
 * save made while it is not running (disabled, removed, uninstalled), and
 * nothing the fingerprint otherwise covers need have changed. So core keeps
 * the set of participating plugins each start ran with, and a count that
 * goes up when a start runs with another set; the fingerprint includes it.
 *
 * Each case starts three times on one database of its own, through the
 * harness with an adapter it makes for that database.
 */
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createScratchDatabase } from "../../../__tests__/helpers/fresh-database";
import {
  recordStatements,
  type RecordedStatement,
} from "../../../__tests__/helpers/record-statements";
import { defineCollection } from "../../../collections/config/define-collection";
import { text } from "../../../collections/fields/helpers";
import { createAdapter } from "../../../database/factory";
import { getActiveHookRegistry } from "../../../hooks/hook-registry";
import { consoleLogger } from "../../../shared/types";
import { MetaService } from "../../meta/services/meta-service";
import {
  definePlugin,
  type PluginContext,
} from "../../../plugins/plugin-context";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
} from "../../../plugins/test-nextly";
import {
  addParticipant,
  participatingOwners,
  removeParticipant,
  type ParticipantRunner,
} from "../participants";
import {
  PARTICIPATION_META_KEY,
  queueParticipation,
  recordParticipation,
} from "../participation";

import { memoryParticipant } from "./memory-participant";

/** A plugin taking part, handing its context to the test. */
function participating() {
  const seen: { ctx?: PluginContext } = {};
  const record = memoryParticipant();
  const plugin = definePlugin({
    name: "@test/address-participant",
    version: "1.0.0",
    nextly: ">=0.0.0",
    init(ctx) {
      seen.ctx = ctx;
      ctx.publicAddresses.participate({
        holderOf: (address, asker, batch) =>
          record.runner.holderOf(address, asker, batch, undefined as never, {}),
        record: batch => record.runner.record(batch, undefined as never, {}),
      });
    },
  });
  return { plugin, seen };
}

/** A plugin that takes no part, so a start always has one. */
const bystander = definePlugin({
  name: "@test/bystander",
  version: "1.0.0",
  nextly: ">=0.0.0",
});

const posts = defineCollection({
  slug: "posts",
  status: true,
  fields: [text({ name: "title" }), text({ name: "slug" })],
  publicAddress: "/blog/{slug}",
});

/** The participation row as stored on `adapter`'s database. */
async function storedParticipation(adapter: DrizzleAdapter) {
  return new MetaService(adapter, consoleLogger).get<{
    owners: string[];
    count: number;
  }>(PARTICIPATION_META_KEY);
}

/**
 * Two starts' writes of the participation row, held so that both begin at
 * once: the first waits until the second arrives (or a second has passed,
 * where the second is itself waiting on the first), and both are released
 * together. Two starts that both read no row both go on to write it, as two
 * instances starting at once can, rather than one committing before the
 * other looks.
 */
function writingTogether() {
  let arrived = 0;
  let release: () => void = () => undefined;
  const released = new Promise<void>(resolve => {
    release = resolve;
  });
  return (meta: MetaService) => {
    const write = meta.set.bind(meta);
    meta.set = (async (...args: Parameters<MetaService["set"]>) => {
      arrived += 1;
      if (arrived === 2) release();
      await Promise.race([
        released,
        new Promise(resolve => setTimeout(resolve, 1_000)),
      ]);
      return write(...args);
    }) as MetaService["set"];
    return meta;
  };
}

/** Whether `call` writes the participation row of `nextly_meta`. */
const writesParticipation = (call: RecordedStatement) =>
  /^\s*(insert|update)\b/i.test(call.text) &&
  /nextly_meta/.test(call.text) &&
  call.values.some(value => value === PARTICIPATION_META_KEY);

describe.each(getConfiguredTestDialects())(
  "the participation a participant's fingerprint follows (%s)",
  (dialect: TestDialect) => {
    let url: string;
    let drop: () => Promise<void>;

    const adapterFor = (): Promise<DrizzleAdapter> =>
      createAdapter({ type: dialect, url } as Parameters<
        typeof createAdapter
      >[0]) as Promise<DrizzleAdapter>;

    beforeEach(async () => {
      if (dialect === "sqlite") {
        const dir = mkdtempSync(join(tmpdir(), "nextly-participation-"));
        url = `file:${join(dir, "start.db")}`;
        drop = async () => rmSync(dir, { recursive: true, force: true });
      } else {
        const scratch = await createScratchDatabase(
          dialect,
          "nextly_participation"
        );
        url = scratch.url;
        drop = scratch.drop;
      }
    }, 180_000);

    afterEach(async () => {
      await drop();
    });

    /**
     * Start with `withParticipant` deciding whether the participant runs,
     * answer its fingerprint where it does, and the statements the start
     * sent, then stop.
     */
    async function start(withParticipant: boolean) {
      const { plugin, seen } = participating();
      const adapter = await adapterFor();
      const probe = await adapterFor();
      const recorder = await recordStatements(probe, dialect);
      const t = await createTestNextly({
        adapter: adapter as never,
        collections: [posts],
        plugins: withParticipant ? [plugin, bystander] : [bystander],
      });
      try {
        const sent = [...recorder.calls];
        return {
          fingerprint: await seen.ctx?.publicAddresses.fingerprint(),
          sent,
        };
      } finally {
        recorder.uninstall();
        await probe.disconnect().catch(() => undefined);
        await t.destroy();
      }
    }

    it("changes after a start that ran without the participant", async () => {
      const first = await start(true);
      await start(false);
      const after = await start(true);

      expect(first.fingerprint).toEqual(expect.any(String));
      expect(after.fingerprint).not.toBe(first.fingerprint);
    }, 120_000);

    it.skipIf(dialect === "sqlite")(
      "lets two first starts at once both start, and raises the count once",
      async () => {
        // The core tables, made by a start with no participant: no row yet.
        const setup = await createTestNextly({
          adapter: (await adapterFor()) as never,
          plugins: [bystander],
        });
        await setup.destroy();
        const runner = {} as ParticipantRunner;
        addParticipant(runner, "plugin:@test/racing");
        const together = writingTogether();
        const first = await adapterFor();
        const second = await adapterFor();
        try {
          const owners = participatingOwners();
          const outcomes = await Promise.allSettled([
            recordParticipation(
              first,
              together(new MetaService(first, consoleLogger)),
              undefined,
              owners
            ),
            recordParticipation(
              second,
              together(new MetaService(second, consoleLogger)),
              undefined,
              owners
            ),
          ]);

          expect(outcomes.map(outcome => outcome.status)).toEqual([
            "fulfilled",
            "fulfilled",
          ]);
          expect(await storedParticipation(first)).toEqual({
            owners: ["plugin:@test/racing"],
            count: 1,
          });
        } finally {
          removeParticipant(runner);
          await first.disconnect().catch(() => undefined);
          await second.disconnect().catch(() => undefined);
        }
      },
      120_000
    );

    it("raises the count for a switch-off and a switch-back that both commit before the first is kept", async () => {
      const { plugin, seen } = participating();
      const adapter = await adapterFor();
      const t = await createTestNextly({
        adapter: adapter as never,
        collections: [posts],
        plugins: [plugin, bystander],
      });
      try {
        const before = await storedParticipation(t.adapter as never);
        const registry = getActiveHookRegistry();
        // Two reloads in a row, as the dev watcher runs them: the plugin off,
        // then on again, before the first one's write has landed.
        registry.setSuspendedOwners(["plugin:@test/address-participant"]);
        const off = queueParticipation(participatingOwners());
        registry.setSuspendedOwners([]);
        const on = queueParticipation(participatingOwners());
        await Promise.all([off, on]);

        expect(await storedParticipation(t.adapter as never)).toEqual({
          owners: ["plugin:@test/address-participant"],
          count: (before?.count ?? 0) + 2,
        });
        expect(seen.ctx).toBeDefined();
      } finally {
        await t.destroy();
      }
    }, 120_000);

    it("stays the same, and is not written, when every start runs with the same participants", async () => {
      const first = await start(true);
      const second = await start(true);

      expect(second.fingerprint).toBe(first.fingerprint);
      // The first start records the set; the second finds it unchanged.
      expect(first.sent.filter(writesParticipation)).not.toEqual([]);
      expect(second.sent.filter(writesParticipation)).toEqual([]);
    }, 120_000);
  }
);
