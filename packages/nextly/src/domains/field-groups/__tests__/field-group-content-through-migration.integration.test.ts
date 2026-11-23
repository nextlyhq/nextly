/**
 * A server that started before `migrate:field-groups --apply` and never restarts keeps its
 * field-group content through the migration and after it.
 *
 * The server is a process of its own (`helpers/content-server-child.ts`), booted on the legacy
 * site, because what a server remembers about storage names lives in its process: the
 * migrating process forgets what it resolved, and a server beside it in the same process would
 * be told to forget too, which no real server is. The migration runs here, and at each of its stop
 * points, and after it ends, the server is asked to read the group and to save it.
 *
 * What separates a correct server from a plausibly broken one:
 * - every read returns the group's content, never an empty group: a server still reading the
 *   legacy table would find it gone and read nothing;
 * - every save either succeeds, and is found afterwards under the current names, or is refused
 *   with `FIELD_GROUP_STORAGE_MOVING`, and then succeeds when retried as the refusal says: a server
 *   that wrote under a legacy name would leave its save where no reader looks;
 * - no legacy table or registry is left, and none is created again;
 * - and back: the same server, still never restarted, serves through a rollback (`--down`) the
 *   same way, and the run finishes though the server saves throughout it, in both directions.
 *
 * @module domains/field-groups/__tests__/field-group-content-through-migration.integration.test
 */
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

const loaded = vi.hoisted(() => ({ config: undefined as unknown }));
vi.mock("../../../cli/utils/config-loader", async importOriginal => ({
  ...(await importOriginal<
    typeof import("../../../cli/utils/config-loader")
  >()),
  loadConfig: async () => ({
    config: loaded.config,
    configPath: "/virtual/nextly.config.ts",
    dependencies: [],
  }),
}));

import { withStopPoints } from "../../schema/migrate/stop-points";
import {
  startScript,
  type Holder,
} from "../../schema/pipeline/__tests__/helpers/schema-lock-world";
import { getConfiguredTestDialects } from "../../../plugins/test-nextly";
import { perLanguageStorageEnabled } from "../../i18n/per-language-storage";

import { LIVE_COLLECTION, LIVE_DECLARED } from "./helpers/live-site-entities";
import {
  legacyObjects,
  openStorageGenerationSite,
  type StorageGenerationSite,
} from "./helpers/storage-generation-site";

const SERVER = join(__dirname, "helpers", "content-server-child.ts");

let site: StorageGenerationSite | undefined;
let server: Holder | undefined;

afterEach(async () => {
  server?.kill("SIGKILL");
  await server?.exited;
  server = undefined;
  await site?.close();
  site = undefined;
  vi.unstubAllEnvs();
});

let asked = 0;

/** Ask the server one request and wait for its answer line. */
async function ask(holder: Holder, request: string): Promise<string> {
  const id = `r${++asked}`;
  holder.send(`${id} ${request}`);
  const deadline = Date.now() + 60_000;
  for (;;) {
    const answer = holder.lines().find(line => line.startsWith(`${id} `));
    if (answer !== undefined) return answer.slice(id.length + 1);
    if (Date.now() > deadline) {
      throw new Error(`the server did not answer "${request}"`);
    }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
}

/** A read's answer as the group's heading, or the whole answer when it was not a read. */
async function readHeading(holder: Holder, id: string): Promise<unknown> {
  const answer = await ask(holder, `read ${id}`);
  if (!answer.startsWith("OK ")) return answer;
  const card = JSON.parse(answer.slice(3)) as { heading?: unknown } | null;
  return card?.heading ?? "(empty group)";
}

describe.each(getConfiguredTestDialects())(
  "a server started before the field-group storage migration (%s)",
  dialect => {
    it("reads every group's content and saves under the current names, through the migration and after it, without restarting", async () => {
      site = await openStorageGenerationSite({
        dialect,
        loaded,
        legacy: true,
        sqliteFile: true,
      });
      // The legacy site, with content in the group.
      const first = await site.developmentStart(LIVE_DECLARED);
      const created = await first.nextly.create({
        collection: LIVE_COLLECTION as never,
        data: { title: "P", card: { heading: "Kept" } } as never,
      });
      const id = (created.item as { id: string }).id;

      server = startScript(SERVER, [
        dialect,
        site.url!,
        perLanguageStorageEnabled() ? "on" : "off",
      ]);
      await server.printed("READY");
      // The control: before the migration the server reads the group.
      expect(await readHeading(server, id)).toBe("Kept");

      // At each stop point the run reaches, the server reads and saves.
      let expected = "Kept";
      let saves = 0;
      const atPoints: string[] = [];
      const visit = async (point: string) => {
        expect(await readHeading(server!, id), `read at ${point}`).toBe(
          expected
        );
        const heading = `saved-${++saves}`;
        const answer = await ask(server!, `save ${id} ${heading}`);
        if (answer === "OK") expected = heading;
        else {
          expect(answer, `save at ${point}`).toMatch(
            /^REFUSED FIELD_GROUP_STORAGE_MOVING /
          );
        }
        atPoints.push(point);
      };
      const outcome = await withStopPoints(visit, () => site!.migrateStorage());
      expect(outcome.ran).toBe(true);

      // After it ends, the same server, never restarted.
      expect(await readHeading(server, id), "read after the run").toBe(
        expected
      );
      let answer = await ask(server, `save ${id} after`);
      if (answer !== "OK") {
        expect(answer).toMatch(/^REFUSED FIELD_GROUP_STORAGE_MOVING /);
        answer = await ask(server, `save ${id} after`);
      }
      expect(answer, "a save after the run, retried as it says").toBe("OK");
      expect(await readHeading(server, id)).toBe("after");

      // A fresh start finds the last save under the current names, and no legacy object is left.
      const fresh = await site.developmentStart(LIVE_DECLARED);
      const read = await fresh.nextly.findByID({
        collection: LIVE_COLLECTION as never,
        id,
      });
      const item = ((read as { item?: unknown }).item ?? read) as {
        card?: { heading?: unknown };
      };
      expect(item.card?.heading).toBe("after");
      expect(await legacyObjects(site.adapter, dialect)).toEqual([]);
      const upPoints = atPoints.length;

      // And back: a rollback, the same server still never restarted, saving throughout it.
      expected = "after";
      const back = await withStopPoints(visit, () =>
        site!.migrateStorage({ direction: "down" })
      );
      expect(back.ran).toBe(true);
      expect(await readHeading(server, id), "read after the rollback").toBe(
        expected
      );
      answer = await ask(server, `save ${id} rolled-back`);
      if (answer !== "OK") {
        expect(answer).toMatch(/^REFUSED FIELD_GROUP_STORAGE_MOVING /);
        answer = await ask(server, `save ${id} rolled-back`);
      }
      expect(answer, "a save after the rollback, retried as it says").toBe(
        "OK"
      );
      expect(await readHeading(server, id)).toBe("rolled-back");

      // Both runs stopped where the server was asked, so "throughout" was more than before and
      // after, each way.
      expect(upPoints).toBeGreaterThan(2);
      expect(atPoints.length - upPoints).toBeGreaterThan(2);
    }, 300_000);
  }
);
