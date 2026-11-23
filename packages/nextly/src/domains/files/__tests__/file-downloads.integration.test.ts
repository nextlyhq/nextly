/**
 * Opening a private file through the one checked download, end to end
 * against a real database: the REST route and the Direct API.
 *
 * What separates a correct implementation from the plausible broken ones:
 * - the entry is read AS THE CALLER, so the collection's read rule and
 *   permissions decide, for staff, an API key and a signed-in person alike;
 * - a refused file, a missing one and one not yet ready get the SAME answer,
 *   so a caller learns nothing of what exists;
 * - every download is answered so no cache keeps it, as an attachment that
 *   is never rendered on the site's origin;
 * - every download, and only a download, writes a `file.downloaded` row
 *   naming who opened which file;
 * - the Direct API has no unchecked default.
 * Each refusal has the allowed case beside it.
 */

// Set before the harness boots (env validation reads it once).
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { grantTo } from "../../../__tests__/fixtures/permission-holders";
import { buildClaims } from "../../../auth/jwt/claims";
import { signAccessToken } from "../../../auth/jwt/sign";
import { resetSessionStandingForTests } from "../../../auth/session/session-standing";
import { openNamedQueryFrame } from "../../../auth/named-query-scope";
import { defineCollection, text } from "../../../config";
import { Nextly } from "../../../direct-api/nextly";
import type { PluginDefinition } from "../../../plugins/plugin-context";
import type { Principal } from "../../../plugins/principals/types";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { createDynamicHandlers } from "../../../routeHandler";

import { MemoryPrivateStorage } from "./memory-private-storage";

const STREAMED = "contracts";
const LINKED = "linkfiles";
const KIND = "accounts:account";
const ORIGIN = "http://localhost";
const MISSING = "00000000-0000-4000-8000-000000000000";

const MEMBERS: Record<string, { verified: boolean }> = {
  m1: { verified: true },
  m3: { verified: false },
};

const accounts = {
  name: "accounts",
  version: "1.0.0",
  nextly: "*",
  contributes: {
    principals: [
      {
        name: "account",
        attributes: { verified: "boolean" },
        resolve: async (request: Request) => {
          const id = request.headers.get("x-member");
          return id && MEMBERS[id] ? { id, attributes: MEMBERS[id] } : null;
        },
        lookup: async (id: string) =>
          MEMBERS[id] ? { id, attributes: MEMBERS[id] } : null,
      },
    ],
  },
} as unknown as PluginDefinition;

/** Staff by their permissions; a member only when verified. */
const verifiedOrStaff = ({ principal }: { principal: Principal | null }) =>
  principal === null || principal.attributes.verified === true;

const FILES = {
  visibility: "private" as const,
  accept: ["application/pdf"],
  maxSize: 64 * 1024,
  principals: [KIND],
};

function pdf(note: string): Buffer {
  return Buffer.from(
    `%PDF-1.4\n% ${note}\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n`
  );
}

/** An `audit_log` row as read back (Drizzle camelCases the columns). */
interface AuditRow {
  id: string;
  kind: string;
  actorKind: string | null;
  actorUserId: string | null;
  actorPrincipalKind: string | null;
  actorPrincipalId: string | null;
  metadata: Record<string, unknown> | string | null;
}

describe.each(getConfiguredTestDialects())(
  "the checked download of private files (%s)",
  (dialect: TestDialect) => {
    let t: TestNextly;
    let storage: MemoryPrivateStorage;
    const ids: Record<string, string> = {};
    const files: Record<string, { id: string; bytes: Buffer }> = {};

    async function staff(name: string): Promise<Record<string, string>> {
      const token = await signAccessToken(
        buildClaims({
          userId: ids[name],
          email: `${name}@example.com`,
          name,
          image: null,
          roleIds: [],
          sessionEpoch: 0,
        }),
        process.env.NEXTLY_SECRET!
      );
      return { cookie: `nextly_session=${token}` };
    }
    const member = (id: string) => ({ "x-member": id });

    async function call(
      method: "GET" | "POST",
      path: string[],
      headers: Record<string, string>,
      body?: unknown
    ): Promise<Response> {
      const handlers = createDynamicHandlers();
      const request = new Request(`${ORIGIN}/admin/api/${path.join("/")}`, {
        method,
        headers: {
          origin: ORIGIN,
          ...(body === undefined ? {} : { "content-type": "application/json" }),
          ...headers,
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const context = { params: Promise.resolve({ params: path }) };
      return method === "GET"
        ? handlers.GET(request, context)
        : handlers.POST(request, context);
    }

    const download = (
      collection: string,
      id: string,
      headers: Record<string, string>
    ) => call("GET", ["files", collection, id, "download"], headers);

    /** Upload `bytes` to `collection` as `uploader`, confirming it unless told not to. */
    async function uploaded(
      collection: string,
      bytes: Buffer,
      confirm = true
    ): Promise<string> {
      const started = (await (
        await call(
          "POST",
          ["files", collection, "uploads"],
          await staff("uploader"),
          {
            filename: "note.pdf",
            mimeType: "application/pdf",
            size: bytes.length,
          }
        )
      ).json()) as {
        item: {
          id: string;
          upload: { url: string; headers: Record<string, string> };
        };
      };
      storage.browserPut(started.item.upload, bytes);
      if (confirm) {
        await call(
          "POST",
          ["files", collection, "uploads", started.item.id, "complete"],
          await staff("uploader")
        );
      }
      return started.item.id;
    }

    /** The `file.downloaded` rows naming file `id`. */
    async function downloadsOf(id: string): Promise<AuditRow[]> {
      const rows = await t.adapter.select<AuditRow>("audit_log");
      return rows
        .filter(row => row.kind === "file.downloaded")
        .map(row => ({
          ...row,
          metadata:
            typeof row.metadata === "string"
              ? (JSON.parse(row.metadata) as Record<string, unknown>)
              : row.metadata,
        }))
        .filter(row => (row.metadata as { id?: unknown } | null)?.id === id);
    }

    /** The ids of the `file.downloaded` rows naming file `id` so far. */
    async function seenRows(id: string): Promise<Set<string>> {
      return new Set((await downloadsOf(id)).map(row => row.id));
    }

    /**
     * The one row for file `id` added since `seen`, whatever order the
     * database lists rows in.
     */
    async function addedRow(id: string, seen: Set<string>): Promise<AuditRow> {
      const added = (await downloadsOf(id)).filter(row => !seen.has(row.id));
      expect(added).toHaveLength(1);
      return added[0];
    }

    /** A refusal's body without its request id, to compare two refusals. */
    async function refusal(res: Response): Promise<string> {
      return (await res.text()).replace(/"requestId":"[^"]*"/, "");
    }

    beforeAll(async () => {
      storage = new MemoryPrivateStorage();
      t = await createTestNextly({
        ...(dialect === "sqlite" ? {} : { dialect }),
        plugins: [accounts],
        storagePlugins: [storage.plugin([STREAMED, LINKED])],
        collections: [
          defineCollection({
            slug: STREAMED,
            files: FILES,
            access: { read: verifiedOrStaff, create: verifiedOrStaff },
            fields: [text({ name: "note" })],
          }),
          defineCollection({
            slug: LINKED,
            files: { ...FILES, delivery: "redirect" },
            access: { read: verifiedOrStaff, create: verifiedOrStaff },
            fields: [text({ name: "note" })],
          }),
        ],
      });
      const users = (
        t.nextly as unknown as {
          users: {
            create(a: {
              email: string;
              password: string;
              data: Record<string, unknown>;
            }): Promise<{ item: { id: string } }>;
          };
        }
      ).users;
      for (const name of ["owner", "uploader", "reader", "stranger"]) {
        ids[name] = (
          await users.create({
            email: `${name}@example.com`,
            password: "Password123!",
            data: { name, isActive: true },
          })
        ).item.id;
      }
      await grantTo(t, ids.uploader, "create", [STREAMED, LINKED]);
      await grantTo(t, ids.reader, "read", [STREAMED, LINKED]);
      // The stranger may create, but not read.
      await grantTo(t, ids.stranger, "create", [STREAMED]);

      files.ready = { id: "", bytes: pdf("ready file") };
      files.ready.id = await uploaded(STREAMED, files.ready.bytes);
      files.pending = { id: "", bytes: pdf("pending file") };
      files.pending.id = await uploaded(STREAMED, files.pending.bytes, false);
      files.linked = { id: "", bytes: pdf("linked file") };
      files.linked.id = await uploaded(LINKED, files.linked.bytes);
    }, 120_000);

    afterAll(async () => {
      resetSessionStandingForTests();
      await t?.destroy();
    });

    it("streams a ready file to staff who may read it, never cached, as an attachment, and records it", async () => {
      const seen = await seenRows(files.ready.id);
      const res = await download(
        STREAMED,
        files.ready.id,
        await staff("reader")
      );
      expect(res.status).toBe(200);
      expect(
        Buffer.from(await res.arrayBuffer()).equals(files.ready.bytes)
      ).toBe(true);
      expect(res.headers.get("content-type")).toBe("application/pdf");
      expect(res.headers.get("content-disposition")).toBe(
        `attachment; filename="note.pdf"; filename*=UTF-8''note.pdf`
      );
      expect(res.headers.get("cache-control")).toBe("private, no-store");
      expect(res.headers.get("pragma")).toBe("no-cache");
      expect(res.headers.get("x-content-type-options")).toBe("nosniff");
      expect(res.headers.get("content-security-policy")).toBe("sandbox");
      expect(res.headers.get("referrer-policy")).toBe("no-referrer");
      expect(res.headers.get("cdn-cache-control")).toBeNull();
      expect(res.headers.get("etag")).toBeNull();

      const row = await addedRow(files.ready.id, seen);
      const rows = [row];
      expect(row).toMatchObject({
        actorKind: "staff",
        actorUserId: ids.reader,
        metadata: {
          collection: STREAMED,
          id: files.ready.id,
          delivery: "stream",
        },
      });
      // Where the file is kept is never recorded.
      const key = String(
        (
          (await new Nextly().findByID({
            collection: STREAMED,
            id: files.ready.id,
          } as never)) as {
            storageKey: string;
          }
        ).storageKey
      );
      expect(JSON.stringify(rows)).not.toContain(key);
    });

    it("answers a file the caller may not read exactly as a missing one, recording nothing", async () => {
      const missing = await refusal(
        await download(STREAMED, MISSING, await staff("reader"))
      );
      const cases: Array<[string, string, Record<string, string>]> = [
        [
          "staff without the read permission",
          files.ready.id,
          await staff("stranger"),
        ],
        ["a member the rule refuses", files.ready.id, member("m3")],
        [
          "a file not yet confirmed, for staff who may read",
          files.pending.id,
          await staff("reader"),
        ],
      ];
      for (const [who, id, headers] of cases) {
        const before = (await downloadsOf(id)).length;
        const res = await download(STREAMED, id, headers);
        expect(res.status, who).toBe(404);
        expect(res.headers.get("content-disposition"), who).toBeNull();
        expect(res.headers.get("cache-control") ?? "", who).not.toMatch(
          /public/
        );
        expect(await refusal(res), who).toBe(missing);
        expect((await downloadsOf(id)).length, who).toBe(before);
      }
    });

    it("opens a file for a signed-in member the rule allows, recording the member", async () => {
      const seen = await seenRows(files.ready.id);
      const res = await download(STREAMED, files.ready.id, member("m1"));
      expect(res.status).toBe(200);
      expect(
        Buffer.from(await res.arrayBuffer()).equals(files.ready.bytes)
      ).toBe(true);
      expect(await addedRow(files.ready.id, seen)).toMatchObject({
        actorPrincipalKind: KIND,
        actorPrincipalId: "m1",
        actorUserId: null,
      });
    });

    it("refuses a request with no caller", async () => {
      const res = await download(STREAMED, files.ready.id, {});
      expect(res.status).toBe(401);
      expect(res.headers.get("content-disposition")).toBeNull();
    });

    it("answers a redirecting collection with a short link, itself never cached", async () => {
      const seen = await seenRows(files.linked.id);
      const res = await download(
        LINKED,
        files.linked.id,
        await staff("reader")
      );
      expect(res.status).toBe(303);
      const location = res.headers.get("location") ?? "";
      expect(location).toMatch(
        /^https:\/\/storage\.test\/files\/linkfiles\/[0-9a-f-]{36}\?get&expires=60$/
      );
      expect(res.headers.get("cache-control")).toBe("private, no-store");
      expect(res.headers.get("referrer-policy")).toBe("no-referrer");
      expect(await addedRow(files.linked.id, seen)).toMatchObject({
        metadata: { delivery: "redirect" },
      });
      // And refused, it is the same 404 as a stream's.
      expect(
        (await download(LINKED, files.linked.id, member("m3"))).status
      ).toBe(404);
    });

    it("opens files from server code only for a caller it names, by the same rules", async () => {
      const api = new Nextly();
      let seen = await seenRows(files.ready.id);
      const opened = await api.files.download({
        collection: STREAMED,
        id: files.ready.id,
        user: { id: ids.reader },
      });
      expect(opened).toMatchObject({
        filename: "note.pdf",
        mimeType: "application/pdf",
        delivery: "stream",
      });
      expect(
        Buffer.from(await new Response(opened.stream).arrayBuffer()).equals(
          files.ready.bytes
        )
      ).toBe(true);
      expect(await addedRow(files.ready.id, seen)).toMatchObject({
        actorUserId: ids.reader,
      });

      await expect(
        api.files.download({
          collection: STREAMED,
          id: files.ready.id,
          user: { id: ids.stranger },
        })
      ).rejects.toMatchObject({ code: "NOT_FOUND" });

      const m1 = await api.principals.byId(KIND, "m1");
      const m3 = await api.principals.byId(KIND, "m3");
      await expect(
        api.files.download({
          collection: STREAMED,
          id: files.ready.id,
          principal: m1!,
        })
      ).resolves.toMatchObject({ delivery: "stream" });
      await expect(
        api.files.download({
          collection: STREAMED,
          id: files.ready.id,
          principal: m3!,
        })
      ).rejects.toMatchObject({ code: "NOT_FOUND" });

      // No caller named: refused, not opened as the server.
      await expect(
        api.files.download({ collection: STREAMED, id: files.ready.id })
      ).rejects.toMatchObject({ code: "INVALID_INPUT" });
      // Trusted code says so, and is recorded as core.
      seen = await seenRows(files.ready.id);
      await expect(
        api.files.download({
          collection: STREAMED,
          id: files.ready.id,
          overrideAccess: true,
        })
      ).resolves.toMatchObject({ delivery: "stream" });
      expect(await addedRow(files.ready.id, seen)).toMatchObject({
        actorKind: "core",
      });

      // An API key's call, named as the key and not as its maker's session.
      seen = await seenRows(files.ready.id);
      await api.files.download({
        collection: STREAMED,
        id: files.ready.id,
        user: { id: ids.reader },
        apiKeyId: "key-of-a-script",
      });
      expect(await addedRow(files.ready.id, seen)).toMatchObject({
        actorKind: "apiKey",
        actorUserId: ids.reader,
        metadata: { apiKeyId: "key-of-a-script" },
      });

      // Never inside a named query, which reads only through its own reader.
      await expect(
        openNamedQueryFrame("posts-by-author").run(() =>
          api.files.download({
            collection: STREAMED,
            id: files.ready.id,
            overrideAccess: true,
          })
        )
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    });
  }
);
