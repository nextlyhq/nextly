// Publishing every language of a Single: the main row's status and every
// companion `_status` move together, or not at all.
//
// The properties worth asserting are the ones that separate this from the
// plausible broken implementation — a loop of per-locale updates. That version
// passes "the document is published" and fails on: a refusal leaving some
// languages already live, a Single with no lifecycle demanding the publish
// permission, and a first-publication marker moved by a republish.

import { afterEach, describe, expect, it } from "vitest";

import { defineSingle, text } from "../../../config";
import {
  createTestNextly,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { SingleEntryService } from "../services/single-entry-service";

let current: TestNextly | undefined;
afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

/** A localized Single with the draft/published lifecycle. */
async function bootLocalized(): Promise<TestNextly> {
  current = await createTestNextly({
    singles: [
      // "settings" is a reserved slug (the system-resource permission-collision
      // guard), so this suite uses "preferences" as the neighbouring suites do.
      defineSingle({
        slug: "preferences",
        localized: true,
        status: true,
        fields: [
          text({ name: "siteName", localized: true }),
          text({ name: "region", localized: false }),
        ],
      }),
    ],
    localization: { locales: ["en", "de"], defaultLocale: "en" },
  });
  return current;
}

function singlesOf(t: TestNextly): SingleEntryService {
  // The type parameter names the registry KEY, so it is left to inference; the
  // return type is asserted by this signature instead.
  return t.getService("singleEntryService");
}

async function query(
  t: TestNextly,
  sql: string
): Promise<Record<string, unknown>[]> {
  const adapter = t.adapter as unknown as {
    executeQuery: (s: string) => Promise<unknown>;
  };
  const res = await adapter.executeQuery(sql);
  const rows = Array.isArray(res)
    ? res
    : ((res as { rows?: unknown[] }).rows ?? []);
  return rows as Record<string, unknown>[];
}

/** Every stored translation's `_status`, keyed by locale. */
async function companionStatuses(
  t: TestNextly
): Promise<Record<string, string>> {
  const rows = await query(
    t,
    'SELECT "_locale", "_status" FROM "single_preferences_locales"'
  );
  const out: Record<string, string> = {};
  for (const r of rows) out[String(r._locale)] = String(r._status);
  return out;
}

/**
 * The main row, or undefined when the Single has never been written.
 *
 * Read through the adapter rather than raw SQL so timestamps arrive as `Date`
 * whatever the dialect stores underneath — SQLite keeps them as unix SECONDS,
 * so a raw read compares a marker against a millisecond value and disagrees
 * with itself.
 */
async function mainRow(
  t: TestNextly
): Promise<Record<string, unknown> | undefined> {
  const rows = await t.adapter.select<Record<string, unknown>>(
    "single_preferences",
    {}
  );
  return rows[0];
}

/**
 * Write both languages, leaving `de` a draft.
 *
 * Writing through the real update path is what puts a companion row there:
 * a locale with no row has no per-locale status to move, so a suite that
 * seeded only the main row would assert publish-all over an empty companion
 * and pass whether or not it touches translations at all.
 */
async function seedBothLanguages(t: TestNextly): Promise<void> {
  const singles = singlesOf(t);
  await singles.update(
    "preferences",
    { siteName: "Prefs EN", region: "eu", status: "draft" },
    { locale: "en", overrideAccess: true }
  );
  await singles.update(
    "preferences",
    { siteName: "Prefs DE", status: "draft" },
    { locale: "de", overrideAccess: true }
  );
}

describe("publishAllLocales (singles)", () => {
  it("publishes every stored translation and the main row in one call", async () => {
    const t = await bootLocalized();
    await seedBothLanguages(t);

    // Precondition: both languages exist and neither is live. Without this the
    // assertion below is satisfied by a companion table that is simply empty.
    const before = await companionStatuses(t);
    expect(Object.keys(before).sort()).toEqual(["de", "en"]);
    expect(before.en).toBe("draft");
    expect(before.de).toBe("draft");

    const res = await singlesOf(t).publishAllLocales("preferences", {
      overrideAccess: true,
    });
    expect(res.success).toBe(true);

    const after = await companionStatuses(t);
    expect(after.en).toBe("published");
    expect(after.de).toBe("published");
    expect((await mainRow(t))?.status).toBe("published");
  });

  it("reports the write so the caller flushes its cache tag and drain", async () => {
    // `committed` and `revalidationIntent` are what the facade keys the
    // post-commit revalidation and retention pass off. A publish that moved a
    // row and reported neither would leave the Single's ISR tag stale.
    const t = await bootLocalized();
    await seedBothLanguages(t);

    const res = await singlesOf(t).publishAllLocales("preferences", {
      overrideAccess: true,
    });
    expect(res.committed).toBe(true);
    expect(res.revalidationIntent).toBeDefined();
  });

  it("stamps the first publication once and never moves it on a republish", async () => {
    const t = await bootLocalized();
    await seedBothLanguages(t);

    await singlesOf(t).publishAllLocales("preferences", {
      overrideAccess: true,
    });
    const published = await mainRow(t);
    expect(published?.first_published_at).toBeTruthy();

    // Move the marker to a date no clock in this test could produce, so a
    // rewrite is visible whatever resolution the dialect stores. Comparing the
    // publishes' own timestamps cannot do that: SQLite keeps this column at
    // SECOND resolution, so a republish moments later writes an identical value
    // and the assertion passes over exactly the regression it names.
    const seededMarker = new Date("2020-01-02T03:04:05.000Z");
    await t.adapter.update(
      "single_preferences",
      { first_published_at: seededMarker },
      { and: [{ column: "id", op: "=", value: published!.id as string }] }
    );

    // Take EVERY language back to draft before republishing. Leaving one live
    // would let the "document is already public" guard decline the stamp on its
    // own, so the assertion below would pass with the marker's own
    // already-set check removed — the clause this test exists for.
    await singlesOf(t).update(
      "preferences",
      { status: "draft" },
      { locale: "en", overrideAccess: true }
    );
    await singlesOf(t).update(
      "preferences",
      { status: "draft" },
      { locale: "de", overrideAccess: true }
    );
    expect(await companionStatuses(t)).toEqual({ en: "draft", de: "draft" });

    await singlesOf(t).publishAllLocales("preferences", {
      overrideAccess: true,
    });

    const secondMarker = (await mainRow(t))?.first_published_at;
    expect(new Date(secondMarker as string | number | Date).getTime()).toBe(
      seededMarker.getTime()
    );
  });

  it("records no first publication when a translation was already live", async () => {
    // The mixed state: a draft main row beside a language that has been public
    // since before this column existed. The main row's transition then LOOKS
    // like a first publication while the document was already reachable, so the
    // question asked is document-level rather than row-level. Dating it today
    // would report a publication that never happened.
    const t = await bootLocalized();
    await seedBothLanguages(t);

    // Publishing a NON-default language moves that companion row alone; the
    // main row keeps the default language's draft status and stamps nothing.
    await singlesOf(t).update(
      "preferences",
      { status: "published" },
      { locale: "de", overrideAccess: true }
    );
    expect((await companionStatuses(t)).de).toBe("published");
    expect((await mainRow(t))?.status).not.toBe("published");
    expect((await mainRow(t))?.first_published_at ?? null).toBeNull();

    await singlesOf(t).publishAllLocales("preferences", {
      overrideAccess: true,
    });

    expect((await mainRow(t))?.status).toBe("published");
    expect((await mainRow(t))?.first_published_at ?? null).toBeNull();
  });

  it("refuses without the publish rule and leaves every language untouched", async () => {
    // The separating property is not the 403 — it is that NOTHING moved. A
    // per-locale loop that checked the permission once and wrote as it went
    // would answer 403 having already published the languages it reached.
    current = await createTestNextly({
      singles: [
        defineSingle({
          slug: "preferences",
          localized: true,
          status: true,
          // Update is granted so the base gate passes and only the publish gate
          // can refuse; otherwise a 403 would prove nothing about publish.
          access: { update: () => true, publish: () => false },
          fields: [text({ name: "siteName", localized: true })],
        }),
      ],
      localization: { locales: ["en", "de"], defaultLocale: "en" },
    });
    const t = current;
    await singlesOf(t).update(
      "preferences",
      { siteName: "EN", status: "draft" },
      { locale: "en", overrideAccess: true }
    );
    await singlesOf(t).update(
      "preferences",
      { siteName: "DE", status: "draft" },
      { locale: "de", overrideAccess: true }
    );

    const res = await singlesOf(t).publishAllLocales("preferences", {
      user: { id: "user-1" },
      routeAuthorized: true,
    });
    expect(res.success).toBe(false);
    expect(res.statusCode).toBe(403);

    expect(await companionStatuses(t)).toEqual({ en: "draft", de: "draft" });
    expect((await mainRow(t))?.status).not.toBe("published");
  });

  it("answers not-found for a Single that has never been written", async () => {
    // Publishing must not be the act that materializes a document: a blank
    // auto-created row declared published would put an empty page live.
    const t = await bootLocalized();
    expect(await mainRow(t)).toBeUndefined();

    const res = await singlesOf(t).publishAllLocales("preferences", {
      overrideAccess: true,
    });
    expect(res.success).toBe(false);
    expect(res.statusCode).toBe(404);
    // Still nothing there — the refusal wrote no row.
    expect(await mainRow(t)).toBeUndefined();
  });

  it("no-ops on a Single with no draft/published lifecycle", async () => {
    // A Single with no `status` has nothing to publish, and must not demand
    // `publish-{slug}` for a call that changes nothing.
    current = await createTestNextly({
      singles: [
        defineSingle({
          slug: "preferences",
          fields: [text({ name: "region" })],
        }),
      ],
    });
    const t = current;
    await singlesOf(t).update(
      "preferences",
      { region: "eu" },
      { overrideAccess: true }
    );

    const res = await singlesOf(t).publishAllLocales("preferences", {
      overrideAccess: true,
    });
    expect(res.success).toBe(true);
    expect(res.message).toMatch(/nothing to publish/i);
    // Nothing moved, so nothing to revalidate or drain.
    expect(res.committed).not.toBe(true);
  });

  it("answers not-found for a slug that is not a Single", async () => {
    const t = await bootLocalized();
    const res = await singlesOf(t).publishAllLocales("no-such-single", {
      overrideAccess: true,
    });
    expect(res.success).toBe(false);
    expect(res.statusCode).toBe(404);
  });
});
