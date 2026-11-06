/**
 * The permissions a workflow adds, seeded on each collection and Single it is attached to by the
 * boot's own seeding pass, once each however many times it runs: the steps' own action
 * (`approve-<slug>`) and `publish-without-review-<slug>`. One an app already declared stays the
 * app's; and an entity with no workflow gets neither. No preset role is given either.
 */
import { afterEach, describe, expect, it } from "vitest";

import { defineCollection, defineSingle, text } from "../../../config";
import { seedRolePresets } from "../../../database/seeders/role-presets";
import { seedAllPermissions } from "../../../init/seed-permissions";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { ServiceContainer } from "../../../services/index";
import { PermissionService } from "../../auth/services/permission-service";
import { reviewWorkflow } from "../preset";

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

interface Listed {
  action: string;
  resource: string;
  slug: string;
  owner: string | null;
  group: string | null;
}

describe.each(getConfiguredTestDialects())(
  "the permissions a workflow seeds (%s)",
  dialect => {
    it("seeds each once on two collections and a Single, booted twice, leaving an app's own", async () => {
      const review = reviewWorkflow();
      const drafts = { status: true, versions: { drafts: true } } as const;
      current = await createTestNextly({
        dialect,
        collections: [
          defineCollection({
            slug: "posts",
            ...drafts,
            workflow: review,
            fields: [text({ name: "title" })],
          }),
          defineCollection({
            slug: "articles",
            ...drafts,
            workflow: review,
            fields: [text({ name: "title" })],
          }),
          defineCollection({ slug: "tags", fields: [text({ name: "title" })] }),
        ],
        singles: [
          defineSingle({
            slug: "home",
            ...drafts,
            workflow: review,
            fields: [text({ name: "headline" })],
          }),
        ],
      });
      // The permissions service is not a container entry; it is built over
      // the container's adapter, as the Direct API builds its own.
      const permissions = new PermissionService(
        current.getService("adapter"),
        current.getService("logger")
      );
      // An app declared `approve` on articles before the workflow was attached.
      await permissions.ensurePermission(
        "approve",
        "articles",
        "Approve articles",
        "approve-articles",
        undefined,
        { owner: "my-app" }
      );

      await seedAllPermissions();
      await seedAllPermissions();

      const listed = await permissions.listPermissions({
        limit: 100000,
        includeOrphaned: true,
      });
      const all = listed.data as unknown as Listed[];
      const rows = (action: string, resource: string) =>
        all.filter(p => p.action === action && p.resource === resource);
      for (const resource of ["posts", "articles", "home"]) {
        for (const action of ["approve", "publish-without-review"]) {
          expect(rows(action, resource), `${action}-${resource}`).toHaveLength(
            1
          );
        }
        // Marked as a workflow's own, which the presets read, rather than by their shape.
        expect(rows("publish-without-review", resource)[0]).toMatchObject({
          slug: `publish-without-review-${resource}`,
          owner: null,
          group: "workflow",
        });
      }
      expect(rows("approve", "posts")[0]?.owner).toBeNull();
      expect(rows("approve", "articles")[0]?.owner).toBe("my-app");
      expect(rows("approve", "tags")).toEqual([]);
      expect(rows("publish-without-review", "tags")).toEqual([]);
    });

    it("leaves an admin's own permission a workflow step uses unmarked, so a detached workflow can't take it", async () => {
      current = await createTestNextly({
        dialect,
        collections: [
          defineCollection({
            slug: "posts",
            status: true,
            versions: { drafts: true },
            workflow: reviewWorkflow(),
            fields: [text({ name: "title" })],
          }),
        ],
      });
      const permissions = new PermissionService(
        current.getService("adapter"),
        current.getService("logger")
      );
      // The admin made `approve-posts` before the workflow asked for it: owned by no one, in no group.
      await permissions.ensurePermission(
        "approve",
        "posts",
        "Approve posts",
        "approve-posts"
      );

      await seedAllPermissions();

      const listed = (
        await permissions.listPermissions({
          limit: 100000,
          includeOrphaned: true,
        })
      ).data as unknown as Listed[];
      const row = (action: string) =>
        listed.find(p => p.action === action && p.resource === "posts");
      // Not marked as the workflow's, so the presets go on granting it once the workflow is gone.
      expect(row("approve")?.group).toBeNull();
      // The row the seeder made is the workflow's.
      expect(row("publish-without-review")?.group).toBe("workflow");
    });

    it("gives no preset role a permission the workflow seeds", async () => {
      const drafts = { status: true, versions: { drafts: true } } as const;
      current = await createTestNextly({
        dialect,
        collections: [
          defineCollection({
            slug: "posts",
            ...drafts,
            workflow: reviewWorkflow(),
            fields: [text({ name: "title" })],
          }),
        ],
      });
      await seedAllPermissions();
      // The presets are seeded after the permissions, as boot seeds them.
      await seedRolePresets(current.adapter, current.getService("logger"));

      const services = new ServiceContainer(current.adapter);
      for (const preset of ["admin", "editor", "author"]) {
        const found = await services.roles.findRoleIdBySlug(preset);
        if (!found) throw new Error(`no ${preset} role`);
        const held = (
          await services.rolePermissions.listRolePermissions(found.id)
        ).map(p => `${p.action}-${p.resource}`);
        // Each still holds the entity's other permissions, so the presets did reach it.
        expect(held, preset).toContain("read-posts");
        expect(held, preset).not.toContain("approve-posts");
        expect(held, preset).not.toContain("publish-without-review-posts");
      }
    });

    it("gives no preset role the rows a detached workflow left", async () => {
      // Posts had a workflow, since detached: its seeded rows stay, owned by no one, while the
      // registry no longer names them.
      current = await createTestNextly({
        dialect,
        collections: [
          defineCollection({
            slug: "posts",
            status: true,
            versions: { drafts: true },
            fields: [text({ name: "title" })],
          }),
        ],
      });
      await seedAllPermissions();
      const permissions = new PermissionService(
        current.getService("adapter"),
        current.getService("logger")
      );
      for (const action of ["approve", "publish-without-review"]) {
        await permissions.ensurePermission(
          action,
          "posts",
          `${action} posts`,
          `${action}-posts`,
          undefined,
          { group: "workflow" }
        );
      }
      // An admin's own permission, owned by no one and with an action no entity is built with,
      // is the admin's: the presets keep granting it.
      await permissions.ensurePermission(
        "export",
        "posts",
        "Export posts",
        "export-posts"
      );

      await seedRolePresets(current.adapter, current.getService("logger"));

      const services = new ServiceContainer(current.adapter);
      for (const preset of ["admin", "editor", "author"]) {
        const found = await services.roles.findRoleIdBySlug(preset);
        if (!found) throw new Error(`no ${preset} role`);
        const held = (
          await services.rolePermissions.listRolePermissions(found.id)
        ).map(p => `${p.action}-${p.resource}`);
        expect(held, preset).toContain("read-posts");
        expect(held, preset).not.toContain("approve-posts");
        expect(held, preset).not.toContain("publish-without-review-posts");
      }
      const admin = await services.roles.findRoleIdBySlug("admin");
      if (!admin) throw new Error("no admin role");
      expect(
        (await services.rolePermissions.listRolePermissions(admin.id)).map(
          p => `${p.action}-${p.resource}`
        )
      ).toContain("export-posts");
    });
  }
);
