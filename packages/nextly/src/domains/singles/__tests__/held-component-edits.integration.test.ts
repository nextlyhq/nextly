/**
 * A held edit to a published Single's component fields is kept, and published
 * when the Single is.
 *
 * A save that names no status on a published Single is held as its working
 * draft. Component values live in tables of their own, so a held save must
 * carry them in the draft, in the same shape a collection's draft holds them,
 * and the publish must write them from it.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  defineCollection,
  defineFieldGroup,
  defineSingle,
  fieldGroup,
  password,
  text,
} from "../../../config";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { forgetCompanionReadiness } from "../../i18n/runtime/companion-readiness";
import { VersionCaptureService } from "../../versions/version-capture-service";
import { VersionConflictError } from "../../versions/version-conflict";
import { VersionsRepository } from "../../versions/versions-repository";

let current: TestNextly | undefined;

afterEach(async () => {
  vi.restoreAllMocks();
  await current?.destroy();
  current = undefined;
});

type Row = {
  scopeSlug: string;
  versionNo: number | null;
  isAutosave: boolean | number;
  snapshot: unknown;
};

function parsed(snapshot: unknown): Record<string, unknown> {
  return (
    typeof snapshot === "string" ? JSON.parse(snapshot) : snapshot
  ) as Record<string, unknown>;
}

async function workingDraft(handle: TestNextly, slug: string) {
  const rows = (await handle.adapter.select<Row>("nextly_versions")).filter(
    r => r.scopeSlug === slug && r.versionNo === null && !r.isAutosave
  );
  expect(rows).toHaveLength(1);
  return parsed(rows[0].snapshot);
}

async function newestVersion(handle: TestNextly, slug: string) {
  const rows = (await handle.adapter.select<Row>("nextly_versions"))
    .filter(r => r.scopeSlug === slug && typeof r.versionNo === "number")
    .sort((a, b) => (b.versionNo ?? 0) - (a.versionNo ?? 0));
  return parsed(rows[0].snapshot);
}

/** A component value without the ids and timestamps its rows are given. */
function contentOf(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(contentOf);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(
        ([key]) =>
          ![
            "id",
            "created_at",
            "updated_at",
            "createdAt",
            "updatedAt",
          ].includes(key)
      )
      .map(([key, inner]) => [key, contentOf(inner)])
  );
}

const hero = () =>
  defineFieldGroup({
    slug: "hero",
    fields: [text({ name: "heading" }), text({ name: "subheading" })],
  });
const card = () =>
  defineFieldGroup({ slug: "card", fields: [text({ name: "label" })] });

async function bootSingle(dialect: TestDialect) {
  current = await createTestNextly({
    dialect,
    fieldGroups: [hero(), card()],
    singles: [
      defineSingle({
        slug: "home",
        status: true,
        versions: true,
        fields: [
          text({ name: "title" }),
          fieldGroup({ name: "hero", component: "hero" }),
          fieldGroup({ name: "cards", component: "card", repeatable: true }),
        ],
      }),
    ],
  });
  const singles = current.getService("singleEntryService");
  await singles.update(
    "home",
    {
      title: "T",
      hero: { heading: "Live", subheading: "Live sub" },
      cards: [{ label: "One" }],
      status: "published",
    },
    { overrideAccess: true }
  );
  return singles;
}

async function liveHome(handle: TestNextly) {
  const read = await handle
    .getService("singleEntryService")
    .get("home", { overrideAccess: true });
  return ((read as { data?: unknown }).data ?? read) as Record<string, unknown>;
}

describe.each(getConfiguredTestDialects())(
  "a held edit to a published Single's components (integration, %s)",
  dialect => {
    it("keeps a component-only save in the draft, and publishes it", async () => {
      const singles = await bootSingle(dialect);
      await singles.update(
        "home",
        { hero: { heading: "Pending", subheading: "Live sub" } },
        { overrideAccess: true }
      );

      const draft = await workingDraft(current!, "home");
      expect(contentOf(draft.hero)).toMatchObject({ heading: "Pending" });
      // Held: what readers see has not changed.
      expect(contentOf((await liveHome(current!)).hero)).toMatchObject({
        heading: "Live",
      });

      await singles.update(
        "home",
        { status: "published" },
        { overrideAccess: true }
      );
      expect(contentOf((await liveHome(current!)).hero)).toMatchObject({
        heading: "Pending",
      });
    });

    it("keeps a mixed save's scalar and component edits together", async () => {
      const singles = await bootSingle(dialect);
      await singles.update(
        "home",
        {
          title: "New title",
          hero: { heading: "Pending", subheading: "Live sub" },
        },
        { overrideAccess: true }
      );

      const draft = await workingDraft(current!, "home");
      expect(draft.title).toBe("New title");
      expect(contentOf(draft.hero)).toMatchObject({ heading: "Pending" });

      await singles.update(
        "home",
        { status: "published" },
        { overrideAccess: true }
      );
      const live = await liveHome(current!);
      expect(live.title).toBe("New title");
      expect(contentOf(live.hero)).toMatchObject({ heading: "Pending" });
    });

    it("replaces a repeatable component list whole", async () => {
      const singles = await bootSingle(dialect);
      await singles.update(
        "home",
        { cards: [{ label: "Two" }, { label: "Three" }] },
        { overrideAccess: true }
      );

      await singles.update(
        "home",
        { status: "published" },
        { overrideAccess: true }
      );
      const labels = (
        contentOf((await liveHome(current!)).cards) as {
          label: string;
        }[]
      ).map(c => c.label);
      expect(labels).toEqual(["Two", "Three"]);
    });

    it("records the component edit in the save's version", async () => {
      const singles = await bootSingle(dialect);
      await singles.update(
        "home",
        { hero: { heading: "Pending", subheading: "Live sub" } },
        { overrideAccess: true }
      );

      const version = await newestVersion(current!, "home");
      expect(contentOf(version.hero)).toMatchObject({ heading: "Pending" });
    });

    it("publishes a held component edit when every language is published at once", async () => {
      current = await createTestNextly({
        dialect,
        fieldGroups: [hero()],
        singles: [
          defineSingle({
            slug: "home",
            localized: true,
            status: true,
            versions: true,
            fields: [
              text({ name: "title", localized: true }),
              fieldGroup({ name: "hero", component: "hero" }),
            ],
          }),
        ],
        localization: { locales: ["en", "de"], defaultLocale: "en" },
      });
      const singles = current.getService("singleEntryService");
      await singles.update(
        "home",
        {
          title: "T",
          hero: { heading: "Live", subheading: "Live sub" },
          status: "published",
        },
        { locale: "en", overrideAccess: true }
      );
      await singles.update(
        "home",
        { hero: { heading: "Pending", subheading: "Live sub" } },
        { locale: "en", overrideAccess: true }
      );
      expect(
        contentOf((await workingDraft(current, "home")).hero)
      ).toMatchObject({ heading: "Pending" });

      const res = await singles.publishAllLocales("home", {
        overrideAccess: true,
      });
      expect(res.success).toBe(true);
      expect(contentOf((await liveHome(current)).hero)).toMatchObject({
        heading: "Pending",
      });
    });

    it("reports a publish-all's component change against the state before it", async () => {
      current = await createTestNextly({
        dialect,
        fieldGroups: [hero()],
        singles: [
          defineSingle({
            slug: "home",
            localized: true,
            status: true,
            versions: true,
            fields: [
              text({ name: "title", localized: true }),
              fieldGroup({ name: "hero", component: "hero" }),
            ],
          }),
        ],
        localization: { locales: ["en", "de"], defaultLocale: "en" },
      });
      const singles = current.getService("singleEntryService");
      await singles.update(
        "home",
        {
          title: "T",
          hero: { heading: "Live", subheading: "Live sub" },
          status: "published",
        },
        { locale: "en", overrideAccess: true }
      );
      await singles.update(
        "home",
        { hero: { heading: "Pending", subheading: "Live sub" } },
        { locale: "en", overrideAccess: true }
      );
      // By id, not by position: a select has no order on every dialect.
      const before = new Set(
        (await current.adapter.select<{ id: string }>("nextly_events")).map(
          r => r.id
        )
      );

      await singles.publishAllLocales("home", { overrideAccess: true });

      const recorded = (
        await current.adapter.select<{
          id: string;
          type: string;
          payload: unknown;
        }>("nextly_events")
      ).filter(r => !before.has(r.id));
      const envelope = recorded
        .map(
          r =>
            (typeof r.payload === "string"
              ? JSON.parse(r.payload)
              : r.payload) as {
              type?: string;
              previous?: Record<string, unknown> | null;
              changedFields?: string[];
              resource?: { locale?: string };
            }
        )
        .find(e => e.type === "single.updated" && !e.resource?.locale);
      expect(envelope).toBeDefined();
      expect(contentOf(envelope!.previous?.hero)).toMatchObject({
        heading: "Live",
      });
      expect(envelope!.changedFields).toContain("hero");
    });

    it("publishes a held translated component edit after a restart", async () => {
      current = await createTestNextly({
        dialect,
        fieldGroups: [
          defineFieldGroup({
            slug: "banner",
            localized: true,
            fields: [text({ name: "heading" })],
          }),
        ],
        singles: [
          defineSingle({
            slug: "home",
            localized: true,
            status: true,
            versions: true,
            fields: [
              text({ name: "title", localized: true }),
              fieldGroup({ name: "banner", component: "banner" }),
            ],
          }),
        ],
        localization: { locales: ["en", "de"], defaultLocale: "en" },
      });
      const singles = current.getService("singleEntryService");
      for (const locale of ["en", "de"]) {
        await singles.update(
          "home",
          {
            title: `T ${locale}`,
            banner: { heading: `Live ${locale}` },
            status: "published",
          },
          { locale, overrideAccess: true }
        );
      }
      await singles.update(
        "home",
        { banner: { heading: "Pending de" } },
        { locale: "de", overrideAccess: true }
      );
      // A restart: no readiness verdict is remembered for any companion.
      forgetCompanionReadiness(current.adapter);

      const res = await singles.publishAllLocales("home", {
        overrideAccess: true,
      });
      expect(res.success).toBe(true);
      const de = await singles.get("home", {
        locale: "de",
        overrideAccess: true,
      });
      expect(
        contentOf((de.data as Record<string, unknown>).banner)
      ).toMatchObject({ heading: "Pending de" });
    });

    it("judges a publish's own component value with the draft it promotes", async () => {
      // The hero may change only while the title is not locked. The held draft
      // locks it; the publish carries a hero change of its own. Judged without
      // that change, the promotion looks harmless and both go live together.
      current = await createTestNextly({
        dialect,
        fieldGroups: [hero()],
        singles: [
          defineSingle({
            slug: "home",
            status: true,
            versions: true,
            access: { read: () => true, update: () => true },
            fields: [
              text({ name: "title" }),
              fieldGroup({
                name: "hero",
                component: "hero",
                access: {
                  update: ({ data }) =>
                    (data as { title?: unknown } | undefined)?.title !==
                    "Locked",
                },
              }),
            ],
          }),
        ],
      });
      const singles = current.getService("singleEntryService");
      await singles.update(
        "home",
        {
          title: "Open",
          hero: { heading: "Live", subheading: "Live sub" },
          status: "published",
        },
        { overrideAccess: true }
      );
      await singles.update(
        "home",
        { title: "Locked" },
        { routeAuthorized: true, user: { id: "u1" } }
      );

      const res = await singles.update(
        "home",
        {
          hero: { heading: "Slipped in", subheading: "Live sub" },
          status: "published",
        },
        { routeAuthorized: true, user: { id: "u1" } }
      );
      expect(res.success).toBe(false);
      expect(contentOf((await liveHome(current)).hero)).toMatchObject({
        heading: "Live",
      });
    });

    it("holds no draft for a Single that is not localized but embeds a localized component", async () => {
      // The draft would be keyed with no language while the component keeps a
      // value per language. Such a Single saves live, as it did before drafts
      // held components, and no language's edit can land in another's.
      current = await createTestNextly({
        dialect,
        fieldGroups: [
          defineFieldGroup({
            slug: "banner",
            localized: true,
            fields: [text({ name: "heading" })],
          }),
        ],
        singles: [
          defineSingle({
            slug: "home",
            status: true,
            versions: true,
            fields: [
              text({ name: "title" }),
              fieldGroup({ name: "banner", component: "banner" }),
            ],
          }),
        ],
        localization: { locales: ["en", "de"], defaultLocale: "en" },
      });
      const singles = current.getService("singleEntryService");
      for (const locale of ["en", "de"]) {
        await singles.update(
          "home",
          {
            title: "T",
            banner: { heading: `Live ${locale}` },
            status: "published",
          },
          { locale, overrideAccess: true }
        );
      }
      await singles.update(
        "home",
        { banner: { heading: "Edited de" } },
        { locale: "de", overrideAccess: true }
      );

      const rows = await current.adapter.select<Row>("nextly_versions");
      expect(rows.filter(r => r.versionNo === null)).toHaveLength(0);

      const res = await singles.publishAllLocales("home", {
        overrideAccess: true,
      });
      expect(res.success).toBe(true);
      const heading = async (locale: string) =>
        (
          contentOf(
            (
              (await singles.get("home", { locale, overrideAccess: true }))
                .data as Record<string, unknown>
            ).banner
          ) as { heading?: unknown }
        ).heading;
      expect(await heading("en")).toBe("Live en");
      expect(await heading("de")).toBe("Edited de");
    });

    it("does not promote a draft the Single can no longer hold", async () => {
      // A draft stored before the schema made the Single ineligible: hidden
      // from every read, so a publish must not write its values over the
      // document the publisher saw.
      current = await createTestNextly({
        dialect,
        fieldGroups: [
          defineFieldGroup({
            slug: "banner",
            localized: true,
            fields: [text({ name: "heading" })],
          }),
        ],
        singles: [
          defineSingle({
            slug: "home",
            status: true,
            versions: true,
            fields: [
              text({ name: "title" }),
              text({ name: "note" }),
              fieldGroup({ name: "banner", component: "banner" }),
            ],
          }),
        ],
        localization: { locales: ["en", "de"], defaultLocale: "en" },
      });
      const singles = current.getService("singleEntryService");
      await singles.update(
        "home",
        { title: "T", note: "Live", status: "published" },
        { overrideAccess: true }
      );
      const live = (await liveHome(current)) as { id: string };
      await new VersionsRepository(
        current.adapter as unknown as ConstructorParameters<
          typeof VersionsRepository
        >[0]
      ).upsertWorkingDraft({
        ref: { scopeKind: "single", scopeSlug: "home", entryId: live.id },
        locale: null,
        snapshot: { title: "Stale", note: "Stale note" },
      });

      await singles.update(
        "home",
        { title: "New", status: "published" },
        { overrideAccess: true }
      );
      expect(await liveHome(current)).toMatchObject({
        title: "New",
        note: "Live",
      });
      const all = await singles.publishAllLocales("home", {
        overrideAccess: true,
      });
      expect(all.success).toBe(true);
      expect(await liveHome(current)).toMatchObject({
        title: "New",
        note: "Live",
      });
    });

    it("holds no draft for a Single whose component carries a password", async () => {
      // A draft cannot carry a password safely, so such a Single saves live
      // and its component saver hashes the password, as on any write.
      current = await createTestNextly({
        dialect,
        fieldGroups: [
          defineFieldGroup({
            slug: "account",
            fields: [text({ name: "label" }), password({ name: "secret" })],
          }),
        ],
        singles: [
          defineSingle({
            slug: "home",
            status: true,
            versions: true,
            fields: [
              text({ name: "title" }),
              fieldGroup({ name: "account", component: "account" }),
            ],
          }),
        ],
      });
      const singles = current.getService("singleEntryService");
      await singles.update(
        "home",
        { title: "T", account: { label: "L" }, status: "published" },
        { overrideAccess: true }
      );
      // The second save changes a field a version shows, as well as setting
      // the password: a password alone is never in a snapshot, so a save that
      // changes nothing else records no version.
      await singles.update(
        "home",
        { account: { label: "M", secret: "plain-text-secret" } },
        { overrideAccess: true }
      );

      const rows = await current.adapter.select<Row>("nextly_versions");
      expect(rows.filter(r => r.versionNo === null)).toHaveLength(0);
      // Recorded as live writes, so the absence below is of the secret itself.
      expect(rows.filter(r => typeof r.versionNo === "number").length).toBe(2);
      expect(JSON.stringify(rows.map(r => r.snapshot))).not.toContain(
        "plain-text-secret"
      );
    });

    it("lets a publisher denied a component publish a draft that leaves it alone", async () => {
      const BOSS = { id: "boss", email: "boss@x.test" };
      const CLERK = { id: "clerk", email: "clerk@x.test" };
      current = await createTestNextly({
        dialect,
        fieldGroups: [hero()],
        singles: [
          defineSingle({
            slug: "home",
            status: true,
            versions: true,
            access: { read: () => true, update: () => true },
            fields: [
              text({ name: "title" }),
              fieldGroup({
                name: "hero",
                component: "hero",
                access: { update: ({ req }) => req.user?.email === BOSS.email },
              }),
            ],
          }),
        ],
      });
      const singles = current.getService("singleEntryService");
      await singles.update(
        "home",
        {
          title: "T",
          hero: { heading: "Live", subheading: "Live sub" },
          status: "published",
        },
        { overrideAccess: true }
      );
      // The draft holds the live hero, untouched; only the title changes.
      await singles.update(
        "home",
        { title: "New title" },
        { routeAuthorized: true, user: BOSS }
      );

      const res = await singles.update(
        "home",
        { status: "published" },
        { routeAuthorized: true, user: CLERK }
      );
      expect(res.success, JSON.stringify(res)).toBe(true);
      expect((await liveHome(current)).title).toBe("New title");
    });

    it("judges each language's translated component edit before publishing every language", async () => {
      const BOSS = { id: "boss", email: "boss@x.test" };
      const CLERK = { id: "clerk", email: "clerk@x.test" };
      current = await createTestNextly({
        dialect,
        fieldGroups: [
          defineFieldGroup({
            slug: "banner",
            localized: true,
            fields: [text({ name: "heading" })],
          }),
        ],
        singles: [
          defineSingle({
            slug: "home",
            localized: true,
            status: true,
            versions: true,
            // Everyone may publish; only the heading's own rule tells the two
            // publishers apart.
            access: {
              read: () => true,
              update: () => true,
              publish: () => true,
            },
            fields: [
              text({ name: "title", localized: true }),
              // A translated component only one publisher may change.
              fieldGroup({
                name: "banner",
                component: "banner",
                access: { update: ({ req }) => req.user?.email === BOSS.email },
              }),
            ],
          }),
        ],
        localization: { locales: ["en", "de"], defaultLocale: "en" },
      });
      const singles = current.getService("singleEntryService");
      for (const locale of ["en", "de"]) {
        await singles.update(
          "home",
          {
            title: `T ${locale}`,
            banner: { heading: "Live" },
            status: "published",
          },
          { locale, overrideAccess: true }
        );
      }
      // English changes the guarded banner; German, saved after it, holds the
      // banner at its live value. Judged against German's value, English's
      // change looks like no change at all.
      await singles.update(
        "home",
        { banner: { heading: "Changed" } },
        { locale: "en", routeAuthorized: true, user: BOSS }
      );
      await singles.update(
        "home",
        { title: "T de edited" },
        { locale: "de", routeAuthorized: true, user: BOSS }
      );

      // A refusal either throws or comes back unsuccessful; both refuse.
      const res = await singles
        .publishAllLocales("home", { routeAuthorized: true, user: CLERK })
        .catch(() => ({ success: false }));
      expect(res.success).toBe(false);
      const en = await singles.get("home", {
        locale: "en",
        overrideAccess: true,
      });
      expect(
        contentOf((en.data as Record<string, unknown>).banner)
      ).toMatchObject({ heading: "Live" });
    });

    it("publishes the draft as it stands when the publish retries after a lost race", async () => {
      const singles = await bootSingle(dialect);
      await singles.update(
        "home",
        { hero: { heading: "First", subheading: "Live sub" } },
        { overrideAccess: true }
      );
      const handle = current!;
      const repo = new VersionsRepository(
        handle.adapter as unknown as ConstructorParameters<
          typeof VersionsRepository
        >[0]
      );
      const held = (
        await handle.adapter.select<Row & { entryId: string }>(
          "nextly_versions"
        )
      ).find(r => r.scopeSlug === "home" && r.versionNo === null)!;
      const ref = {
        scopeKind: "single" as const,
        scopeSlug: "home",
        entryId: held.entryId,
      };

      // The first attempt loses the version-number race and rolls back; before
      // the retry, another save moves the draft on. The retry must publish the
      // draft as it now stands, not the one the lost attempt read.
      vi.spyOn(
        VersionCaptureService.prototype,
        "capture"
      ).mockImplementationOnce(() => {
        throw new VersionConflictError();
      });
      const transaction = handle.adapter.transaction.bind(handle.adapter);
      let attempts = 0;
      vi.spyOn(handle.adapter, "transaction").mockImplementation((async (
        ...args: Parameters<typeof transaction>
      ) => {
        attempts += 1;
        if (attempts === 2) {
          const draft = parsed(
            (await repo.findWorkingDraft(ref, null))!.snapshot
          );
          (draft.hero as Record<string, unknown>).heading = "Second";
          await repo.upsertWorkingDraft({ ref, locale: null, snapshot: draft });
        }
        return transaction(...args);
      }) as typeof handle.adapter.transaction);

      await singles.update(
        "home",
        { status: "published" },
        { overrideAccess: true }
      );
      expect(attempts).toBeGreaterThanOrEqual(2);
      vi.restoreAllMocks();
      expect(contentOf((await liveHome(handle)).hero)).toMatchObject({
        heading: "Second",
      });
    });

    it("lets a publish's own component value win, sub-field by sub-field", async () => {
      const singles = await bootSingle(dialect);
      await singles.update(
        "home",
        { hero: { heading: "Pending", subheading: "Live sub" } },
        { overrideAccess: true }
      );

      await singles.update(
        "home",
        { hero: { subheading: "Sent with the publish" }, status: "published" },
        { overrideAccess: true }
      );
      expect(contentOf((await liveHome(current!)).hero)).toMatchObject({
        heading: "Pending",
        subheading: "Sent with the publish",
      });
    });

    it("holds the same component values in a Single's draft as in a collection's", async () => {
      current = await createTestNextly({
        dialect,
        fieldGroups: [hero(), card()],
        collections: [
          defineCollection({
            slug: "pages",
            status: true,
            versions: true,
            fields: [
              text({ name: "title" }),
              fieldGroup({ name: "hero", component: "hero" }),
            ],
          }),
        ],
        singles: [
          defineSingle({
            slug: "home",
            status: true,
            versions: true,
            fields: [
              text({ name: "title" }),
              fieldGroup({ name: "hero", component: "hero" }),
            ],
          }),
        ],
      });
      const live = { heading: "Live", subheading: "Live sub" };
      const edit = { heading: "Pending", subheading: "Live sub" };
      const pages = current.getService("collectionsHandler");
      const created = await pages.createEntry(
        { collectionName: "pages", overrideAccess: true },
        { title: "T", hero: live, status: "published" }
      );
      const id = (created.data as { id: string }).id;
      await pages.updateEntry(
        { collectionName: "pages", entryId: id, overrideAccess: true },
        { hero: edit }
      );
      const singles = current.getService("singleEntryService");
      await singles.update(
        "home",
        { title: "T", hero: live, status: "published" },
        { overrideAccess: true }
      );
      await singles.update("home", { hero: edit }, { overrideAccess: true });

      const collectionDraft = await workingDraft(current, "pages");
      const singleDraft = await workingDraft(current, "home");
      expect(contentOf(singleDraft.hero)).toEqual(
        contentOf(collectionDraft.hero)
      );
    });
  }
);
