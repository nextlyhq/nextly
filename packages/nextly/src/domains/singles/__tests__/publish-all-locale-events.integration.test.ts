// Publishing every language of a Single tells each language's subscribers
// what a publish of that one language would have told them.
//
// A language already live whose pending change is promoted shows new content
// to its readers. The expectation is derived from a one-language publish of
// the same change, on a second Single in the same app, so the event's type is
// never hard-coded here. The plausible broken implementations emit a
// language's event only on its first publication, or build an event's prior
// state after the promotion, so the "before" a subscriber diffs against
// already holds the new values.

import { afterEach, describe, expect, it } from "vitest";

import {
  defineFieldGroup,
  defineSingle,
  fieldGroup,
  text,
} from "../../../config";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { snapshotRecord } from "../../versions/shared-publish-base";
import { VersionsRepository } from "../../versions/versions-repository";
import type { WebhookEvent } from "../../webhooks/types";
import type { SingleEntryService } from "../services/single-entry-service";

let current: TestNextly | undefined;
afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

/** Published one language at a time. */
const ONE = "preferences-one";
/** Published every language at once. */
const EVERY = "preferences-every";

function preferences(slug: string, withBanner = false) {
  return defineSingle({
    slug,
    localized: true,
    status: true,
    versions: { drafts: true },
    fields: [
      text({ name: "siteName", localized: true }),
      // Shared by every language: kept on the main row.
      text({ name: "tagline", localized: false }),
      // A component each language keeps its own copy of.
      ...(withBanner
        ? [fieldGroup({ name: "banner", component: "banner" })]
        : []),
    ],
  });
}

async function boot(
  dialect: TestDialect,
  extra: { withBanner?: boolean } = {}
): Promise<SingleEntryService> {
  current = await createTestNextly({
    dialect,
    ...(extra.withBanner
      ? {
          fieldGroups: [
            defineFieldGroup({
              slug: "banner",
              localized: true,
              fields: [text({ name: "heading" })],
            }),
          ],
        }
      : {}),
    singles: [
      preferences(ONE, extra.withBanner),
      preferences(EVERY, extra.withBanner),
    ],
    localization: { locales: ["en", "de", "fr"], defaultLocale: "en" },
  });
  return current.getService("singleEntryService");
}

/** A `nextly_events` row as read back. */
interface EventRow {
  id: string;
  type: string;
  payload: unknown;
}

/** The stored envelope; parsed on some dialects, a JSON string on others. */
function envelopeOf(row: EventRow): WebhookEvent {
  return (
    typeof row.payload === "string" ? JSON.parse(row.payload) : row.payload
  ) as WebhookEvent;
}

async function eventIds(): Promise<Set<string>> {
  const rows = await current!.adapter.select<EventRow>("nextly_events");
  return new Set(rows.map(row => row.id));
}

/** One event as a subscriber diffs it: its type, language and both sides. */
interface Seen {
  type: string;
  locale: string | undefined;
  data: unknown;
  previous: unknown;
}

/**
 * The events recorded for a Single since `before`, sorted so two publishes
 * compare whatever order the database returns them in. By id, not by
 * position: a select has no order on every dialect.
 */
async function eventsSince(
  before: ReadonlySet<string>,
  slug: string,
  field = "siteName"
): Promise<Seen[]> {
  const rows = await current!.adapter.select<EventRow>("nextly_events");
  return rows
    .filter(row => !before.has(row.id))
    .map(envelopeOf)
    .filter(
      event => event.resource.kind === "single" && event.resource.slug === slug
    )
    .map(event => ({
      type: event.type,
      locale: event.resource.locale,
      data: event.data[field],
      previous: event.previous?.[field],
    }))
    .sort((a, b) =>
      `${a.locale ?? ""}:${a.type}`.localeCompare(`${b.locale ?? ""}:${b.type}`)
    );
}

describe.each(getConfiguredTestDialects())(
  "publishing every language of a Single, as its subscribers see it (integration, %s)",
  dialect => {
    it("tells a live language's subscribers what a publish of that language alone tells them", async () => {
      const singles = await boot(dialect);
      for (const slug of [ONE, EVERY]) {
        for (const [locale, siteName] of [
          ["en", "Hello"],
          ["de", "Hallo"],
        ] as const) {
          const live = await singles.update(
            slug,
            { siteName, status: "published", _overwrite: true },
            { locale, overrideAccess: true }
          );
          expect(live.success, JSON.stringify(live)).toBe(true);
        }
        // English's pending change: held, not yet live.
        const held = await singles.update(
          slug,
          { siteName: "Hello again", _overwrite: true },
          { locale: "en", overrideAccess: true }
        );
        expect(held.success, JSON.stringify(held)).toBe(true);
      }
      const before = await eventIds();

      const alone = await singles.update(
        ONE,
        { status: "published", _overwrite: true },
        { locale: "en", overrideAccess: true }
      );
      expect(alone.success, JSON.stringify(alone)).toBe(true);
      const every = await singles.publishAllLocales(EVERY, {
        overrideAccess: true,
        data: { _overwrite: true },
      });
      expect(every.success, JSON.stringify(every)).toBe(true);

      // What the one-language publish tells English's subscribers: its new
      // content, against what its readers saw before. German's didn't change.
      const told = (await eventsSince(before, ONE)).filter(
        event => event.locale !== undefined
      );
      expect(told).toContainEqual(
        expect.objectContaining({
          locale: "en",
          data: "Hello again",
          previous: "Hello",
        })
      );
      expect(told.filter(event => event.locale === "de")).toEqual([]);

      const everyEvents = await eventsSince(before, EVERY);
      expect(everyEvents.filter(event => event.locale !== undefined)).toEqual(
        told
      );
      // The untagged event describes the default language, and its prior
      // state is the content readers saw before the publish too.
      const untagged = everyEvents.filter(
        event => event.locale === undefined && event.type === "single.updated"
      );
      expect(untagged).toEqual([
        {
          type: "single.updated",
          locale: undefined,
          data: "Hello again",
          previous: "Hello",
        },
      ]);
    });

    it("tells a language going live for the first time what a publish of that language alone tells it", async () => {
      const singles = await boot(dialect);
      for (const slug of [ONE, EVERY]) {
        const live = await singles.update(
          slug,
          { siteName: "Hello", status: "published", _overwrite: true },
          { locale: "en", overrideAccess: true }
        );
        expect(live.success, JSON.stringify(live)).toBe(true);
        // French: saved, never published.
        const saved = await singles.update(
          slug,
          { siteName: "Bonjour", _overwrite: true },
          { locale: "fr", overrideAccess: true }
        );
        expect(saved.success, JSON.stringify(saved)).toBe(true);
      }
      const before = await eventIds();

      const alone = await singles.update(
        ONE,
        { status: "published", _overwrite: true },
        { locale: "fr", overrideAccess: true }
      );
      expect(alone.success, JSON.stringify(alone)).toBe(true);
      const every = await singles.publishAllLocales(EVERY, {
        overrideAccess: true,
        data: { _overwrite: true },
      });
      expect(every.success, JSON.stringify(every)).toBe(true);

      const told = (await eventsSince(before, ONE)).filter(
        event => event.locale !== undefined
      );
      expect(told).toContainEqual(
        expect.objectContaining({ locale: "fr", data: "Bonjour" })
      );
      expect(
        (await eventsSince(before, EVERY)).filter(
          event => event.locale !== undefined
        )
      ).toEqual(told);
    });

    it("tells a language whose pending change creates its translation row what a publish of that language alone tells it", async () => {
      const singles = await boot(dialect);
      for (const slug of [ONE, EVERY]) {
        // Live through its shared values alone: no language has a
        // translation row of its own yet.
        const live = await singles.update(
          slug,
          { tagline: "Shared", status: "published", _overwrite: true },
          { overrideAccess: true }
        );
        expect(live.success, JSON.stringify(live)).toBe(true);
        // As on an install whose document was live before it was translated:
        // no translation row of its own for the default language.
        await current!.adapter.delete(
          `single_${slug.replaceAll("-", "_")}_locales`,
          { and: [{ column: "_locale", op: "=", value: "en" }] }
        );
        // English's first translated value, held as a pending change.
        const held = await singles.update(
          slug,
          { siteName: "Hello", _overwrite: true },
          { locale: "en", overrideAccess: true }
        );
        expect(held.success, JSON.stringify(held)).toBe(true);
      }
      const rows = await current!.adapter.select<{ _locale: string }>(
        "single_preferences_every_locales"
      );
      expect(rows.map(row => row._locale)).not.toContain("en");
      const before = await eventIds();

      const alone = await singles.update(
        ONE,
        { status: "published", _overwrite: true },
        { locale: "en", overrideAccess: true }
      );
      expect(alone.success, JSON.stringify(alone)).toBe(true);
      const every = await singles.publishAllLocales(EVERY, {
        overrideAccess: true,
        data: { _overwrite: true },
      });
      expect(every.success, JSON.stringify(every)).toBe(true);

      const told = (await eventsSince(before, ONE)).filter(
        event => event.locale !== undefined
      );
      expect(told).toContainEqual(
        expect.objectContaining({ locale: "en", data: "Hello" })
      );
      expect(
        (await eventsSince(before, EVERY)).filter(
          event => event.locale !== undefined
        )
      ).toEqual(told);
    });

    // The default language going live is told once. A draft document whose
    // default language's pending change creates its translation row goes live
    // through that row, so the language's tagged `published` is the
    // transition, and an untagged one beside it tells subscribers the same
    // publication twice. The plausible broken implementation decides the
    // untagged event from the translation rows stored before the publish,
    // which the default language has none of here.
    it("tells a draft document's default language going live once, when its pending change creates its row", async () => {
      const singles = await boot(dialect);
      const live = await singles.update(
        EVERY,
        { tagline: "Shared", status: "published", _overwrite: true },
        { overrideAccess: true }
      );
      expect(live.success, JSON.stringify(live)).toBe(true);
      await current!.adapter.delete("single_preferences_every_locales", {
        and: [{ column: "_locale", op: "=", value: "en" }],
      });
      const held = await singles.update(
        EVERY,
        { siteName: "Hello", _overwrite: true },
        { locale: "en", overrideAccess: true }
      );
      expect(held.success, JSON.stringify(held)).toBe(true);
      // Taken down outside the app while English's change is held: a draft
      // document whose default language has no translation row of its own.
      await current!.adapter.update(
        "single_preferences_every",
        { status: "draft" },
        { and: [{ column: "status", op: "=", value: "published" }] }
      );
      const before = await eventIds();

      const every = await singles.publishAllLocales(EVERY, {
        overrideAccess: true,
        data: { _overwrite: true },
      });
      expect(every.success, JSON.stringify(every)).toBe(true);

      const published = (await eventsSince(before, EVERY)).filter(
        event => event.type === "single.published"
      );
      expect(published).toEqual([
        expect.objectContaining({ locale: "en", data: "Hello" }),
      ]);
    });

    it("tells a language whose pending change creates its row what its components were before", async () => {
      const singles = await boot(dialect, { withBanner: true });
      for (const slug of [ONE, EVERY]) {
        for (const [locale, heading] of [
          ["en", "Live en"],
          ["de", "Live de"],
        ] as const) {
          const live = await singles.update(
            slug,
            {
              siteName: locale,
              banner: { heading },
              status: "published",
              _overwrite: true,
            },
            { locale, overrideAccess: true }
          );
          expect(live.success, JSON.stringify(live)).toBe(true);
        }
        // German's pending change edits its own component.
        const held = await singles.update(
          slug,
          { banner: { heading: "Pending de" }, _overwrite: true },
          { locale: "de", overrideAccess: true }
        );
        expect(held.success, JSON.stringify(held)).toBe(true);
        // As on an install whose translation row for German was never
        // written: its component rows stand, its translation row doesn't.
        await current!.adapter.delete(
          `single_${slug.replaceAll("-", "_")}_locales`,
          { and: [{ column: "_locale", op: "=", value: "de" }] }
        );
      }
      const rows = await current!.adapter.select<{ _locale: string }>(
        "single_preferences_every_locales"
      );
      expect(rows.map(row => row._locale)).not.toContain("de");
      const before = await eventIds();

      const alone = await singles.update(
        ONE,
        { status: "published", _overwrite: true },
        { locale: "de", overrideAccess: true }
      );
      expect(alone.success, JSON.stringify(alone)).toBe(true);
      const every = await singles.publishAllLocales(EVERY, {
        overrideAccess: true,
        data: { _overwrite: true },
      });
      expect(every.success, JSON.stringify(every)).toBe(true);

      const headingOf = (value: unknown) =>
        (value as { heading?: unknown } | null | undefined)?.heading ?? null;
      const tagged = async (slug: string) =>
        (await eventsSince(before, slug, "banner"))
          .filter(event => event.locale === "de")
          .map(event => ({
            type: event.type,
            data: headingOf(event.data),
            previous: headingOf(event.previous),
          }));
      const told = await tagged(ONE);
      expect(told).toContainEqual(
        expect.objectContaining({ data: "Pending de" })
      );
      expect(await tagged(EVERY)).toEqual(told);
    });

    it("reports the shared value a pending change put live, in its events and in the published version", async () => {
      const singles = await boot(dialect);
      for (const [locale, data] of [
        ["en", { siteName: "Hello", tagline: "Old" }],
        ["de", { siteName: "Hallo" }],
      ] as const) {
        const live = await singles.update(
          EVERY,
          { ...data, status: "published", _overwrite: true },
          { locale, overrideAccess: true }
        );
        expect(live.success, JSON.stringify(live)).toBe(true);
      }
      // German's pending change edits the shared field, held until published.
      const held = await singles.update(
        EVERY,
        { tagline: "New", _overwrite: true },
        { locale: "de", overrideAccess: true }
      );
      expect(held.success, JSON.stringify(held)).toBe(true);
      const read = async () => {
        const got = await singles.get(EVERY, {
          locale: "en",
          overrideAccess: true,
        });
        return ((got as { data?: unknown }).data ?? got) as Record<
          string,
          unknown
        >;
      };
      expect((await read()).tagline).toBe("Old");
      const before = await eventIds();

      const every = await singles.publishAllLocales(EVERY, {
        overrideAccess: true,
        data: { _overwrite: true },
      });
      expect(every.success, JSON.stringify(every)).toBe(true);
      const live = await read();
      expect(live.tagline).toBe("New");

      // What readers see now, against what they saw before, in every event.
      const events = await eventsSince(before, EVERY, "tagline");
      expect(events.filter(event => event.type === "single.updated")).toEqual([
        {
          type: "single.updated",
          locale: undefined,
          data: "New",
          previous: "Old",
        },
        {
          type: "single.updated",
          locale: "de",
          data: "New",
          previous: "Old",
        },
      ]);
      // The version the publish records holds the content it put live.
      const versions = new VersionsRepository(current!.adapter);
      const ref = {
        scopeKind: "single" as const,
        scopeSlug: EVERY,
        entryId: String(live.id),
      };
      const [newest] = await versions.listByDoc(ref, { limit: 1 });
      expect(newest?.status).toBe("published");
      const published = await versions.findByVersionNo(ref, newest!.versionNo!);
      expect(snapshotRecord(published?.snapshot).tagline).toBe("New");
    });
  }
);
