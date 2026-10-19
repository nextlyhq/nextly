/**
 * A Single's write paths record its history, on every dialect: its creation
 * (by its first write, or by the system on its first read), each save that
 * records a version, each publish and unpublish, and publishing every
 * language as one event that names them, each with who made it, in the
 * write's own transaction.
 */
import { afterEach, describe, expect, it } from "vitest";

import { defineSingle, text } from "../../../config";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

interface EventRow {
  id: string;
  subjectKind: string;
  subjectSlug: string | null;
  kind: string;
  actorKind: string;
  actorId: string | null;
  actorName: string | null;
  fromState: string | null;
  toState: string | null;
  versionNo: number | null;
}

const ANA = { id: "user-ana", name: "Ana", email: "ana@x.test", role: "admin" };

async function boot(dialect: TestDialect) {
  current = await createTestNextly({
    dialect,
    singles: [
      defineSingle({
        slug: "masthead",
        status: true,
        versions: true,
        fields: [text({ name: "heading" })],
      }),
      defineSingle({
        slug: "footer",
        versions: true,
        fields: [text({ name: "note" })],
      }),
      defineSingle({
        slug: "banner",
        localized: true,
        status: true,
        versions: true,
        fields: [text({ name: "headline", localized: true })],
      }),
    ],
    localization: { locales: ["en", "es"], defaultLocale: "en" },
  });
  const now = new Date();
  await current.adapter.insert("users", {
    id: ANA.id,
    email: ANA.email,
    name: ANA.name,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });
  const singles = current.getService("singleEntryService");
  /** This Single's events, oldest first, by their time-ordered ids. */
  const eventsOf = async (slug: string) =>
    (await current!.adapter.select<EventRow>("nextly_content_events"))
      .filter(row => row.subjectKind === "single" && row.subjectSlug === slug)
      .sort((a, b) => (a.id < b.id ? -1 : 1));
  const partsOf = async (eventId: string) =>
    (
      await current!.adapter.select<{ eventId: string; part: string }>(
        "nextly_content_event_parts"
      )
    )
      .filter(row => row.eventId === eventId)
      .map(row => row.part)
      .sort();
  return { singles, eventsOf, partsOf };
}

describe.each(getConfiguredTestDialects())(
  "a Single's history events (integration, %s)",
  dialect => {
    it("records its creation, saves, a publish and an unpublish, each by the person who made it", async () => {
      const t = await boot(dialect);
      const as = { overrideAccess: true, user: ANA };
      await t.singles.update("masthead", { heading: "a", status: "draft" }, as);
      await t.singles.update("masthead", { heading: "b" }, as);
      await t.singles.update("masthead", { status: "published" }, as);
      await t.singles.update("masthead", { status: "draft" }, as);

      const events = await t.eventsOf("masthead");
      const kinds = events.map(e => e.kind);
      expect(kinds[0]).toBe("created");
      expect(kinds.filter(k => k === "saved").length).toBeGreaterThanOrEqual(3);
      expect(events.filter(e => e.kind === "published")).toEqual([
        expect.objectContaining({ fromState: "draft", toState: "published" }),
      ]);
      expect(events.filter(e => e.kind === "unpublished")).toEqual([
        expect.objectContaining({ fromState: "published", toState: "draft" }),
      ]);
      for (const event of events) {
        expect(event).toMatchObject({
          actorKind: "person",
          actorId: ANA.id,
          actorName: "Ana",
        });
      }
    }, 120_000);

    it("records a Single the system created on its first read", async () => {
      const t = await boot(dialect);
      await t.singles.get("footer", { overrideAccess: true });

      expect(await t.eventsOf("footer")).toEqual([
        expect.objectContaining({
          kind: "created",
          actorKind: "system",
          actorId: null,
          actorName: null,
          versionNo: 1,
        }),
      ]);
    }, 120_000);

    it("records publishing every language as one event naming the languages it moved", async () => {
      const t = await boot(dialect);
      const as = { overrideAccess: true, user: ANA };
      await t.singles.update(
        "banner",
        { headline: "hello" },
        { ...as, locale: "en" }
      );
      await t.singles.update(
        "banner",
        { headline: "hola" },
        { ...as, locale: "es" }
      );
      await t.singles.publishAllLocales("banner", as);

      const publishes = (await t.eventsOf("banner")).filter(
        e => e.kind === "published"
      );
      expect(publishes).toHaveLength(1);
      expect(await t.partsOf(publishes[0]!.id)).toEqual(["en", "es"]);
      expect(publishes[0]).toMatchObject({ actorName: "Ana" });
    }, 120_000);
  }
);
