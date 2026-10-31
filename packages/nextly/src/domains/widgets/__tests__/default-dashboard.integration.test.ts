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
import { listWidgets } from "../registry";

/**
 * The agreed default after the onboarding card, in grid order, each at its agreed size, `w` by
 * `h` in grid units: Needs attention beside Upcoming releases, Continue beside Content, then Team
 * activity (beside the form-builder plugin's card, where the plugin is installed). Team and
 * Create are not on the default, even for a person they are offered to.
 */
const AGREED = [
  ["core/needs-attention", "8x4"],
  ["core/upcoming-releases", "4x4"],
  ["core/continue", "6x4"],
  ["core/content-table", "6x4"],
  ["core/team-activity", "6x4"],
] as const;
/** The form-builder plugin's card, which core's default names as optional. */
const FORM_SUBMISSIONS = "form-builder/new-submissions";
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
          defineCollection({
            slug: "dd_posts",
            fields: [text({ name: "title" })],
          }),
        ],
      });
      // The first account of an instance is its super-admin, on a new project.
      const admin = await account(current, "admin@example.com");
      const editor = await account(current, "editor@example.com");
      readerId = await account(current, "reader@example.com");
      const nobody = await account(current, "nobody@example.com");
      // An editor of the posts, who may not read releases.
      await grantTo(current, editor, "read", ["dd_posts"]);
      await grantTo(current, editor, "update", ["dd_posts"]);
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
      // Team is offered to the administrator, who manages the team, and is
      // not on their default: they add it from the add panel. Nor is the
      // form-builder plugin's card, on an install without the plugin, which
      // started with no fault.
      const followed = await layoutOf(admin);
      expect(followed.source).toBe("default");
      for (const absent of [
        "core/team",
        "core/quick-create",
        FORM_SUBMISSIONS,
      ]) {
        expect(followed.placements.map(p => p.widgetId)).not.toContain(absent);
        expect(followed.defaultPlacements.map(p => p.widgetId)).not.toContain(
          absent
        );
      }

      // Content to read and edit, and no releases: everything but Upcoming releases.
      const content = without("core/upcoming-releases");
      expect(await defaultFor(editor)).toEqual(content);
      // One collection to read, by a rule: the same cards.
      expect(await defaultFor(readerId)).toEqual(content);
      // No content and no releases: Needs attention alone. It is placed for everyone, and it is
      // the card, not the layout, that leaves the dashboard while nothing waits for its reader;
      // Continue and Team activity are not, since neither has anything it may draw.
      expect(await defaultFor(nobody)).toEqual([
        ["core/needs-attention", "8x4"],
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
        cards: [
          { widget: "core/content-table" },
          { widget: "core/team", w: 6 },
        ],
      });

      const following = await layoutOf(admin);
      expect(following.source).toBe("default");
      expect(sized(following.placements)).toEqual([
        ["core/content-table", "12x4"],
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
        cards: [{ widget: "core/team" }, { widget: "core/content-table" }],
      });
      const saved = await layoutOf(admin);
      expect(saved.source).toBe("own");
      expect(
        saved.placements.map(p => [p.id, p.widgetId, `${p.w}x${p.h}`])
      ).toEqual([["mine", "core/team", "4x4"]]);
      // What a reset would return to is the new default.
      expect(sized(saved.defaultPlacements)).toEqual([
        ["core/team", "4x4"],
        ["core/content-table", "12x4"],
      ]);
    });

    it("has no core/content card: it is not registered, and a saved layout naming it is refused", async () => {
      current = await createTestNextly({
        ...(dialect === "sqlite" ? {} : { dialect }),
        // A collection the administrator may read, so the Content table is theirs to place.
        collections: [
          defineCollection({
            slug: "dd_posts",
            fields: [text({ name: "title" })],
          }),
        ],
      });
      const admin = await account(current, "admin@example.com");
      await refreshContentSources();

      const ids = listWidgets().map(widget => widget.id);
      expect(ids).not.toContain("core/content");
      // The control: the registry is populated, the table among it.
      expect(ids).toContain("core/content-table");

      const read = await layoutOf(admin);
      expect(read.placements.map(p => p.widgetId)).not.toContain(
        "core/content"
      );
      const write = (widgetId: string) => {
        signedInAs(admin);
        return putWidgetLayout(
          new Request("http://localhost/api/dashboard/layout", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              placements: [
                { id: "content", widgetId, w: 12, h: 4, removed: false },
              ],
              version: read.version,
              scope: read.scope,
            }),
          })
        );
      };
      // Refused as any widget nobody can place is, with no conversion to the table.
      const refused = await write("core/content");
      expect(refused.status).toBe(400);
      expect(await refused.text()).toContain("core/content");
      expect((await layoutOf(admin)).source).toBe("default");
      // The control: the same write naming the table is accepted.
      const accepted = await write("core/content-table");
      expect(accepted.status).toBe(200);
    });

    it("gives a super-admin who may read only internal collections Needs attention alone", async () => {
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
      // No content the dashboard lists and no release made yet: Needs attention alone (placed for
      // everyone), with no Content, Continue or Team activity.
      expect(await defaultFor(admin)).toEqual([
        ["core/needs-attention", "8x4"],
      ]);
    });
  }
);
