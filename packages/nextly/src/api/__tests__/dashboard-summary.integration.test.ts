/**
 * The dashboard header's summary through the real catch-all handler, the real
 * permission decision and a real session: `GET /api/dashboard/summary`.
 *
 * `header-summary.test.ts` decides what each part says from what its source
 * answered. Neither is the request path: a part could be worded right there
 * and still be counted for a reader the card is never drawn for, or a source
 * the reader may not read could come back as a failure, which the admin words
 * as "something is unknown" for a reader who simply has nothing. Each case
 * runs on every dialect configured, each boot on a database of its own, so
 * the first user stored is always the super admin.
 */

// Set before the harness boots (env validation reads it once).
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildClaims } from "../../auth/jwt/claims";
import { signAccessToken } from "../../auth/jwt/sign";
import { defineCollection, text } from "../../config";
import {
  RELEASE_MEMBERS_TABLE,
  RELEASES_TABLE,
} from "../../domains/releases/release-tables";
import { releaseMemberKey } from "../../domains/releases/release-member-key";
import {
  clearAttentionItems,
  registerAttentionItems,
} from "../../domains/widgets/attention/items";
import { needsAttentionWidget } from "../../domains/widgets/core-widgets/needs-attention";
import type { AttentionItem } from "../../domains/widgets/declaration/dashboard";
import { defineWidget } from "../../domains/widgets/declaration/define-widget";
import { setting } from "../../domains/widgets/declaration/setting-builders";
import { clearSources } from "../../domains/widgets/sources";
import { definePlugin } from "../../plugins/plugin-context";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestNextly,
} from "../../plugins/test-nextly";
import { createDynamicHandlers } from "../../routeHandler";
import { ServiceContainer } from "../../services";
import { registerAttentionWidgetSource } from "../../services/dashboard/attention-source";
import type { CollectionsHandler } from "../../services/collections-handler";
import { WidgetLayoutService } from "../../services/widgets/widget-layout-service";
import { sanitizeConfig } from "../../shared/types/config";

const INBOX = "inbox";
const NEW = { where: { state: { equals: "new" } } };

const inbox = defineCollection({
  slug: INBOX,
  fields: [text({ name: "state" })],
});

/** Entries a release will publish. */
const DRAFTED = "drafted";
const drafted = defineCollection({
  slug: DRAFTED,
  status: true,
  versions: { drafts: true },
  fields: [text({ name: "title" })],
});

const forms = definePlugin({
  name: "@test/forms",
  version: "1.0.0",
  nextly: ">=0.0.1",
  contributes: {
    collections: [inbox],
    dashboard: {
      widgets: [
        // The new submissions, counted for the header as the person asking.
        defineWidget({
          id: "acme/inbox",
          title: "Inbox",
          description: "Submissions waiting for a reply",
          category: "Forms",
          size: { default: { w: 6, h: 3 } },
          access: `read-${INBOX}`,
          // The card and the header count one question, each as the reader.
          load: async ({ services }) => ({
            total: await services.count(INBOX, NEW),
          }),
          view: "figure",
          summary: {
            label: "new submissions",
            count: async ({ services }) => services.count(INBOX, NEW),
          },
        }),
        // Placed any number of times, each card shown or not by its own
        // setting: the header counts it for the first card that is shown.
        defineWidget({
          id: "acme/replies",
          title: "Replies",
          description: "Submissions waiting for a reply, where a card asks",
          category: "Forms",
          size: { default: { w: 6, h: 3 } },
          several: true,
          settings: {
            open: setting.checkbox({ label: "Open", defaultValue: true }),
          },
          shows: ({ settings }) => settings.open,
          load: async ({ services }) => ({
            total: await services.count(INBOX, NEW),
          }),
          view: "figure",
          summary: {
            label: "replies owed",
            count: async ({ services }) => services.count(INBOX, NEW),
          },
        }),
      ],
    },
  },
});

function handlers(admin?: Record<string, unknown>) {
  return createDynamicHandlers({
    config: sanitizeConfig({
      collections: [],
      plugins: [forms],
      ...(admin === undefined ? {} : { admin }),
    }),
  });
}

let handle: TestNextly | undefined;
/** The instance's first user: its super admin, who may read the inbox. */
let ownerId: string | undefined;
/** A second person, holding no role at all. */
let otherId: string | undefined;

describe.each(getConfiguredTestDialects())("on %s", dialect => {
  beforeEach(async () => {
    handle = await createTestNextly({
      dialect,
      collections: [drafted],
      plugins: [forms],
    });
    clearSources();
    ownerId = await userNamed("owner");
    otherId = await userNamed("other");
  });

  afterEach(async () => {
    clearSources();
    clearAttentionItems();
    await handle?.destroy();
    handle = undefined;
    ownerId = undefined;
    otherId = undefined;
  });

  async function userNamed(name: string): Promise<string> {
    const nextly = handle!.nextly as unknown as {
      users: {
        create: (a: { data: Record<string, unknown> }) => Promise<{
          item: { id: string };
        }>;
      };
    };
    const created = await nextly.users.create({
      data: {
        email: `${name}@example.com`,
        password: "Password123!",
        name,
        isActive: true,
      },
    });
    return created.item.id;
  }

  /** Two new submissions and one answered. */
  async function seedInbox(): Promise<void> {
    for (const state of ["new", "new", "answered"]) {
      await handle!.nextly.create({ collection: INBOX, data: { state } });
    }
  }

  /** Stores `userId`'s own dashboard: one card of the inbox widget. */
  async function placeInbox(userId: string): Promise<void> {
    await place(userId, [
      { id: "inbox-card", widgetId: "acme/inbox", w: 6, h: 3, removed: false },
    ]);
  }

  /** Stores `userId`'s own dashboard: exactly the cards given, in order. */
  async function place(
    userId: string,
    placements: {
      id: string;
      widgetId: string;
      w: number;
      h: number;
      removed: boolean;
      config?: Record<string, unknown>;
    }[]
  ): Promise<void> {
    const silent = { debug() {}, info() {}, warn() {}, error() {} };
    await new WidgetLayoutService(handle!.adapter, silent).saveLayout(
      "user",
      userId,
      placements,
      0
    );
  }

  /** A published entry of the drafted collection, its id. */
  async function publishedEntry(title: string): Promise<string> {
    const handler = handle!.getService(
      "collectionsHandler"
    ) as CollectionsHandler;
    const created = await handler.createEntry(
      { collectionName: DRAFTED, overrideAccess: true },
      { title, status: "published" }
    );
    const id = (created.data as { id?: string } | undefined)?.id;
    expect(typeof id, "the entry must be created").toBe("string");
    return id!;
  }

  /** A scheduled release at `at` that publishes `entryId`. */
  async function releaseAt(at: Date, entryId: string): Promise<void> {
    const id = crypto.randomUUID();
    const now = new Date();
    await handle!.adapter.insert(RELEASES_TABLE, {
      id,
      title: `Release ${id.slice(0, 8)}`,
      description: null,
      scheduledAt: at,
      timezone: "UTC",
      state: "scheduled",
      publishedAt: null,
      createdBy: null,
      createdAt: now,
      updatedAt: now,
      revision: 0,
    });
    const ref = {
      scopeKind: "collection" as const,
      scopeSlug: DRAFTED,
      entryId,
      locale: null,
    };
    await handle!.adapter.insert(RELEASE_MEMBERS_TABLE, {
      id: crypto.randomUUID(),
      releaseId: id,
      ...ref,
      action: "publish",
      memberKey: releaseMemberKey(id, ref),
      createdBy: null,
      createdAt: now,
    });
  }

  /** One batch entry's slot, as the dashboard's own query answers it for `cookie`. */
  async function slotFor(cookie: string, entry: unknown): Promise<unknown> {
    const response = await handlers().POST(
      new Request("http://localhost/api/dashboard/query", {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ queries: [entry] }),
      }),
      { params: Promise.resolve({ params: ["dashboard", "query"] }) }
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { results: unknown[] };
    return body.results[0];
  }

  /** Gives `userId` a role holding exactly the grants named. */
  async function grantRole(userId: string, slugs: string[]): Promise<void> {
    const nextly = handle!.nextly as unknown as {
      permissions: {
        find: (a: { limit: number }) => Promise<{
          items: { id: string; slug: string }[];
        }>;
      };
      roles: {
        create: (a: { data: Record<string, unknown> }) => Promise<{
          item: { id: string };
        }>;
      };
    };
    const permissions = await nextly.permissions.find({ limit: 300 });
    const ids = slugs.map(slug => {
      const found = permissions.items.find(p => p.slug === slug);
      expect(found, `\`${slug}\` must be seeded`).toBeDefined();
      return found!.id;
    });
    const role = await nextly.roles.create({
      data: {
        name: `Role ${slugs.join(" ")}`,
        slug: `r-${slugs.join("-")}`,
        permissionIds: ids,
      },
    });
    const assigned = await new ServiceContainer(
      handle!.adapter
    ).userRoles.assignRoleToUser(userId, role.item.id);
    expect(assigned.success).toBe(true);
  }

  /** The inbox card's answer, as the dashboard's own query reads it for `cookie`. */
  async function cardAnswer(cookie: string): Promise<unknown> {
    return slotFor(cookie, { widget: "acme/inbox", card: "inbox-card" });
  }

  /** A signed-in person's session cookie, as the admin's own requests carry it. */
  async function sessionOf(userId: string): Promise<string> {
    const token = await signAccessToken(
      buildClaims({
        userId,
        email: `${userId}@example.com`,
        name: userId,
        image: null,
        roleIds: [],
        sessionEpoch: 0,
      }),
      process.env.NEXTLY_SECRET!
    );
    return `nextly_session=${token}`;
  }

  async function summaryRequest(
    cookie: string | undefined,
    admin?: Record<string, unknown>
  ): Promise<Response> {
    return handlers(admin).GET(
      new Request("http://localhost/api/dashboard/summary", {
        headers: cookie === undefined ? {} : { cookie },
      }),
      { params: Promise.resolve({ params: ["dashboard", "summary"] }) }
    );
  }

  describe("GET /api/dashboard/summary", () => {
    it("refuses a request with no session, naming nothing", async () => {
      const response = await summaryRequest(undefined);
      expect(response.status).toBe(401);
      expect(await response.text()).not.toContain("new submissions");
    });

    it("counts a widget's summary as the reader, for the card on their dashboard, privately", async () => {
      await seedInbox();
      await placeInbox(ownerId!);

      const response = await summaryRequest(await sessionOf(ownerId!));

      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toContain("no-store");
      expect(await response.json()).toEqual({
        parts: [
          {
            kind: "widget",
            widget: "acme/inbox",
            card: "inbox-card",
            label: "new submissions",
            count: 2,
          },
        ],
        failed: 0,
      });
    });

    it("counts what the card counts, for a reader with the grant and one without", async () => {
      await seedInbox();
      await grantRole(otherId!, [`read-${INBOX}`]);
      // A third person, with no grant at all.
      const thirdId = await userNamed("third");
      for (const id of [ownerId!, otherId!, thirdId]) await placeInbox(id);

      for (const id of [ownerId!, otherId!]) {
        const session = await sessionOf(id);
        const header = (await (await summaryRequest(session)).json()) as {
          parts: { kind: string; count: number }[];
        };
        expect(await cardAnswer(session)).toEqual({
          ok: true,
          result: { op: "count", total: 2 },
        });
        expect(header.parts).toEqual([
          expect.objectContaining({ kind: "widget", count: 2 }),
        ]);
      }
      // The reader without the grant is drawn no card, and the header says nothing of it.
      const third = await sessionOf(thirdId);
      expect(await cardAnswer(third)).not.toMatchObject({ ok: true });
      expect(await (await summaryRequest(third)).json()).toEqual({
        parts: [],
        failed: 0,
      });
    });

    it("answers an empty summary, not a failure, to a reader who may read none of it", async () => {
      await seedInbox();
      // The card is in their layout, but its `access` is a grant they lack.
      await placeInbox(otherId!);

      const response = await summaryRequest(await sessionOf(otherId!));

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ parts: [], failed: 0 });
    });

    /**
     * A plugin's attention items, kept as startup keeps them, each shown to a
     * reader of the inbox and counted as `counts` says.
     */
    function attentionItems(
      counts: Record<string, AttentionItem["count"]>
    ): void {
      registerAttentionItems([
        {
          owner: 'plugin "@test/forms"',
          widgets: [],
          suggest: undefined,
          alternatives: undefined,
          attention: Object.entries(counts).map(([name, count]) => ({
            id: `acme/${name}`,
            label: `Inbox ${name}`,
            collections: [INBOX],
            count,
            link: `collections/${INBOX}`,
          })),
          unknownKeys: [],
        },
      ]);
    }

    /**
     * The Needs your attention card's items and the header's attention part,
     * each asked by the dashboard's own request for `cookie`, the card from
     * its place on the reader's dashboard.
     */
    async function cardAndHeader(cookie: string) {
      const card = (await slotFor(cookie, {
        widget: needsAttentionWidget.id,
        card: "attention-card",
      })) as {
        ok: boolean;
        result: {
          op: string;
          data: { items: { id: string; kind: string; link: string }[] };
        };
      };
      expect(card, JSON.stringify(card)).toMatchObject({
        ok: true,
        result: { op: "data" },
      });
      const header = (await (await summaryRequest(cookie)).json()) as {
        parts: { kind: string }[];
        failed: number;
      };
      expect(header.failed).toBe(0);
      return {
        items: card.result.data.items,
        attention: header.parts.find(part => part.kind === "attention"),
      };
    }

    /** The card on `userId`'s dashboard, its source published as boot publishes it, and an overdue release. */
    async function attentionWaiting(userId: string): Promise<void> {
      // Each boot's sources are cleared before the case runs; the card's own
      // digest read is handed over again, as boot hands it.
      registerAttentionWidgetSource();
      await place(userId, [
        {
          id: "attention-card",
          widgetId: needsAttentionWidget.id,
          w: 8,
          h: 3,
          removed: false,
        },
      ]);
      const late = await publishedEntry("Overdue");
      await releaseAt(new Date(Date.now() - 60 * 60 * 1000), late);
    }

    it("counts the items the Needs your attention card draws, one number from the one digest", async () => {
      await attentionWaiting(ownerId!);
      // Two of the inbox's: with the overdue release, three in all, held by
      // two items. A header that summed the items' counts would say 3.
      attentionItems({ waiting: async () => 2 });

      const { items, attention } = await cardAndHeader(
        await sessionOf(ownerId!)
      );

      expect(items.map(item => item.id).sort()).toEqual([
        "acme/waiting",
        "core/overdue-releases",
      ]);
      const overdue = items.find(item => item.kind === "overdue");
      expect(attention).toEqual({
        kind: "attention",
        count: items.length,
        // The overdue item's own link, the list it opens on the card.
        link: overdue?.link,
      });
      expect(attention).toMatchObject({
        count: 2,
        link: "releases?tab=attention&reason=overdue",
      });
    });

    it("says N+ for the card's items when one stopped at a bound, and when one could not be counted", async () => {
      await attentionWaiting(ownerId!);
      const session = await sessionOf(ownerId!);

      attentionItems({ backlog: async () => ({ count: 40, atLeast: true }) });
      const floor = await cardAndHeader(session);
      expect(floor.items).toHaveLength(2);
      expect(floor.attention).toEqual({
        kind: "attention",
        count: floor.items.length,
        atLeast: true,
        link: "releases?tab=attention&reason=overdue",
      });

      attentionItems({
        unchecked: async () => {
          throw new Error("the inbox's store is down");
        },
      });
      const unknown = await cardAndHeader(session);
      // The failed item is drawn, "Not all checked", so it is counted.
      expect(unknown.items.map(item => item.id).sort()).toEqual([
        "acme/unchecked",
        "core/overdue-releases",
      ]);
      expect(unknown.attention).toEqual({
        kind: "attention",
        count: unknown.items.length,
        atLeast: true,
        link: "releases?tab=attention&reason=overdue",
      });
    });

    it("counts a widget placed twice for its card that is shown, when the first is hidden", async () => {
      await seedInbox();
      await place(ownerId!, [
        {
          id: "replies-closed",
          widgetId: "acme/replies",
          w: 6,
          h: 3,
          removed: false,
          config: { open: false },
        },
        {
          id: "replies-open",
          widgetId: "acme/replies",
          w: 6,
          h: 3,
          removed: false,
          config: { open: true },
        },
      ]);

      const header = (await (
        await summaryRequest(await sessionOf(ownerId!))
      ).json()) as { parts: { kind: string }[]; failed: number };

      expect(header.parts.filter(part => part.kind === "widget")).toEqual([
        {
          kind: "widget",
          widget: "acme/replies",
          card: "replies-open",
          label: "replies owed",
          count: 2,
        },
      ]);
      expect(header.failed).toBe(0);
    });

    it("gives the environment's label exactly as configured, even one that reads as a timestamp", async () => {
      // A timezone other than UTC, so a pass that rewrote timestamps by value
      // would change a label that reads as one.
      await (
        handle!.getService("generalSettingsService") as unknown as {
          updateSettings(data: { timezone: string }): Promise<unknown>;
        }
      ).updateSettings({ timezone: "Asia/Karachi" });
      const label = "2026-10-30T08:00:00Z";

      const response = await summaryRequest(await sessionOf(ownerId!), {
        environment: { label },
      });

      expect((await response.json()).environment).toEqual({
        label,
        tone: "neutral",
      });
      // The handler's internal marker never reaches the client.
      expect(response.headers.has("x-nextly-skip-date-formatting")).toBe(false);
    });

    it("names the environment the site config sets, its tone defaulting to neutral", async () => {
      const session = await sessionOf(ownerId!);
      const staging = await summaryRequest(session, {
        environment: { label: "Staging", tone: "warning" },
      });
      expect((await staging.json()).environment).toEqual({
        label: "Staging",
        tone: "warning",
      });
      const local = await summaryRequest(session, {
        environment: { label: "Local" },
      });
      expect((await local.json()).environment).toEqual({
        label: "Local",
        tone: "neutral",
      });
      expect(await (await summaryRequest(session)).json()).not.toHaveProperty(
        "environment"
      );
    });
  });
});
