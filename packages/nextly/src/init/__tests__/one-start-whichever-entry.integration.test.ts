/**
 * A production start runs once, and runs the same statements, whichever entry
 * point begins it: the server's start-up hook, a request, or code calling the
 * Direct API, alone or several at once, on every configured dialect.
 *
 * The database is migrated for the configuration, as a deployment that ran
 * `nextly migrate`. Every statement is recorded at the driver
 * (`record-statements`) from the moment the start is begun until the start and
 * the work it leaves running have settled (`startSettled`), with one request
 * for a collection's entries made along the way, so each case sends the same
 * request's statements as well as the start's.
 *
 * The reference is the Direct API starting Nextly, followed by that request
 * once it has started, recorded after one start has already run, so both
 * recorded starts find the database as every later start does. The reference's
 * own way is compared too, as the control that the comparison is steady. Every other way of beginning the start must send the
 * same statements, the same number of times: a request alone that begins it,
 * the start-up hook with that request arriving at once, and the Direct API
 * with that request at once. A second start, or a part of one (seeding the
 * permissions and roles again, say), sends statements the reference does not,
 * and a start that skipped work sends fewer.
 *
 * Statements are compared by their text, in any order: a start's own values
 * (timestamps, generated ids) differ from one run to the next, and work the
 * start leaves running interleaves with the request.
 */

// Set before the harness boots (env validation reads it once).
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createScratchDatabase } from "../../__tests__/helpers/fresh-database";
import { recordStatements } from "../../__tests__/helpers/record-statements";
import {
  defineCollection,
  defineConfig,
  defineSingle,
  text,
} from "../../config";
import { createAdapter } from "../../database/factory";
import { shutdownServices } from "../../di/register";
import {
  createRegister,
  getNextly,
  shutdownNextly,
  startSettled,
} from "../../init";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
} from "../../plugins/test-nextly";
import { resetDispatcherForTests } from "../../route-handler/auth-handler";
import { createDynamicHandlers } from "../../routeHandler";
import { _resetEnvCache } from "../../shared/lib/env";
import { sanitizeConfig } from "../../shared/types/config";

const COLLECTIONS = [
  defineCollection({ slug: "osw", fields: [text({ name: "title" })] }),
];
const SINGLES = [
  defineSingle({ slug: "oswsite", fields: [text({ name: "title" })] }),
];
const CONFIG = defineConfig({ collections: COLLECTIONS, singles: SINGLES });

/** How each case begins the start, and when the request arrives. */
const ENTRIES = [
  // The control: the reference's own way, so a difference the comparison
  // finds is the entry point's, not a start that varies from run to run.
  "the Direct API, then the request",
  "a request alone",
  "the start-up hook, with the request at once",
  "the Direct API, with the request at once",
] as const;
type Entry = (typeof ENTRIES)[number];

/** A statement's text with its spacing made uniform, so only content differs. */
const normalized = (text: string): string => text.replace(/\s+/g, " ").trim();

/**
 * How many times each statement in `a` was sent beyond its count in `b`,
 * sorted, so a failure names what one start sent and the other did not.
 */
function surplus(a: readonly string[], b: readonly string[]): string[] {
  const left = new Map<string, number>();
  for (const text of b) left.set(text, (left.get(text) ?? 0) + 1);
  const extra: string[] = [];
  for (const text of a) {
    const remaining = left.get(text) ?? 0;
    if (remaining > 0) left.set(text, remaining - 1);
    else extra.push(text.slice(0, 160));
  }
  return extra.sort();
}

describe.each(getConfiguredTestDialects())(
  "one production start, whichever entry point begins it (%s)",
  (dialect: TestDialect) => {
    let url: string;
    let drop: () => Promise<void>;

    const adapterFor = (): Promise<DrizzleAdapter> =>
      createAdapter({ type: dialect, url } as Parameters<
        typeof createAdapter
      >[0]) as Promise<DrizzleAdapter>;

    /** Everything a start leaves behind in this process, taken down. */
    async function stopEverything(): Promise<void> {
      await shutdownNextly();
      await shutdownServices();
      resetDispatcherForTests();
    }

    beforeEach(async () => {
      if (dialect === "sqlite") {
        const dir = mkdtempSync(join(tmpdir(), "nextly-one-start-"));
        url = `file:${join(dir, "start.db")}`;
        drop = async () => rmSync(dir, { recursive: true, force: true });
      } else {
        const scratch = await createScratchDatabase(
          dialect,
          "nextly_one_start"
        );
        url = scratch.url;
        drop = scratch.drop;
      }
      // Every entry point opens the database the environment names, so each
      // case starts against the same database the same way.
      vi.stubEnv("DB_DIALECT", dialect);
      vi.stubEnv("DATABASE_URL", url);
      _resetEnvCache();
      // Migrated and seeded for the configuration, as a deployment that ran
      // `nextly migrate` and has started once before.
      const setup = await adapterFor();
      await createTestNextly({
        adapter: setup as never,
        collections: COLLECTIONS,
        singles: SINGLES,
      });
      await shutdownServices();
      await setup.disconnect();
    }, 180_000);

    afterEach(async () => {
      await stopEverything();
      vi.unstubAllEnvs();
      _resetEnvCache();
      await drop();
    });

    /** Every statement one production start sends, begun as `entry` says. */
    async function recordStart(entry: Entry): Promise<string[]> {
      vi.stubEnv("NODE_ENV", "production");
      // Only to find the driver to record on: the recorder is installed on the
      // driver's prototypes, so the start's own connections are recorded too.
      const probe = await adapterFor();
      const recorder = await recordStatements(probe, dialect);
      const config = sanitizeConfig(CONFIG) as never;
      const handlers = createDynamicHandlers({ config });
      const path = ["collections", "osw", "entries"];
      const request = () =>
        handlers.GET(new Request(`http://localhost/api/${path.join("/")}`), {
          params: Promise.resolve({ params: path }),
        });
      try {
        switch (entry) {
          case "the Direct API, then the request":
            await getNextly({ config });
            await request();
            break;
          case "a request alone":
            await request();
            break;
          case "the start-up hook, with the request at once":
            await Promise.all([
              createRegister(config, { cacheComponents: "true" })(),
              request(),
            ]);
            break;
          case "the Direct API, with the request at once":
            await Promise.all([getNextly({ config }), request()]);
            break;
        }
        await startSettled();
        return recorder.statements.map(normalized);
      } finally {
        recorder.uninstall();
        await probe.disconnect();
      }
    }

    it.each(ENTRIES)(
      "begun by %s, sends the same statements as the Direct API's start, each as often",
      async entry => {
        // A first production start after the setup may still write what the
        // setup left out; started once beforehand, the database is as every
        // later start finds it, so both recorded starts begin alike.
        await recordStart("the Direct API, then the request");
        await stopEverything();
        const reference = await recordStart("the Direct API, then the request");
        // The same database, as the next process to start finds it.
        await stopEverything();
        const begun = await recordStart(entry);

        // The fixture reaches the start: the reference sends statements.
        expect(reference.length).toBeGreaterThan(0);
        expect(
          {
            sentOnlyHere: surplus(begun, reference),
            missingHere: surplus(reference, begun),
          },
          `begun by ${entry}`
        ).toEqual({ sentOnlyHere: [], missingHere: [] });
      },
      180_000
    );
  }
);
