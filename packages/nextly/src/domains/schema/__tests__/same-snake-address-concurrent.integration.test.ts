/**
 * Two saves at the same instant cannot both give a collection and a Single addresses with one
 * snake_case form, on every dialect.
 *
 * The one address rule refuses a collection or Single address whose snake_case form another
 * collection or Single already has (`team-updates` beside `team_updates`). Checked and then
 * written, that rule is only as good as what stops a second save from checking in between: the
 * two registries are separate tables, so no uniqueness constraint can hold the pair apart. What
 * holds it is the schema lock every such save takes, with the address judged inside it.
 *
 * Three kinds of case:
 * - One save after the other: a collection renamed onto a form a Single holds, and the reverse,
 *   is refused and moves nothing. The plainest form of the rule on the rename road.
 * - Many rounds, each on a fresh pair of addresses, with the two saves started in every order and
 *   spacing (`startBoth`): a collection create and a Single create through the Builder's own
 *   calls, in both spellings; a collection rename and a Single rename, through the registry
 *   services that rename; a collection rename and a Single create.
 * - A save of the other kind landing in the gap between a rename's start and its claim on the
 *   lock (`renameWithSaveLandingFirst`), which is what tells a rename that judges its new address
 *   inside the lock from one that judges it before.
 *
 * After each round exactly one entity holds the snake_case form, across both registries, and
 * nothing the other save would have written exists: no registry row under its address and no
 * table of its kind under the form. The other save is refused, never accepted: by the rule's own
 * refusal (`SLUG_SAME_SNAKE_CASE`) when it ran after the first, or by the lock's when the two
 * overlapped, which tells the editor to save again. That retry is made here too, and it meets
 * the rule's refusal, so the editor ends with the rule's message either way.
 *
 * Every save runs under `NODE_ENV=development`, where a Builder save applies its DDL and records
 * the entity at once, so a save that wrongly went through would leave a table and a row behind.
 */
// Set before the harness boots (env validation reads it once).
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { dispatchCollections } from "../../../dispatcher/handlers/collection-dispatcher";
import { dispatchSingles } from "../../../dispatcher/handlers/single-dispatcher";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { ServiceContainer } from "../../../services";
import { addressSnakeForm } from "../../../shared/address-rule";
import { DynamicCollectionRegistryService } from "../../dynamic-collections/services/dynamic-collection-registry-service";

/** Rounds per case: enough that the two saves overlap in some rounds and follow in others. */
const ROUNDS = 20;

const FIELDS = [{ name: "body", type: "text" }];

const silentLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

let t: TestNextly;

type Kind = "collection" | "single";

/** The table an entity of `kind` under `address` would have. */
const tableOf = (kind: Kind, address: string): string =>
  `${kind === "collection" ? "dc" : "single"}_${addressSnakeForm(address)}`;

/** A save's answer: accepted, or refused with a code. */
type Answer = { accepted: true } | { accepted: false; code: string };

/** The refusal codes a save beaten to the address may meet. */
const RULE_REFUSAL = "SLUG_SAME_SNAKE_CASE";
const LOCK_REFUSAL = "SERVICE_UNAVAILABLE";

/**
 * What a save answered. A refusal arrives thrown (a NextlyError, its per-field codes in
 * `publicData.errors`) or returned as a failed result; the rule's own code is looked for among
 * the per-field codes first, since the rule's refusal is a validation error carrying it.
 */
async function answerOf(save: () => Promise<unknown>): Promise<Answer> {
  let result: unknown;
  try {
    result = await save();
  } catch (error) {
    const e = error as {
      code?: string;
      publicData?: { errors?: { code?: string }[] };
    };
    const fieldCode = e.publicData?.errors?.find(item => item.code)?.code;
    return { accepted: false, code: String(fieldCode ?? e.code) };
  }
  const failed = result as {
    success?: boolean;
    code?: string;
    data?: { errors?: { code?: string }[] };
  } | null;
  if (failed && failed.success === false) {
    const fieldCode = failed.data?.errors?.find(item => item.code)?.code;
    return { accepted: false, code: String(fieldCode ?? failed.code) };
  }
  return { accepted: true };
}

/** A Builder create of `kind` under `address`. */
function create(kind: Kind, address: string): Promise<unknown> {
  if (kind === "collection") {
    return dispatchCollections(
      {} as ServiceContainer,
      "createCollection",
      {},
      { name: address, label: address, fields: FIELDS }
    );
  }
  return dispatchSingles(
    "createSingle",
    {},
    { slug: address, label: address, fields: FIELDS }
  );
}

/** A rename of `kind` from `from` to `to`, through the registry service that renames it. */
function rename(kind: Kind, from: string, to: string): Promise<unknown> {
  if (kind === "collection") {
    return new DynamicCollectionRegistryService(
      t.adapter as unknown as DrizzleAdapter,
      silentLogger
    ).updateCollectionMetadata(from, { slug: to });
  }
  return (
    t.getService("singleRegistryService") as unknown as {
      updateSingle(
        slug: string,
        data: Record<string, unknown>,
        options: { source: string }
      ): Promise<unknown>;
    }
  ).updateSingle(from, { slug: to }, { source: "ui" });
}

/** Every registry row, of either kind, whose address has `form` as its snake_case form. */
async function holdersOf(
  form: string
): Promise<{ kind: Kind; slug: string }[]> {
  const adapter = t.adapter as unknown as DrizzleAdapter;
  const holders: { kind: Kind; slug: string }[] = [];
  for (const [table, kind] of [
    ["dynamic_collections", "collection"],
    ["dynamic_singles", "single"],
  ] as const) {
    const rows = await adapter.executeQuery<{ slug: string }>(
      `SELECT slug FROM ${table}`
    );
    for (const row of rows) {
      if (addressSnakeForm(row.slug) === form)
        holders.push({ kind, slug: row.slug });
    }
  }
  return holders;
}

/** Run `work` under NODE_ENV=development, where a Builder save applies its DDL at once. */
async function inDevelopment<T>(work: () => Promise<T>): Promise<T> {
  const previous = process.env.NODE_ENV;
  vi.stubEnv("NODE_ENV", "development");
  try {
    return await work();
  } finally {
    vi.stubEnv("NODE_ENV", previous);
  }
}

interface Contender {
  kind: Kind;
  /** The address it gives its entity. */
  address: string;
  save(): Promise<unknown>;
}

interface Tally {
  /** Rounds where the beaten save met the lock: the two overlapped. */
  overlapped: number;
  /** Rounds where it met the rule: it ran after the first. */
  followed: number;
}

const pause = (ms: number) =>
  new Promise<void>(resolve => setTimeout(resolve, ms));

/**
 * How round `i` starts its two saves. In one process the save started first reaches the lock
 * first, so a fixed order would only ever test one kind winning; and two saves started together
 * always overlap, which never tests a save judged after the other has written. So the rounds
 * cycle through every order and spacing: together (either first), the second only once the first
 * has settled (either first), and the second a little later (either first), by a delay that
 * grows with the round so some land while the first still holds the lock and some just after.
 */
async function startBoth(
  i: number,
  a: () => Promise<Answer>,
  b: () => Promise<Answer>
): Promise<[Answer, Answer]> {
  const aFirst = i % 2 === 0;
  const [first, second] = aFirst ? [a, b] : [b, a];
  let answers: [Answer, Answer];
  switch (Math.floor(i / 2) % 3) {
    case 0:
      answers = await Promise.all([first(), second()]);
      break;
    case 1: {
      const one = await first();
      answers = [one, await second()];
      break;
    }
    default:
      answers = await Promise.all([first(), pause(5 * (i + 1)).then(second)]);
  }
  return aFirst ? answers : [answers[1], answers[0]];
}

/**
 * One round: start both saves as round `i` says, then hold the outcome to the rule. Returns which
 * refusal the beaten save met.
 */
async function round(
  i: number,
  a: Contender,
  b: Contender,
  label: string
): Promise<"overlapped" | "followed"> {
  const [answerA, answerB] = await startBoth(
    i,
    () => answerOf(() => a.save()),
    () => answerOf(() => b.save())
  );
  const form = addressSnakeForm(a.address);
  expect(addressSnakeForm(b.address), label).toBe(form);

  const accepted = [answerA, answerB].filter(answer => answer.accepted);
  expect(accepted, `${label}: exactly one save is accepted`).toHaveLength(1);

  const winner = answerA.accepted ? a : b;
  const loser = answerA.accepted ? b : a;
  const loserAnswer = (answerA.accepted ? answerB : answerA) as {
    accepted: false;
    code: string;
  };
  expect(
    [RULE_REFUSAL, LOCK_REFUSAL],
    `${label}: the beaten save's refusal`
  ).toContain(loserAnswer.code);

  // Exactly one entity holds the form, and it is the winner's.
  expect(await holdersOf(form), `${label}: one holder of '${form}'`).toEqual([
    { kind: winner.kind, slug: winner.address },
  ]);
  // Nothing the beaten save would have written: its kind's table under the form, unless the
  // winner is of the same kind and so holds that table itself.
  if (loser.kind !== winner.kind) {
    expect(
      await t.adapter.tableExists(tableOf(loser.kind, loser.address)),
      `${label}: no table for the beaten ${loser.kind}`
    ).toBe(false);
  }

  if (loserAnswer.code === LOCK_REFUSAL) {
    // The editor saves again, as the lock's refusal says to, and meets the rule.
    const retry = await answerOf(() => loser.save());
    expect(retry, `${label}: the retry meets the rule`).toEqual({
      accepted: false,
      code: RULE_REFUSAL,
    });
    expect(await holdersOf(form), `${label}: still one holder`).toEqual([
      { kind: winner.kind, slug: winner.address },
    ]);
    return "overlapped";
  }
  return "followed";
}

/**
 * Rename with another save landing in the gap between the rename's start and its claim on the
 * schema lock: the first transaction the rename opens is where the lock is claimed, and the other
 * save runs to the end before that transaction is let through. A rename that judged its new
 * address before claiming the lock has already passed by then and writes over the other save's
 * form; one that judges it inside the lock sees the other save and is refused. In one process
 * two saves almost never meet in that gap by chance, so it is made to happen here.
 */
async function renameWithSaveLandingFirst(
  renameSave: () => Promise<unknown>,
  landing: () => Promise<unknown>
): Promise<{ renamed: Answer; landed: Answer | undefined }> {
  const adapter = t.adapter as unknown as {
    transaction: (...args: unknown[]) => Promise<unknown>;
  };
  const real = adapter.transaction.bind(adapter);
  let landed: Answer | undefined;
  let armed = true;
  const spy = vi
    .spyOn(adapter, "transaction")
    .mockImplementation(async (...args: unknown[]) => {
      if (armed) {
        armed = false;
        landed = await answerOf(landing);
      }
      return real(...args);
    });
  try {
    const renamed = await answerOf(renameSave);
    return { renamed, landed };
  } finally {
    spy.mockRestore();
  }
}

describe.each(getConfiguredTestDialects())(
  "two saves to one snake_case address at once (%s)",
  dialect => {
    beforeEach(async () => {
      t = await createTestNextly(dialect === "sqlite" ? {} : { dialect });
    }, 120_000);

    afterEach(async () => {
      await t?.destroy();
      vi.unstubAllEnvs();
    });

    // The rename judges its new address inside the schema lock: a save of the other kind that
    // lands after the rename began, but before it holds the lock, is seen and the rename refused.
    it.each([
      [
        "a collection rename, a Single create landing first",
        "collection",
        "single",
      ],
      [
        "a Single rename, a collection create landing first",
        "single",
        "collection",
      ],
    ] as const)(
      "%s: the rename is refused and the form keeps one holder",
      async (_label, renamed, lander) => {
        await inDevelopment(async () => {
          expect(await answerOf(() => create(renamed, "gap-start"))).toEqual({
            accepted: true,
          });
          const target = renamed === "collection" ? "gap-target" : "gap_target";
          const landerAddress =
            renamed === "collection" ? "gap_target" : "gap-target";

          const { renamed: renameAnswer, landed } =
            await renameWithSaveLandingFirst(
              () => rename(renamed, "gap-start", target),
              () => create(lander, landerAddress)
            );

          // The other save did land in the gap, so the rename met it there.
          expect(landed, "the save landing first").toEqual({ accepted: true });
          expect(renameAnswer).toEqual({ accepted: false, code: RULE_REFUSAL });
          expect(await holdersOf("gap_target")).toEqual([
            { kind: lander, slug: landerAddress },
          ]);
          expect(await holdersOf("gap_start")).toEqual([
            { kind: renamed, slug: "gap-start" },
          ]);
        });
      },
      120_000
    );

    // The plainest form of the rule on the rename road, one save after the other: a rename onto a
    // snake_case form another kind already holds is refused, and nothing moves. Each kind is
    // renamed onto the other's form, so a rule that guarded only one registry fails one of them.
    it.each([
      ["a collection renamed onto a Single's form", "collection", "single"],
      ["a Single renamed onto a collection's form", "single", "collection"],
    ] as const)(
      "refuses %s, one after the other, and moves nothing",
      async (_label, renamed, holder) => {
        await inDevelopment(async () => {
          // The holder takes `sequence_held`; the renamed entity starts elsewhere and is asked to
          // move to the hyphenated spelling of that form.
          expect(await answerOf(() => create(holder, "sequence_held"))).toEqual(
            { accepted: true }
          );
          expect(
            await answerOf(() => create(renamed, "sequence-start"))
          ).toEqual({ accepted: true });

          expect(
            await answerOf(() =>
              rename(renamed, "sequence-start", "sequence-held")
            )
          ).toEqual({ accepted: false, code: RULE_REFUSAL });

          // The form keeps its one holder, and the renamed entity is where it was.
          expect(await holdersOf("sequence_held")).toEqual([
            { kind: holder, slug: "sequence_held" },
          ]);
          expect(await holdersOf("sequence_start")).toEqual([
            { kind: renamed, slug: "sequence-start" },
          ]);
        });
      },
      120_000
    );

    it.each([
      ["a collection with a hyphen, a Single with an underscore", "-", "_"],
      ["a collection with an underscore, a Single with a hyphen", "_", "-"],
    ])(
      "a collection create and a Single create: %s",
      async (_label, collectionSeparator, singleSeparator) => {
        const tally: Tally = { overlapped: 0, followed: 0 };
        await inDevelopment(async () => {
          for (let i = 0; i < ROUNDS; i++) {
            const collection = `team${collectionSeparator}updates${collectionSeparator}c${i}`;
            const single = `team${singleSeparator}updates${singleSeparator}c${i}`;
            tally[
              await round(
                i,
                {
                  kind: "collection",
                  address: collection,
                  save: () => create("collection", collection),
                },
                {
                  kind: "single",
                  address: single,
                  save: () => create("single", single),
                },
                `round ${i}`
              )
            ]++;
          }
        });
        expect(tally.overlapped + tally.followed).toBe(ROUNDS);
      },
      600_000
    );

    it("a collection rename and a Single rename", async () => {
      await inDevelopment(async () => {
        for (let i = 0; i < ROUNDS; i++) {
          const fromCollection = `rename-c${i}`;
          const fromSingle = `rename-s${i}`;
          expect(
            await answerOf(() => create("collection", fromCollection))
          ).toEqual({
            accepted: true,
          });
          expect(await answerOf(() => create("single", fromSingle))).toEqual({
            accepted: true,
          });
          const collection = `renamed-to-r${i}`;
          const single = `renamed_to_r${i}`;
          await round(
            i,
            {
              kind: "collection",
              address: collection,
              save: () => rename("collection", fromCollection, collection),
            },
            {
              kind: "single",
              address: single,
              save: () => rename("single", fromSingle, single),
            },
            `round ${i}`
          );
        }
      });
    }, 600_000);

    it("a collection rename and a Single create", async () => {
      await inDevelopment(async () => {
        for (let i = 0; i < ROUNDS; i++) {
          const fromCollection = `moving-c${i}`;
          expect(
            await answerOf(() => create("collection", fromCollection))
          ).toEqual({
            accepted: true,
          });
          const collection = `landing-x${i}`;
          const single = `landing_x${i}`;
          await round(
            i,
            {
              kind: "collection",
              address: collection,
              save: () => rename("collection", fromCollection, collection),
            },
            {
              kind: "single",
              address: single,
              save: () => create("single", single),
            },
            `round ${i}`
          );
        }
      });
    }, 600_000);
  }
);
