/**
 * A visitor reads media through the Public role's `read-media`.
 *
 * Boot seeding gives the Public role `read-media`, so a request carrying no
 * session and no key may list and open media at the admin's gated media
 * routes, and a checked Direct API read that names nobody may too: both are
 * judged by the one decision with the Public role's grants. Taken off the
 * Public role, the same reads are refused 401, asking for a credential, since
 * signing in could grant them. A media write still needs a signed-in caller,
 * whatever the Public role holds.
 */

// Set before the harness boots (env validation reads it once).
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createMediaHandlers } from "../../api/media-handlers";
import { PUBLIC_ROLE_SLUG } from "../../domains/auth/services/public-role";
import { Nextly } from "../../direct-api/nextly";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../plugins/test-nextly";
import { pdfDocument } from "../../services/upload-validation/__tests__/format-fixtures";

const ORIGIN = "http://localhost";
const PDF = pdfDocument("visitor");

/**
 * A GET of the admin's gated media routes, with no session and no key unless
 * `headers` carries one.
 */
function visitorGet(
  path: string[],
  headers: Record<string, string> = {}
): Promise<Response> {
  return createMediaHandlers({ requireAuth: true }).GET(
    new Request(`${ORIGIN}/api/media/${path.join("/")}`, {
      headers: { origin: ORIGIN, ...headers },
    }),
    { params: Promise.resolve({ path }) }
  );
}

describe.each(getConfiguredTestDialects())(
  "a visitor reads media through the Public role (%s)",
  (dialect: TestDialect) => {
    let t: TestNextly;
    let fileId: string;
    let publicId: string;
    /** A checked instance that names nobody: a visitor's Direct API call. */
    const visitor = () => new Nextly({ overrideAccess: false });

    /** The Public role's permissions, as slugs. */
    async function publicHolds(): Promise<string[]> {
      return (await t.nextly.roles.getPermissions({ id: publicId })).map(
        permission => permission.slug
      );
    }

    /** Sets the Public role's permissions to exactly `slugs`. */
    async function setPublic(slugs: string[]): Promise<void> {
      const ids = (await t.nextly.permissions.find({ limit: 1000 })).items
        .filter(permission => slugs.includes(permission.slug))
        .map(permission => String(permission.id));
      await t.nextly.roles.setPermissions({
        roleId: publicId,
        permissionIds: ids,
      });
    }

    beforeAll(async () => {
      t = await createTestNextly({
        ...(dialect === "sqlite" ? {} : { dialect }),
        // The boot's seeding: permissions, the Public role and its grants,
        // `read-media` among them.
        seedPublic: true,
      });
      const publicRole = (await t.nextly.roles.find({ limit: 100 })).items.find(
        found => found.slug === PUBLIC_ROLE_SLUG
      );
      if (!publicRole) throw new Error("boot seeding made no Public role");
      publicId = String(publicRole.id);
      fileId = (
        await t.nextly.media.upload({
          file: {
            data: PDF,
            name: "visible.pdf",
            mimetype: "application/pdf",
            size: PDF.length,
          },
        })
      ).id;
    });

    afterAll(async () => {
      await t?.destroy();
    });

    describe("while the Public role holds read-media", () => {
      it("holds read-media, as boot seeding grants it", async () => {
        expect(await publicHolds()).toContain("read-media");
      });

      it("lists the file at REST", async () => {
        const res = await visitorGet([]);
        expect(res.status).toBe(200);
        expect(JSON.stringify(await res.json())).toContain(fileId);
      });

      it("opens the file at REST", async () => {
        const res = await visitorGet([fileId]);
        expect(res.status).toBe(200);
        expect(JSON.stringify(await res.json())).toContain(fileId);
      });

      it("asks a request whose session is not valid to sign in again, as it is no visitor", async () => {
        const res = await visitorGet([], {
          cookie: "nextly_session=not-a-session",
        });
        expect(res.status).toBe(401);
      });

      it("lists and opens the file through a checked Direct API call naming nobody", async () => {
        const found = await visitor().media.find({});
        expect(found.items.map(item => item.id)).toContain(fileId);
        const one = await visitor().media.findByID({ id: fileId });
        expect(one?.id).toBe(fileId);
        expect(Array.isArray(await visitor().media.folders.list({}))).toBe(
          true
        );
      });

      it("still refuses a visitor's upload, though the Public role may create media", async () => {
        const held = await publicHolds();
        await setPublic([...held, "create-media"]);
        try {
          await expect(
            visitor().media.upload({
              file: {
                data: PDF,
                name: "by-a-visitor.pdf",
                mimetype: "application/pdf",
                size: PDF.length,
              },
            })
          ).rejects.toMatchObject({ code: "AUTH_REQUIRED", statusCode: 401 });
        } finally {
          await setPublic(held);
        }
      });

      it("still refuses a visitor's upload at REST, though the Public role may create media, and stores nothing", async () => {
        const held = await publicHolds();
        await setPublic([...held, "create-media"]);
        const before = (await new Nextly().media.find({})).items.length;
        try {
          const form = new FormData();
          form.append(
            "file",
            new File([PDF], "by-a-visitor-at-rest.pdf", {
              type: "application/pdf",
            })
          );
          const res = await createMediaHandlers({ requireAuth: true }).POST(
            new Request(`${ORIGIN}/api/media`, {
              method: "POST",
              headers: { origin: ORIGIN },
              body: form,
            }),
            { params: Promise.resolve({ path: [] }) }
          );
          // Only a read is answered by the Public role; a write still needs a
          // signed-in caller, whatever Public holds.
          expect(res.status).toBe(401);
        } finally {
          await setPublic(held);
        }
        expect((await new Nextly().media.find({})).items.length).toBe(before);
      });
    });

    describe("once read-media is taken off the Public role", () => {
      beforeAll(async () => {
        await setPublic(
          (await publicHolds()).filter(slug => slug !== "read-media")
        );
      });

      it("refuses the list and the file at REST 401, asking for a credential", async () => {
        for (const path of [[], [fileId]]) {
          const res = await visitorGet(path);
          expect(res.status).toBe(401);
        }
      });

      it("refuses a checked Direct API read naming nobody 401", async () => {
        await expect(visitor().media.find({})).rejects.toMatchObject({
          code: "AUTH_REQUIRED",
          statusCode: 401,
        });
        await expect(
          visitor().media.findByID({ id: fileId })
        ).rejects.toMatchObject({ code: "AUTH_REQUIRED", statusCode: 401 });
        await expect(visitor().media.folders.list({})).rejects.toMatchObject({
          code: "AUTH_REQUIRED",
          statusCode: 401,
        });
      });
    });
  }
);
