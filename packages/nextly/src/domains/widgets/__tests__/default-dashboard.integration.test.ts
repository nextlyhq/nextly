/**
 * The default dashboard each kind of person is handed, against a real instance, on every
 * configured dialect: the agreed cards, in the agreed order, at the agreed widths, each only while
 * what it needs holds for that person.
 *
 * Read through the real layout endpoint, the reads behind every condition included; only the
 * sign-in is stood in for, so each request is a given person's.
 *
 * @module domains/widgets/__tests__/default-dashboard.integration.test
 */

// Set before the harness boots (env validation reads it once).
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../auth/middleware", async importOriginal => ({
  ...(await importOriginal<typeof import("../../../auth/middleware")>()),
  requireAuthentication: vi.fn(),
}));

import { grantTo } from "../../../__tests__/fixtures/permission-holders";
import { getWidgetLayout, putWidgetLayout } from "../../../api/widget-layout";
import { requireAuthentication } from "../../../auth/middleware";
import { defineCollection, text } from "../../../config";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { ReleasesRepository } from "../../releases/releases-repository";
import { refreshContentSources } from "../content-sources";
import { setDefaultLayoutPlan } from "../default-layout";

/**
 * The agreed default, in order, each at its agreed size, `w` by `h` in grid units. A list card is
 * five rows tall, the height whose body holds five rows, but four beside Team, whose row it shares.
 */
const AGREED = [
  ["core/needs-attention", "8x4"],
  ["core/quick-create", "4x4"],
  ["core/recently-edited", "6x5"],
  ["core/recent-activity", "6x5"],
  ["core/content", "12x4"],
  ["core/upcoming-releases", "4x4"],
  ["core/team", "4x4"],
] as const;
const AGREED_IDS: ReadonlySet<string> = new Set(AGREED.map(([id]) => id));

/** The agreed cards, in the order given, without one of them. */
const without = (...left: string[]) =>
  AGREED.filter(([id]) => !left.includes(id)).map(([id, size]) => [id, size]);

let current: TestNextly | undefined;
/** Whose dashboard a read is. Read by a collection's rule, so it admits one person. */
let readerId = "";

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

async function account(t: TestNextly, email: string): Promise<string> {
  const users = (
    t.nextly as unknown as {
      users: {
        create: (a: {
          data: Record<string, unknown>;
        }) => Promise<{ item: { id: string } }>;
      };
    }
  ).users;
  const created = await users.create({
    data: { email, password: "Password123!", name: email, isActive: true },
  });
  return created.item.id;
}

/** Every request from here on is `userId`'s. */
function signedInAs(userId: string): void {
  vi.mocked(requireAuthentication).mockResolvedValue({
    userId,
    permissions: [],
    roles: [],
    authMethod: "session",
  });
}

interface LayoutRead {
  placements: Array<{ id: string; widgetId: string; w: number; h: number }>;
  defaultPlacements: Array<{ widgetId: string; w: number; h: number }>;
  version: number;
  scope: string;
  source: string;
}

/** `userId`'s dashboard as the layout endpoint answers it. */
async function layoutOf(userId: string): Promise<LayoutRead> {
  signedInAs(userId);
  const res = await getWidgetLayout(
    new Request("http://localhost/api/dashboard/layout")
  );
  expect(res.status).toBe(200);
  return (await res.json()) as LayoutRead;
}

/** Cards as `[widget, "wxh"]`, in order. */
const sized = (
  cards: ReadonlyArray<{ widgetId: string; w: number; h: number }>
) => cards.map(p => [p.widgetId, `${p.w}x${p.h}`]);

/** The R-11 cards of the default `userId` is handed, in order, with their sizes. */
async function defaultFor(userId: string): Promise<string[][]> {
  signedInAs(userId);
  const res = await getWidgetLayout(
    new Request("http://localhost/api/dashboard/layout")
  );
  expect(res.status).toBe(200);
  const body = (await res.json()) as {
    placements: Array<{
      widgetId: string;
      w: number;
      h: number;
      removed: boolean;
    }>;
  };
  return body.placements
    .filter(p => AGREED_IDS.has(p.widgetId) && !p.removed)
    .map(p => [p.widgetId, `${p.w}x${p.h}`]);
}

describe.each(getConfiguredTestDialects())(
  "the default dashboard (%s)",
  (dialect: TestDialect) => {
    it("hands each person the agreed cards they have something to see on", async () => {
      current = await createTestNextly({
        ...(dialect === "sqlite" ? {} : { dialect }),
        collections: [
          defineCollection({
            slug: "dd_notes",
            // Read only by the one reader below, created by nobody but an administrator.
            access: { read: ({ user }) => user?.id === readerId },
            fields: [text({ name: "title" })],
          }),
        ],
      });
      // The first account of an instance is its super-admin.
      const admin = await account(current, "admin@example.com");
      const editor = await account(current, "editor@example.com");
      readerId = await account(current, "reader@example.com");
      // A code rule only narrows the permission, so the reader holds read on
      // the notes the rule admits them to.
      await grantTo(current, readerId, "read", ["dd_notes"]);
      await refreshContentSources();

      // Before any release exists, Upcoming releases waits for one.
      expect(await defaultFor(admin)).toEqual(
        without("core/upcoming-releases")
      );
      await new ReleasesRepository(current.adapter).createRelease({
        title: "Spring launch",
      });
      expect(await defaultFor(admin)).toEqual(without());

      // No grants: nothing to create, count or list, and neither the team nor releases.
      expect(await defaultFor(editor)).toEqual([
        ["core/recently-edited", "6x5"],
        ["core/recent-activity", "6x5"],
      ]);

      // One collection to read and none to write in: Needs attention and Content, never Create.
      expect(await defaultFor(readerId)).toEqual([
        ["core/needs-attention", "8x4"],
        ["core/recently-edited", "6x5"],
        ["core/recent-activity", "6x5"],
        ["core/content", "12x4"],
      ]);
    });

    it("hands the site's defaultLayout to a person following the default, and leaves a saved layout as it was saved", async () => {
      current = await createTestNextly({
        ...(dialect === "sqlite" ? {} : { dialect }),
        // A collection the administrator may read, so Content has one to list.
        collections: [
          defineCollection({
            slug: "dd_posts",
            fields: [text({ name: "title" })],
          }),
        ],
      });
      const admin = await account(current, "admin@example.com");
      await refreshContentSources();
      // The default a site's `admin.dashboard.defaultLayout` asks for, as startup sets it.
      setDefaultLayoutPlan({
        cards: [{ widget: "core/content" }, { widget: "core/team", w: 6 }],
        suggestions: true,
        suggested: [],
      });

      const following = await layoutOf(admin);
      expect(following.source).toBe("default");
      expect(sized(following.placements)).toEqual([
        ["core/content", "12x4"],
        ["core/team", "6x4"],
      ]);

      signedInAs(admin);
      const save = await putWidgetLayout(
        new Request("http://localhost/api/dashboard/layout", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            placements: [
              { id: "mine", widgetId: "core/team", w: 4, h: 4, removed: false },
            ],
            version: following.version,
            scope: following.scope,
          }),
        })
      );
      expect(save.status).toBe(200);

      // The site's default changes; the saved dashboard does not.
      setDefaultLayoutPlan({
        cards: [{ widget: "core/team" }, { widget: "core/content" }],
        suggestions: true,
        suggested: [],
      });
      const saved = await layoutOf(admin);
      expect(saved.source).toBe("own");
      expect(
        saved.placements.map(p => [p.id, p.widgetId, `${p.w}x${p.h}`])
      ).toEqual([["mine", "core/team", "4x4"]]);
      // What a reset would return to is the new default.
      expect(sized(saved.defaultPlacements)).toEqual([
        ["core/team", "4x4"],
        ["core/content", "12x4"],
      ]);
    });

    it("gives a super-admin who may read only internal collections no Content and no Create", async () => {
      current = await createTestNextly({
        ...(dialect === "sqlite" ? {} : { dialect }),
        collections: [
          defineCollection({
            slug: "dd_internal",
            admin: { hidden: true },
            fields: [text({ name: "title" })],
          }),
        ],
      });
      const admin = await account(current, "admin@example.com");
      await refreshContentSources();
      expect(await defaultFor(admin)).toEqual(
        without("core/content", "core/quick-create", "core/upcoming-releases")
      );
    });
  }
);
