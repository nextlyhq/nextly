/**
 * What `GET /me/capabilities` costs as an install grows: nothing more.
 *
 * Every cell is the route gate's own verdict, and the gate answers a cell
 * whose collection declares no rule from the caller's permission. Asked one
 * resource at a time, that is a read per cell, so an install of a hundred
 * collections would cost hundreds of reads for one answer. The caller's
 * permissions, roles and super-admin authority are read once instead and
 * every cell is answered from them.
 *
 * So the property is a SLOPE, not a ceiling: adding collections adds no read
 * at all. A ceiling would be met by an endpoint that answers about nothing,
 * and a single measurement cannot tell a shared lookup from a cheap one — so
 * two installs are measured, the larger is shown to answer about more, and
 * both have to cost the same reads. Two instances, one at a time, because the
 * entities an answer names are the installation's.
 */

// Set before the harness boots (env validation reads it once).
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { getTableName, isTable } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";

import { buildClaims } from "../../../auth/jwt/claims";
import { signAccessToken } from "../../../auth/jwt/sign";
import { resetSessionStandingForTests } from "../../../auth/session/session-standing";
import { defineCollection, text } from "../../../config";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { createDynamicHandlers } from "../../../routeHandler";
import { invalidateAllPermissionCaches } from "../../../services/lib/permissions";

const ORIGIN = "http://localhost";

/**
 * The tables every question about a caller's access is answered from. The
 * role-epoch row is not counted: it is read on a clock, not per question.
 */
const ACCESS_TABLES = new Set([
  "roles",
  "permissions",
  "role_permissions",
  "user_roles",
  "role_inherits",
  "user_permission_cache",
  "api_keys",
]);

type Select = (...args: unknown[]) => { from: (...args: unknown[]) => unknown };

interface Capabilities {
  entities: Record<string, Record<string, unknown>>;
}

/** What one install's answer cost, and how much of an answer it was. */
interface Measured {
  reads: number;
  cells: number;
  /** The entities the answer named. */
  named: string[];
}

const slugsFor = (count: number) =>
  Array.from({ length: count }, (_, i) => `c${i}`);

describe.each(getConfiguredTestDialects())(
  "what one capabilities answer costs (%s)",
  (dialect: TestDialect) => {
    /**
     * Boots an install of `collections` collections, asks one caller who may
     * read every one of them for its capabilities, and reports the access
     * tables that request read, the cells it answered and the entities it
     * named. The caller reads them all because the answer names only what
     * the caller may read, deciding that for each entity: a caller reading
     * one collection would leave every other entity's cells out of the count.
     */
    async function measure(collections: number): Promise<Measured> {
      const t: TestNextly = await createTestNextly({
        ...(dialect === "sqlite" ? {} : { dialect }),
        collections: slugsFor(collections).map(slug =>
          defineCollection({ slug, fields: [text({ name: "title" })] })
        ),
      });
      try {
        const seeder = t.getService("permissionSeedService") as unknown as {
          seedSystemPermissions: () => Promise<unknown>;
          seedAllCollectionPermissions: () => Promise<unknown>;
        };
        await seeder.seedSystemPermissions();
        await seeder.seedAllCollectionPermissions();

        const direct = t.nextly as unknown as {
          users: {
            create(a: {
              email: string;
              password: string;
              data: Record<string, unknown>;
            }): Promise<{ item: { id: string } }>;
          };
          permissions: {
            find(a: { limit: number }): Promise<{
              items: { id: string; slug: string }[];
            }>;
          };
          roles: {
            create(a: { data: Record<string, unknown> }): Promise<{
              item: { id: string };
            }>;
          };
        };
        const seeded = await direct.permissions.find({ limit: 1000 });
        const roleId = (
          await direct.roles.create({
            data: {
              name: "readers",
              slug: "readers",
              permissionIds: slugsFor(collections).map(
                slug => seeded.items.find(p => p.slug === `read-${slug}`)!.id
              ),
            },
          })
        ).item.id;
        const userId = (
          await direct.users.create({
            email: "reader@example.com",
            password: "Password123!",
            data: { name: "Reader", isActive: true, roles: [roleId] },
          })
        ).item.id;
        const token = await signAccessToken(
          buildClaims({
            userId,
            email: "reader@example.com",
            name: "Reader",
            image: null,
            roleIds: [roleId],
            sessionEpoch: 0,
          }),
          process.env.NEXTLY_SECRET!
        );

        // Counted with every permission cache emptied first, so the second
        // install is not answered from what the first one warmed.
        await invalidateAllPermissionCaches();
        const read: string[] = [];
        const db = t.adapter.getDrizzle() as { select: Select };
        const select = db.select.bind(db);
        const spy = vi.spyOn(db, "select").mockImplementation((...args) => {
          const builder = select(...args);
          const from = builder.from.bind(builder);
          builder.from = (table: unknown, ...rest: unknown[]) => {
            if (isTable(table) && ACCESS_TABLES.has(getTableName(table))) {
              read.push(getTableName(table));
            }
            return from(table, ...rest);
          };
          return builder;
        });
        let body: Capabilities;
        try {
          const segments = ["me", "capabilities"];
          const res = await createDynamicHandlers().GET(
            new Request(`${ORIGIN}/api/${segments.join("/")}`, {
              headers: { origin: ORIGIN, cookie: `nextly_session=${token}` },
            }),
            { params: Promise.resolve({ params: segments }) }
          );
          expect(res.status).toBe(200);
          body = (await res.json()) as Capabilities;
        } finally {
          spy.mockRestore();
        }
        // The answers only: an entity also carries its `kind`, which is read
        // from the registry and costs no question about the caller.
        const cells = Object.values(body.entities).reduce(
          (total, cell) =>
            total +
            Object.values(cell).filter(value => typeof value === "boolean")
              .length,
          0
        );
        return {
          reads: read.length,
          cells,
          named: Object.keys(body.entities).sort(),
        };
      } finally {
        resetSessionStandingForTests();
        await t.destroy();
      }
    }

    it("reads the caller once for the whole answer, however many cells it has", async () => {
      const one = await measure(1);
      const many = await measure(12);

      // POPULATION CONTROL: the larger install really did answer about
      // more, and both answers cost reads, so an equal slope is not two
      // empty measurements agreeing.
      expect(one.cells).toBeGreaterThan(0);
      expect(many.cells).toBeGreaterThan(one.cells);
      expect(one.reads).toBeGreaterThan(0);
      // Every entity was decided readable and named, so each one's
      // readability was asked, and the slope covers that question too.
      expect(one.named).toEqual(slugsFor(1).sort());
      expect(many.named).toEqual(slugsFor(12).sort());

      // No read per added cell: every cell is answered from the caller as it
      // was read once. Asking each cell's permission on its own would add a
      // read per cell, and re-resolving the caller several.
      expect(many.reads).toBe(one.reads);
    }, 240_000);
  }
);
