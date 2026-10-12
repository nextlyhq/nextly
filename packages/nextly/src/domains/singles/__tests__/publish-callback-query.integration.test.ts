/**
 * A Single's publish judges its held draft inside the write transaction, and
 * the application callbacks that judgement runs — a field's `access.update`
 * rule and a field's `validate` — can issue ordinary Nextly queries.
 *
 * Those queries do not receive the transaction. On a pool whose only
 * connection the transaction holds, such a query waits for a connection that
 * is released only when the transaction ends, so the publish cannot settle.
 *
 * Every case publishes the same held draft and records how the publish ended
 * and how long it took. A callback that does not query is the control: it
 * proves the fixture reaches the judgement, so a publish that settles is not
 * explained by a callback that never ran.
 */
import { afterEach, describe, expect, it } from "vitest";

import { defineSingle, text } from "../../../config";
import type { TextFieldConfig } from "../../../collections/fields/types/text";
import { requireNextly } from "../../../direct-api/nextly";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { SingleEntryService } from "../services/single-entry-service";

const SLUG = "prefs";
const BOSS = { id: "boss", email: "boss@x.test" };

/** How long a publish may take before it counts as not settling. */
const SETTLE_MS = 5_000;
/** How long the measurement waits before recording a publish as pending. */
const OBSERVE_MS = 20_000;

type Callback = "access" | "validate";

interface Probe {
  /** Set just before the publish, so saving the draft never queries. */
  armed: boolean;
  /** Whether an armed callback issues its query. */
  query: boolean;
  /** How many times an armed callback ran. */
  calls: number;
}

type Outcome =
  | { kind: "resolved"; success: boolean; statusCode?: number; ms: number }
  | { kind: "rejected"; error: string; ms: number }
  | { kind: "pending"; ms: number };

let current: TestNextly | undefined;

afterEach(async () => {
  const instance = current;
  current = undefined;
  if (!instance) return;
  // A publish still waiting on the pool keeps its transaction open, and
  // closing the pool then waits for it. Bounded so one stalled case does not
  // take the rest of the file with it.
  await Promise.race([
    instance.destroy().catch(() => {}),
    new Promise(resolve => setTimeout(resolve, 10_000)),
  ]);
});

async function readSingleOutsideTheWrite(): Promise<void> {
  await requireNextly().findSingle({ slug: SLUG, overrideAccess: true });
}

/**
 * The one field this case judges, carrying whichever callback it exercises.
 *
 * Typed as a field config rather than spread into the call, so each shape is
 * checked against what a text field accepts: an access rule answers whether the
 * write is allowed, a validator answers with `true` or the message to show.
 */
function guarded(
  callback: Callback,
  judged: () => Promise<void>
): Omit<TextFieldConfig, "type"> {
  if (callback === "access") {
    return {
      name: "guarded",
      access: {
        update: async (): Promise<boolean> => {
          await judged();
          return true;
        },
      },
    };
  }
  return {
    name: "guarded",
    validate: async (): Promise<true> => {
      await judged();
      return true;
    },
  };
}

async function boot(
  dialect: TestDialect,
  callback: Callback,
  probe: Probe
): Promise<SingleEntryService> {
  const judged = async (): Promise<void> => {
    if (!probe.armed) return;
    probe.calls += 1;
    if (probe.query) await readSingleOutsideTheWrite();
  };
  current = await createTestNextly({
    dialect,
    singles: [
      defineSingle({
        slug: SLUG,
        status: true,
        versions: { drafts: true },
        access: { read: () => true, update: () => true },
        fields: [text({ name: "siteName" }), text(guarded(callback, judged))],
      }),
    ],
  });
  return current.getService("singleEntryService");
}

async function publishHeldDraft(
  singles: SingleEntryService,
  probe: Probe
): Promise<Outcome> {
  await singles.update(
    SLUG,
    { siteName: "Live", guarded: "live", status: "published" },
    { overrideAccess: true }
  );
  const held = await singles.update(
    SLUG,
    { guarded: "edited" },
    { routeAuthorized: true, user: BOSS }
  );
  expect(held.success, JSON.stringify(held)).toBe(true);

  probe.armed = true;
  const started = Date.now();
  return Promise.race<Outcome>([
    singles
      .update(
        SLUG,
        { status: "published" },
        { routeAuthorized: true, user: BOSS }
      )
      .then(
        result => ({
          kind: "resolved",
          success: result.success,
          statusCode: result.statusCode,
          ms: Date.now() - started,
        }),
        (error: unknown) => ({
          kind: "rejected",
          error: error instanceof Error ? error.message : String(error),
          ms: Date.now() - started,
        })
      ),
    new Promise<Outcome>(resolve =>
      setTimeout(
        () => resolve({ kind: "pending", ms: Date.now() - started }),
        OBSERVE_MS
      )
    ),
  ]);
}

describe.each(getConfiguredTestDialects())(
  "a Single publish whose judgement callbacks query (%s)",
  dialect => {
    describe.each<Callback>(["access", "validate"])(
      "a field %s callback",
      callback => {
        it("publishes when the callback runs without querying", async () => {
          const probe: Probe = { armed: false, query: false, calls: 0 };
          const singles = await boot(dialect, callback, probe);

          const outcome = await publishHeldDraft(singles, probe);

          expect(probe.calls).toBeGreaterThan(0);
          expect(outcome).toMatchObject({ kind: "resolved", success: true });
        }, 60_000);

        it("settles a publish when the callback issues a Nextly query", async () => {
          const probe: Probe = { armed: false, query: true, calls: 0 };
          const singles = await boot(dialect, callback, probe);

          const outcome = await publishHeldDraft(singles, probe);

          expect(probe.calls, JSON.stringify(outcome)).toBeGreaterThan(0);
          expect(outcome.kind, JSON.stringify(outcome)).not.toBe("pending");
          expect(outcome.ms, JSON.stringify(outcome)).toBeLessThan(SETTLE_MS);
        }, 60_000);
      }
    );
  }
);
