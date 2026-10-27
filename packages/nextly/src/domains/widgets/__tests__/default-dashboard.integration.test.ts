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
import { getWidgetLayout } from "../../../api/widget-layout";
import { requireAuthentication } from "../../../auth/middleware";
import { defineCollection, text } from "../../../config";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { ReleasesRepository } from "../../releases/releases-repository";
import { refreshCollectionWidgets } from "../collection-widgets";

/** The agreed default, in order, each at its agreed width. */
const AGREED = [
  ["core/needs-attention", "twoThirds"],
  ["core/quick-create", "third"],
  ["core/recently-edited", "half"],
  ["core/recent-activity", "half"],
  ["core/content", "full"],
  ["core/upcoming-releases", "third"],
  ["core/team", "third"],
] as const;
const AGREED_IDS: ReadonlySet<string> = new Set(AGREED.map(([id]) => id));

/** The agreed cards, in the order given, without one of them. */
const without = (...left: string[]) =>
  AGREED.filter(([id]) => !left.includes(id)).map(([id, width]) => [id, width]);

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

/** The R-11 cards of the default `userId` is handed, in order, with their widths. */
async function defaultFor(userId: string): Promise<string[][]> {
  vi.mocked(requireAuthentication).mockResolvedValue({
    userId,
    permissions: [],
    roles: [],
    authMethod: "session",
  });
  const res = await getWidgetLayout(
    new Request("http://localhost/api/dashboard/layout")
  );
  expect(res.status).toBe(200);
  const body = (await res.json()) as {
    placements: Array<{ widgetId: string; width: string; removed: boolean }>;
  };
  return body.placements
    .filter(p => AGREED_IDS.has(p.widgetId) && !p.removed)
    .map(p => [p.widgetId, p.width]);
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
      await refreshCollectionWidgets();

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
        ["core/recently-edited", "half"],
        ["core/recent-activity", "half"],
      ]);

      // One collection to read and none to write in: Needs attention and Content, never Create.
      expect(await defaultFor(readerId)).toEqual([
        ["core/needs-attention", "twoThirds"],
        ["core/recently-edited", "half"],
        ["core/recent-activity", "half"],
        ["core/content", "full"],
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
      await refreshCollectionWidgets();
      expect(await defaultFor(admin)).toEqual(
        without("core/content", "core/quick-create", "core/upcoming-releases")
      );
    });
  }
);
