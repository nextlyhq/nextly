/**
 * A save of a Single that names a status changes what readers see, so it is judged by the publish
 * gate as a publish of the Single's chosen parts is: early, again on the save's own transaction
 * once the Single's row is locked, and settled after the save is written, before it commits. A
 * save to one language, to the default language (whose save moves the shared part with it), and
 * to every language each ask it; an unpublish and a save without a status never do.
 *
 * The plausible broken implementation asks the gate only where a publish of chosen parts is
 * requested, so a save naming `status: "published"` puts a language live past a gate that holds
 * it back.
 */
import type { TransactionContext } from "@nextlyhq/adapter-drizzle/types";
import { afterEach, describe, expect, it, vi } from "vitest";

import { defineSingle, text } from "../../../config";
import { container } from "../../../di/container";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type {
  PublishGate,
  PublishGateQuestion,
} from "../../collections/services/publish-gate";
import type { SingleResult } from "../types";
import type { SingleEntryService } from "../services/single-entry-service";

let current: TestNextly | undefined;

afterEach(async () => {
  vi.restoreAllMocks();
  await current?.destroy();
  current = undefined;
});

const app = (): TestNextly => {
  if (!current) throw new Error("not booted");
  return current;
};

const NOTICE = "notice";

/** The Notice Single: translated, with a shared `code`, keeping drafts, in English and Spanish. */
async function boot(dialect: TestDialect): Promise<TestNextly> {
  current = await createTestNextly({
    dialect,
    localization: { locales: ["en", "es"], defaultLocale: "en" },
    singles: [
      defineSingle({
        slug: NOTICE,
        localized: true,
        status: true,
        versions: { drafts: true },
        fields: [
          text({ name: "title", localized: true }),
          text({ name: "code", localized: false }),
        ],
      }),
    ],
  });
  expect(current.adapter.dialect).toBe(dialect);
  return current;
}

function singles(): SingleEntryService {
  return app().getService("singleEntryService");
}

/** Saves `data` to the Notice in `locale`, trusted, over whatever is stored. */
function save(
  locale: string,
  data: Record<string, unknown>
): Promise<SingleResult> {
  return singles().update(
    NOTICE,
    { ...data, _overwrite: true },
    { locale, overrideAccess: true }
  );
}

/** What a reader of published content is served in `locale`. */
async function published(locale: string): Promise<Record<string, unknown>> {
  return (await app().nextly.findSingle({
    slug: NOTICE as never,
    locale,
    fallbackLocale: false,
  } as never)) as Record<string, unknown>;
}

/** The publishing state as stored: the Single's own status, and each language's `_status`. */
async function stored(): Promise<{
  main: unknown;
  languages: Record<string, unknown>;
}> {
  const [main] = await app().adapter.select<Record<string, unknown>>(
    `single_${NOTICE}`,
    {}
  );
  const rows = await app().adapter.select<Record<string, unknown>>(
    `single_${NOTICE}_locales`,
    {}
  );
  return {
    main: main?.status,
    languages: Object.fromEntries(
      rows.map(row => [String(row._locale), row._status])
    ),
  };
}

/** Each language's stored title, as its own row holds it. */
async function storedTitles(): Promise<Record<string, unknown>> {
  const rows = await app().adapter.select<Record<string, unknown>>(
    `single_${NOTICE}_locales`,
    {}
  );
  return Object.fromEntries(rows.map(row => [String(row._locale), row.title]));
}

/** The validation issue codes a refused save carries. */
function refusalCodes(result: SingleResult): (string | undefined)[] {
  return (result.errors ?? []).map(issue => issue.code);
}

/** English and Spanish saved, neither ever published. */
async function neverPublished(): Promise<void> {
  expect((await save("en", { title: "Hello", code: "N-1" })).success).toBe(
    true
  );
  expect((await save("es", { title: "Hola" })).success).toBe(true);
  expect(await stored()).toEqual({
    main: "draft",
    languages: { en: "draft", es: "draft" },
  });
}

/** English and Spanish both live. */
async function bothLive(): Promise<void> {
  await save("en", { title: "Hello", code: "N-1", status: "published" });
  await save("es", { title: "Hola", status: "published" });
  expect(await stored()).toEqual({
    main: "published",
    languages: { en: "published", es: "published" },
  });
}

/** What a gate saw: each question early and under the lock, the order of events, and the tx. */
interface Seen {
  early: PublishGateQuestion[];
  judged: PublishGateQuestion[];
  /** The transaction each verdict was asked on. */
  judgedOn: TransactionContext[];
  settled: number;
  /** Events in order: each transaction's row locks, each verdict and each settle. */
  events: string[];
  /** Stored statuses the settle read on the verdict's transaction, before commit. */
  atSettle: { main: unknown; es: unknown }[];
}

/**
 * A gate that holds back every part (early where `early` holds, else under the lock) unless the
 * publish is made without review. It records what it is asked, and at settle reads the Single on
 * the verdict's own transaction.
 */
function gate(holds: { early?: boolean; locked?: boolean } = {}): Seen {
  const seen: Seen = {
    early: [],
    judged: [],
    judgedOn: [],
    settled: 0,
    events: [],
    atSettle: [],
  };
  const held = (question: PublishGateQuestion, holding: boolean | undefined) =>
    holding === true && question.withoutReview === undefined
      ? question.parts.map(part => ({
          part,
          code: "NOT_APPROVED" as const,
          message: "Waiting for approval.",
        }))
      : [];
  container.registerSingleton<PublishGate>("publishGate", () => ({
    refusals: question => {
      seen.early.push(question);
      return Promise.resolve(held(question, holds.early));
    },
    judge: (tx, question) => {
      seen.judged.push(question);
      seen.judgedOn.push(tx);
      seen.events.push("judge");
      return Promise.resolve({
        refusals: held(question, holds.locked),
        settle: async () => {
          seen.settled += 1;
          seen.events.push("settle");
          const [main] = await tx.execute<{ status: unknown }>(
            `SELECT status FROM single_${NOTICE}`
          );
          const [es] = await tx.execute<{ s: unknown }>(
            `SELECT _status AS s FROM single_${NOTICE}_locales WHERE _locale = 'es'`
          );
          seen.atSettle.push({ main: main?.status, es: es?.s });
        },
      });
    },
  }));
  watchTransactions(seen);
  return seen;
}

/**
 * Wraps each transaction the adapter opens, so a row lock taken on it is recorded in order with
 * the gate's events, and the transaction a verdict is asked on can be matched to the save's own.
 */
const opened: unknown[] = [];
function watchTransactions(seen: Seen): void {
  opened.length = 0;
  const adapter = app().adapter;
  const original = adapter.transaction.bind(adapter);
  vi.spyOn(adapter, "transaction").mockImplementation(((
    work: (tx: TransactionContext) => Promise<unknown>,
    options?: unknown
  ) =>
    original((tx: TransactionContext) => {
      const watched = new Proxy(tx, {
        get(target, key) {
          const value = Reflect.get(target, key, target) as unknown;
          if (typeof value !== "function") return value;
          if (key === "lockRow") {
            return (...args: unknown[]) => {
              seen.events.push("lock");
              return (value as (...a: unknown[]) => unknown).apply(
                target,
                args
              );
            };
          }
          return (value as (...a: unknown[]) => unknown).bind(target);
        },
      });
      opened.push(watched);
      return work(watched);
    }, options as never)) as never);
}

describe.each(getConfiguredTestDialects())(
  "a Single's save that names a status asks the publish gate (%s)",
  dialect => {
    describe("held back", () => {
      it("is refused by the gate's early answer, and nothing is written", async () => {
        await boot(dialect);
        await neverPublished();
        const seen = gate({ early: true });

        const result = await save("es", {
          title: "Hola 2",
          status: "published",
        });

        expect(result.success).toBe(false);
        expect(refusalCodes(result)).toContain("NOT_APPROVED");
        expect(seen.early).toHaveLength(1);
        // Refused before the transaction: never judged, never settled.
        expect(seen.judged).toHaveLength(0);
        expect(seen.settled).toBe(0);
        expect(await stored()).toEqual({
          main: "draft",
          languages: { en: "draft", es: "draft" },
        });
        expect(await storedTitles()).toEqual({ en: "Hello", es: "Hola" });
      });

      it("is refused by the gate's verdict under the lock, and nothing is written", async () => {
        await boot(dialect);
        await neverPublished();
        const seen = gate({ locked: true });

        const result = await save("es", {
          title: "Hola 2",
          status: "published",
        });

        expect(result.success).toBe(false);
        expect(refusalCodes(result)).toContain("NOT_APPROVED");
        expect(seen.early).toHaveLength(1);
        expect(seen.judged).toHaveLength(1);
        expect(seen.settled).toBe(0);
        expect(await stored()).toEqual({
          main: "draft",
          languages: { en: "draft", es: "draft" },
        });
        expect(await storedTitles()).toEqual({ en: "Hello", es: "Hola" });
      });

      it("refuses every language's save held back early, and nothing goes live", async () => {
        await boot(dialect);
        await neverPublished();
        const seen = gate({ early: true });

        const result = await singles().update(
          NOTICE,
          { status: "published", _overwrite: true },
          { locale: "*", overrideAccess: true }
        );

        expect(result.success).toBe(false);
        expect(refusalCodes(result)).toContain("NOT_APPROVED");
        expect(seen.early[0]?.parts).toEqual([
          { kind: "language", locale: "en" },
          { kind: "language", locale: "es" },
          { kind: "shared" },
        ]);
        expect(seen.judged).toHaveLength(0);
        expect(await stored()).toEqual({
          main: "draft",
          languages: { en: "draft", es: "draft" },
        });
      });
    });

    describe("let through", () => {
      it("asks under the lock on the save's own transaction, and settles once after the write", async () => {
        await boot(dialect);
        await neverPublished();
        const seen = gate();

        const result = await save("es", { status: "published" });

        expect(result.success, JSON.stringify(result)).toBe(true);
        expect(seen.early).toHaveLength(1);
        expect(seen.judged).toHaveLength(1);
        expect(seen.judged[0]).toMatchObject({
          scope: { kind: "single", slug: NOTICE },
          direction: "publish",
          parts: [{ kind: "language", locale: "es" }],
          live: { languages: [], shared: false },
          caller: { kind: "trusted" },
        });
        // The verdict was asked on a transaction the save opened, after it locked the Single's row,
        // and settled once, after the write, on that same transaction before it committed.
        expect(opened).toContain(seen.judgedOn[0]);
        expect(seen.events.indexOf("lock")).toBeGreaterThanOrEqual(0);
        expect(seen.events.indexOf("lock")).toBeLessThan(
          seen.events.indexOf("judge")
        );
        expect(seen.events.filter(event => event === "settle")).toHaveLength(1);
        expect(seen.events.at(-1)).toBe("settle");
        expect(seen.atSettle).toEqual([{ main: "draft", es: "published" }]);
        expect(await stored()).toEqual({
          main: "draft",
          languages: { en: "draft", es: "published" },
        });
      });

      it("moves the shared part with the default language", async () => {
        await boot(dialect);
        await neverPublished();
        const seen = gate();

        const result = await save("en", { status: "published" });

        expect(result.success, JSON.stringify(result)).toBe(true);
        const parts = [{ kind: "language", locale: "en" }, { kind: "shared" }];
        expect(seen.early[0]?.parts).toEqual(parts);
        expect(seen.judged[0]?.parts).toEqual(parts);
        expect(seen.settled).toBe(1);
        expect(seen.atSettle[0]?.main).toBe("published");
      });

      it("asks every language and the shared part of a save to every language", async () => {
        await boot(dialect);
        await neverPublished();
        const seen = gate();

        const result = await singles().update(
          NOTICE,
          { status: "published", _overwrite: true },
          { locale: "*", overrideAccess: true }
        );

        expect(result.success, JSON.stringify(result)).toBe(true);
        const parts = [
          { kind: "language", locale: "en" },
          { kind: "language", locale: "es" },
          { kind: "shared" },
        ];
        expect(seen.early[0]?.parts).toEqual(parts);
        expect(seen.judged[0]?.parts).toEqual(parts);
        expect(seen.settled).toBe(1);
        expect(await stored()).toEqual({
          main: "published",
          languages: { en: "published", es: "published" },
        });
      });

      it("puts the held change live as before: readers see it, and the other language is unchanged", async () => {
        await boot(dialect);
        await bothLive();
        await save("es", { title: "Hola 2" });
        expect((await published("es")).title).toBe("Hola");
        const seen = gate();

        const result = await save("es", { status: "published" });

        expect(result.success, JSON.stringify(result)).toBe(true);
        expect(seen.judged[0]?.live).toEqual({
          languages: ["en", "es"],
          shared: true,
        });
        expect(seen.settled).toBe(1);
        expect(await published("es")).toMatchObject({
          title: "Hola 2",
          code: "N-1",
        });
        expect((await published("en")).title).toBe("Hello");
      });
    });

    describe("without review", () => {
      it("tells the gate early and under the lock, and stores nothing of it", async () => {
        await boot(dialect);
        await neverPublished();
        const seen = gate({ early: true, locked: true });

        const result = await save("es", {
          status: "published",
          withoutReview: { reason: "Correcting a date" },
        });

        expect(result.success, JSON.stringify(result)).toBe(true);
        expect(seen.early.map(question => question.withoutReview)).toEqual([
          { reason: "Correcting a date" },
        ]);
        expect(seen.judged.map(question => question.withoutReview)).toEqual([
          { reason: "Correcting a date" },
        ]);
        expect(seen.settled).toBe(1);
        expect((await stored()).languages.es).toBe("published");
        expect(result.data).not.toHaveProperty("withoutReview");
        expect(await published("es")).not.toHaveProperty("withoutReview");
        const versions = await app().adapter.select<Record<string, unknown>>(
          "nextly_versions",
          {}
        );
        expect(JSON.stringify(versions)).not.toContain("Correcting a date");
      });

      it("refuses a malformed one, asks nothing and writes nothing", async () => {
        await boot(dialect);
        await neverPublished();
        const seen = gate();

        const result = await save("es", {
          status: "published",
          withoutReview: { reason: "" },
        });

        expect(result.success).toBe(false);
        expect(refusalCodes(result)).toContain("INVALID_WITHOUT_REVIEW");
        expect(seen.early).toHaveLength(0);
        expect(seen.judged).toHaveLength(0);
        expect((await stored()).languages.es).toBe("draft");
      });
    });

    describe("never asked", () => {
      it("is not asked of an unpublish, and settles nothing", async () => {
        await boot(dialect);
        await bothLive();
        const seen = gate({ early: true, locked: true });

        const result = await save("es", { status: "draft" });

        expect(result.success, JSON.stringify(result)).toBe(true);
        expect(seen.early).toHaveLength(0);
        expect(seen.judged).toHaveLength(0);
        expect(seen.settled).toBe(0);
        expect(await stored()).toEqual({
          main: "published",
          languages: { en: "published", es: "draft" },
        });
      });

      it("is not asked of an unpublish of every language", async () => {
        await boot(dialect);
        await bothLive();
        const seen = gate({ early: true, locked: true });

        const result = await singles().update(
          NOTICE,
          { status: "draft", _overwrite: true },
          { locale: "*", overrideAccess: true }
        );

        expect(result.success, JSON.stringify(result)).toBe(true);
        expect(seen.early).toHaveLength(0);
        expect(seen.judged).toHaveLength(0);
        expect(seen.settled).toBe(0);
        expect(await stored()).toEqual({
          main: "draft",
          languages: { en: "draft", es: "draft" },
        });
      });

      it("is not asked of a save without a status", async () => {
        await boot(dialect);
        await neverPublished();
        const seen = gate({ early: true, locked: true });

        const result = await save("es", { title: "Hola 2" });

        expect(result.success, JSON.stringify(result)).toBe(true);
        expect(seen.early).toHaveLength(0);
        expect(seen.judged).toHaveLength(0);
        expect(seen.settled).toBe(0);
        expect((await storedTitles()).es).toBe("Hola 2");
      });
    });
  }
);
