/**
 * What both two-instance specs check with: the note as an instance serves it,
 * a wait for it to change within a bound counted from the write, the warning
 * lines an instance logged, and the hooks that build and serve a leg once for
 * its checks and attach its logs to a check that fails.
 *
 * @module multi-instance/checks
 */
import { readFileSync } from "node:fs";

import { expect, test, type APIRequestContext } from "@playwright/test";

import {
  databaseUrl,
  startLeg,
  type Instance,
  type Leg,
  type Running,
} from "./instances";

/** The note as `instance` serves it. */
export async function noteOn(
  request: APIRequestContext,
  instance: Instance
): Promise<string | null> {
  const res = await request.get(`${instance.url}/api/note`);
  expect(res.status(), `GET /api/note on instance ${instance.name}`).toBe(200);
  return ((await res.json()) as { value: string | null }).value;
}

/**
 * Waits for `instance` to serve `value` no later than `boundMs` after `since`,
 * the write, and returns how long that took. The bound runs from the write,
 * not from this call: a check made after another, or after other work, gets
 * only what is left of it. Every answer before then may be the old value.
 */
export async function servedWithin(
  request: APIRequestContext,
  instance: Instance,
  value: string,
  since: number,
  boundMs: number,
  intervalMs = 250
): Promise<number> {
  const left = since + boundMs - Date.now();
  expect(
    left,
    `time left of the ${String(boundMs)} ms bound for instance ${instance.name}`
  ).toBeGreaterThan(0);
  await expect
    .poll(() => noteOn(request, instance), {
      message: `instance ${instance.name} serves ${value}`,
      timeout: left,
      intervals: [intervalMs],
    })
    .toBe(value);
  const took = Date.now() - since;
  // The poll's last answer can arrive after its timeout, so the bound is
  // asserted on the time itself.
  expect(
    took,
    `instance ${instance.name} served ${value} within ${String(boundMs)} ms of the write`
  ).toBeLessThanOrEqual(boundMs);
  return took;
}

/**
 * How many entries of `kind` an instance has logged. Nextly's logger writes
 * one JSON object per line, so a line counts when it parses and names the
 * kind, whatever its message says.
 */
export function loggedKind(instance: Instance, kind: string): number {
  let count = 0;
  for (const line of readFileSync(instance.logFile, "utf8").split("\n")) {
    if (!line.includes(kind)) continue;
    try {
      if ((JSON.parse(line) as { kind?: unknown }).kind === kind) count++;
    } catch {
      // Not one of the logger's lines.
    }
  }
  return count;
}

/**
 * Declares the leg's hooks in the current `describe`: it is built and served
 * once before its checks, which run in order, and stopped and removed after
 * them. A failed check gets every log the leg wrote. Returns the running leg,
 * for the checks to read.
 */
export function useLeg(leg: Leg): () => Running {
  const url = databaseUrl();
  test.describe.configure({ mode: "serial" });
  // Never skipped in CI: a job that ran nothing would read as a pass.
  test.skip(
    !url && !process.env.CI,
    "MULTI_INSTANCE_DATABASE_URL is unset; it names an empty Postgres test database"
  );

  let running: Running | undefined;

  test.beforeAll(async () => {
    if (!url) throw new Error("MULTI_INSTANCE_DATABASE_URL is unset");
    // A production build of the fixture, then two starts.
    test.info().setTimeout(12 * 60_000);
    running = await startLeg(leg, url);
  });

  test.afterAll(async () => {
    await running?.stop();
  });

  test.afterEach(async () => {
    const testInfo = test.info();
    if (testInfo.status === testInfo.expectedStatus || !running) return;
    for (const log of running.logs()) {
      let body = "(missing)";
      try {
        body = readFileSync(log.path, "utf8");
      } catch {
        // A log a step never wrote stays named, with nothing in it.
      }
      await testInfo.attach(log.name, { body, contentType: "text/plain" });
    }
  });

  return () => {
    if (!running) throw new Error(`leg ${leg.name} is not running`);
    return running;
  };
}

/** The kind of the warning an instance logs when Nextly's handlers do not serve it. */
export const NOT_SHARED_KIND = "cache-handlers-not-shared";
