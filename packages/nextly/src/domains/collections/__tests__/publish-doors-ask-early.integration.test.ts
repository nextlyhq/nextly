/**
 * Every door that publishes asks the publish gate before the work it guards, and names every part
 * it puts live.
 *
 * - Publishing every language of an entry or a Single through its own door (not the publish of
 *   chosen parts) asks the gate's early answer before the move runs any hook, so a publish the gate
 *   holds back runs none.
 * - A save that publishes one language of a document keeping its parts apart also puts a pending
 *   shared draft live, so the gate is told the shared part too, early and under the lock.
 *
 * The plausible broken implementations ask the gate only inside the move, after its hooks, and
 * name only the language a save writes.
 */
import { afterEach, expect, it } from "vitest";

import { container } from "../../../di/container";
import { defineCollection, defineSingle, text } from "../../../config";
import { describeEachDialect } from "../../../plugins/__tests__/helpers/dialect-matrix";
import {
  createTestNextly,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { CollectionsHandler } from "../../../services/collections-handler";
import type { SingleEntryService } from "../../singles/services/single-entry-service";
import type {
  PublishGate,
  PublishGateQuestion,
  PublishPart,
} from "../services/publish-gate";

describeEachDialect("every publishing door asks the gate in time", dialect => {
  let t: TestNextly | undefined;
  const hookCalls = { count: 0 };
  const countCall = () => {
    hookCalls.count += 1;
  };

  afterEach(async () => {
    await t?.destroy();
    t = undefined;
  });

  async function boot(): Promise<TestNextly> {
    t = await createTestNextly({
      dialect,
      perLanguageStorage: true,
      localization: { locales: ["en", "es"], defaultLocale: "en" },
      collections: [
        defineCollection({
          slug: "posts",
          localized: true,
          status: true,
          versions: { drafts: true },
          fields: [
            text({ name: "title" }),
            text({ name: "code", localized: false }),
          ],
          hooks: { beforeChange: [countCall], beforeOperation: [countCall] },
        }),
      ],
      singles: [
        defineSingle({
          slug: "notice",
          localized: true,
          status: true,
          versions: { drafts: true },
          fields: [
            text({ name: "title" }),
            text({ name: "code", localized: false }),
          ],
          hooks: { beforeChange: [countCall], beforeOperation: [countCall] },
        }),
      ],
    });
    return t;
  }

  /** A gate that records each question, holding every part back early where `refuseEarly`. */
  function gate(refuseEarly: boolean): {
    early: PublishGateQuestion[];
    judged: PublishGateQuestion[];
  } {
    const seen = {
      early: [] as PublishGateQuestion[],
      judged: [] as PublishGateQuestion[],
    };
    container.registerSingleton<PublishGate>("publishGate", () => ({
      refusals: question => {
        seen.early.push(question);
        return Promise.resolve(
          refuseEarly
            ? question.parts.map(part => ({
                part,
                code: "NOT_APPROVED" as const,
                message: "Waiting for approval.",
              }))
            : []
        );
      },
      judge: (_tx, question) => {
        seen.judged.push(question);
        return Promise.resolve({
          refusals: [],
          settle: () => Promise.resolve(),
        });
      },
    }));
    return seen;
  }

  const entries = () =>
    (
      t!.getService("collectionsHandler") as CollectionsHandler
    ).getEntryService();
  const singles = () =>
    t!.getService("singleEntryService") as SingleEntryService;

  function refusalOf(promise: Promise<unknown>): Promise<string> {
    return promise.then(
      result =>
        (result as { success?: boolean }).success === false
          ? JSON.stringify(result)
          : "",
      (error: unknown) =>
        `${String(error)} ${JSON.stringify((error as { publicData?: unknown }).publicData ?? null)}`
    );
  }

  const hasShared = (parts: readonly PublishPart[]) =>
    parts.some(part => part.kind === "shared");

  it("asks the gate before an entry's publish of every language runs any hook", async () => {
    await boot();
    const created = await entries().createEntry(
      { collectionName: "posts", overrideAccess: true, locale: "en" },
      { title: "Hello", code: "a" }
    );
    const id = (created.data as { id: string }).id;
    gate(true);
    hookCalls.count = 0;

    const refusal = await refusalOf(
      entries().publishAllLocales({
        collectionName: "posts",
        entryId: id,
        overrideAccess: true,
        data: { _overwrite: true },
      } as never)
    );

    expect(refusal).toMatch(/NOT_APPROVED/);
    expect(hookCalls.count).toBe(0);
  });

  it("asks the gate before a Single's publish of every language runs any hook", async () => {
    await boot();
    await singles().update(
      "notice",
      { title: "Hello", code: "a", _overwrite: true },
      { locale: "en", overrideAccess: true }
    );
    gate(true);
    hookCalls.count = 0;

    const refusal = await refusalOf(
      singles().publishAllLocales("notice", {
        overrideAccess: true,
        data: { _overwrite: true },
      } as never)
    );

    expect(refusal).toMatch(/NOT_APPROVED/);
    expect(hookCalls.count).toBe(0);
  });

  it("names the shared part when an entry's save publishing a language puts a shared draft live", async () => {
    await boot();
    const created = await entries().createEntry(
      { collectionName: "posts", overrideAccess: true, locale: "en" },
      { title: "Hello", code: "a", status: "published" }
    );
    const id = (created.data as { id: string }).id;
    const at = (locale: string) => ({
      collectionName: "posts",
      entryId: id,
      locale,
      overrideAccess: true,
    });
    await entries().updateEntry(at("es"), {
      title: "Hola",
      status: "published",
      _overwrite: true,
    });
    // A pending change to the shared part, and Spanish's own.
    await entries().updateEntry(at("es"), {
      title: "Hola 2",
      code: "b",
      _overwrite: true,
    });
    const seen = gate(false);

    await entries().updateEntry(at("es"), {
      status: "published",
      _overwrite: true,
    });

    expect(seen.early.length).toBeGreaterThan(0);
    expect(hasShared(seen.early[0]!.parts)).toBe(true);
    expect(hasShared(seen.judged[0]!.parts)).toBe(true);
  });

  it("names the shared part when a Single's save publishing a language puts a shared draft live", async () => {
    await boot();
    const save = (locale: string, data: Record<string, unknown>) =>
      singles().update(
        "notice",
        { ...data, _overwrite: true },
        { locale, overrideAccess: true }
      );
    await save("en", { title: "Hello", code: "a", status: "published" });
    await save("es", { title: "Hola", status: "published" });
    // A pending change to the shared part, and Spanish's own.
    await save("es", { title: "Hola 2", code: "b" });
    const seen = gate(false);

    await save("es", { status: "published" });

    expect(seen.early.length).toBeGreaterThan(0);
    expect(hasShared(seen.early[0]!.parts)).toBe(true);
    expect(hasShared(seen.judged[0]!.parts)).toBe(true);
  });
});
