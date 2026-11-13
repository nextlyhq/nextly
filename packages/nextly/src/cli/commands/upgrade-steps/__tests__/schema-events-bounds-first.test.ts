/**
 * The upgrade step that moves the migration records reads its busy-table bounds before it changes
 * anything: a malformed `NEXTLY_LOCK_TIMEOUT` is refused with the database untouched, not after
 * the step has backfilled rows that a retry would write a second time.
 */
import { afterEach, describe, expect, it } from "vitest";

import type { UpgradeStepContext } from "../../upgrade-step";
import { schemaEventsStep } from "../schema-events";

/** Any use of the adapter or the database, which the step must not make before its bounds. */
const touched: string[] = [];
const untouchable = (name: string) =>
  new Proxy(
    {},
    {
      get: (_target, property) => {
        touched.push(`${name}.${String(property)}`);
        throw new Error(`${name} touched before the bounds were read`);
      },
    }
  );

const previous = process.env.NEXTLY_LOCK_TIMEOUT;
afterEach(() => {
  if (previous === undefined) delete process.env.NEXTLY_LOCK_TIMEOUT;
  else process.env.NEXTLY_LOCK_TIMEOUT = previous;
  touched.length = 0;
});

describe("the schema-events upgrade step", () => {
  it("refuses a malformed lock timeout before it reads or writes the database", async () => {
    process.env.NEXTLY_LOCK_TIMEOUT = "not-a-number";
    const context = {
      adapter: untouchable("adapter"),
      db: untouchable("db"),
      dialect: "postgresql",
      options: {},
      log: () => undefined,
      warn: () => undefined,
    } as unknown as UpgradeStepContext;

    await expect(schemaEventsStep.run(context)).rejects.toThrow(
      /NEXTLY_LOCK_TIMEOUT/
    );
    expect(touched).toEqual([]);
  });
});
