/**
 * Uploading a private file through the file routes, end to end against a
 * real database, as staff and as a plugin-defined signed-in person.
 *
 * What separates a correct implementation from the plausible broken ones:
 * - the access decision runs BEFORE anything is written, so a refused caller
 *   leaves no entry and no stored bytes;
 * - the confirm reads the stored bytes back, so content of another type, or
 *   of another size than claimed, never becomes `ready` and is deleted;
 * - only the uploader may confirm, and anyone else gets exactly the answer
 *   an upload that does not exist gets;
 * - a person is recognised only of a kind the collection names, and judged
 *   by the collection's own rules;
 * - a cookie-carried write from another site is refused before anyone is
 *   recognised.
 * Each refusal has the allowed case beside it, so a route refusing everything
 * fails as surely as one refusing nothing.
 */

// Set before the harness boots (env validation reads it once).
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { createHash } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { grantTo } from "../../../__tests__/fixtures/permission-holders";
import { buildClaims } from "../../../auth/jwt/claims";
import { signAccessToken } from "../../../auth/jwt/sign";
import { resetSessionStandingForTests } from "../../../auth/session/session-standing";
import { defineCollection, text } from "../../../config";
import type { ApiKeyService } from "../../../domains/auth/services/api-key-service";
import { container } from "../../../di/container";
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
import type { CollectionsHandler } from "../../../services/collections-handler";
import { sweepAbandonedUploads } from "../sweep-abandoned-uploads";

import { MemoryPrivateStorage } from "./memory-private-storage";

const CONTRACTS = "contracts";
/** A collection with files that names no kind of person. */
const STAFF_ONLY = "staffonly";
const KIND = "accounts:account";
const ORIGIN = "http://localhost";

/** The members the test plugin's resolver knows, by the header they send. */
const MEMBERS: Record<string, { verified: boolean }> = {
  m1: { verified: true },
  m2: { verified: true },
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
      },
    ],
  },
} as unknown as PluginDefinition;

/** A verified member may upload; staff by their permission, as ever. */
const mayCreate = ({ principal }: { principal: Principal | null }) =>
  principal === null || principal.attributes.verified === true;

const FILES = {
  visibility: "private" as const,
  accept: ["application/pdf"],
  maxSize: 64 * 1024,
};

/** A small file that is a PDF by its bytes. */
function pdf(note: string): Buffer {
  return Buffer.from(
    `%PDF-1.4\n% ${note}\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n`
  );
}

/** HTML, whatever it is called. */
const HTML = Buffer.from("<html><body><script>alert(1)</script></body></html>");

describe.each(getConfiguredTestDialects())(
  "private file uploads (%s)",
  (dialect: TestDialect) => {
    let t: TestNextly;
    let storage: MemoryPrivateStorage;
    const ids: Record<string, string> = {};

    beforeAll(async () => {
      storage = new MemoryPrivateStorage();
      t = await createTestNextly({
        ...(dialect === "sqlite" ? {} : { dialect }),
        plugins: [accounts],
        storagePlugins: [storage.plugin([CONTRACTS, STAFF_ONLY])],
        collections: [
          defineCollection({
            slug: CONTRACTS,
            files: { ...FILES, principals: [KIND] },
            access: { create: mayCreate },
            fields: [text({ name: "note" })],
          }),
          // An ordinary collection, which has no file routes.
          defineCollection({
            slug: "notes",
            access: { create: mayCreate },
            fields: [text({ name: "note" })],
          }),
          defineCollection({
            slug: STAFF_ONLY,
            files: FILES,
            access: { create: mayCreate },
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
      // The first account holds super-admin; the others are ordinary staff.
      for (const name of ["owner", "uploader", "other", "stranger"]) {
        ids[name] = (
          await users.create({
            email: `${name}@example.com`,
            password: "Password123!",
            data: { name, isActive: true },
          })
        ).item.id;
      }
      for (const name of ["uploader", "other"]) {
        await grantTo(t, ids[name], "create", [CONTRACTS, STAFF_ONLY, "notes"]);
      }
    }, 120_000);

    afterAll(async () => {
      resetSessionStandingForTests();
      await t?.destroy();
    });

    /** A staff session's cookie, as the admin sends it. */
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

    async function post(
      path: string[],
      headers: Record<string, string>,
      body?: unknown
    ): Promise<{
      status: number;
      body: Record<string, unknown>;
      text: string;
      headers: Headers;
    }> {
      const res = await createDynamicHandlers().POST(
        new Request(`${ORIGIN}/admin/api/${path.join("/")}`, {
          method: "POST",
          headers: {
            origin: ORIGIN,
            "content-type": "application/json",
            ...headers,
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        }),
        { params: Promise.resolve({ params: path }) }
      );
      const text = await res.text();
      return {
        status: res.status,
        text,
        headers: res.headers,
        body: text ? (JSON.parse(text) as Record<string, unknown>) : {},
      };
    }

    const start = (
      headers: Record<string, string>,
      claim: Record<string, unknown>,
      collection = CONTRACTS
    ) => post(["files", collection, "uploads"], headers, claim);

    const complete = (
      headers: Record<string, string>,
      id: string,
      collection = CONTRACTS
    ) => post(["files", collection, "uploads", id, "complete"], headers);

    const claimFor = (bytes: Buffer, extra: Record<string, unknown> = {}) => ({
      filename: "note.pdf",
      mimeType: "application/pdf",
      size: bytes.length,
      ...extra,
    });

    type Started = {
      id: string;
      upload: {
        url: string;
        method: string;
        headers: Record<string, string>;
        expiresAt: string;
      };
    };
    const started = (res: { body: Record<string, unknown> }) =>
      res.body.item as Started;

    /** The entry as trusted code reads it. */
    async function entry(id: string, collection = CONTRACTS) {
      return (await new Nextly().findByID({
        collection,
        id,
      } as never)) as Record<string, unknown> | null;
    }

    async function entryCount(collection = CONTRACTS): Promise<number> {
      return (await new Nextly().count({ collection } as never)).total;
    }

    it("starts an upload for staff with the permission, recording it pending, and confirms the bytes", async () => {
      const bytes = pdf("staff upload");
      const res = await start(
        await staff("uploader"),
        claimFor(bytes, { data: { note: "kept" } })
      );
      expect(res.status).toBe(201);
      expect(res.headers.get("cache-control")).toBe("private, no-store");
      const { id, upload } = started(res);
      expect(upload.method).toBe("PUT");
      expect(
        new Date(upload.expiresAt).getTime() - Date.now()
      ).toBeLessThanOrEqual(300_000);

      const pending = (await entry(id))!;
      expect(pending).toMatchObject({
        note: "kept",
        filename: "note.pdf",
        mimeType: "application/pdf",
        size: bytes.length,
        fileStatus: "pending",
        uploadedByKind: "user",
        uploadedById: ids.uploader,
      });
      const key = String(pending.storageKey);
      expect(key).toMatch(/^files\/contracts\/[0-9a-f-]{36}$/);
      // The key reaches the caller only inside the short upload link itself,
      // which a signed PUT cannot do without, never as a value of its own.
      const keyId = key.slice("files/contracts/".length);
      expect(res.text.split(keyId)).toHaveLength(2);
      expect(new URL(upload.url).pathname).toBe(`/${key}`);
      expect(String(pending.slug)).not.toContain(keyId);
      expect(String(pending.title)).toBe("note.pdf");

      expect(storage.browserPut(upload, bytes).ok).toBe(true);
      const done = await complete(await staff("uploader"), id);
      expect(done.status).toBe(200);
      expect(done.body.item).toEqual({
        id,
        fileStatus: "ready",
        filename: "note.pdf",
        mimeType: "application/pdf",
        size: bytes.length,
      });
      expect(done.text).not.toContain(key);
      expect(await entry(id)).toMatchObject({
        fileStatus: "ready",
        sha256: createHash("sha256").update(bytes).digest("hex"),
      });

      // Confirming again answers as the first confirm did.
      const again = await complete(await staff("uploader"), id);
      expect(again.status).toBe(200);
      expect(again.body.item).toEqual(done.body.item);
    });

    it("keeps confirmed bytes where the upload link cannot write", async () => {
      const bytes = pdf("kept as checked");
      const { id, upload } = started(
        await start(await staff("uploader"), claimFor(bytes))
      );
      const uploadKey = String((await entry(id))!.storageKey);
      storage.browserPut(upload, bytes);
      expect((await complete(await staff("uploader"), id)).status).toBe(200);

      const ready = (await entry(id))!;
      const keptKey = String(ready.storageKey);
      expect(keptKey).not.toBe(uploadKey);
      expect(keptKey).toMatch(/^files\/contracts\/[0-9a-f-]{36}$/);
      expect(storage.objects.has(uploadKey)).toBe(false);

      // The link is still within its five minutes: content of the same
      // length sent through it again never reaches the confirmed file.
      const swap = Buffer.alloc(bytes.length, 0x41);
      expect(storage.browserPut(upload, swap).ok).toBe(true);
      expect(storage.objects.get(keptKey)?.bytes.equals(bytes)).toBe(true);
      expect((await entry(id))!.storageKey).toBe(keptKey);
    });

    it("removes a file's bytes when its entry is deleted, confirmed or not", async () => {
      const bytes = pdf("deleted with its entry");
      const done = started(
        await start(await staff("uploader"), claimFor(bytes))
      );
      storage.browserPut(done.upload, bytes);
      await complete(await staff("uploader"), done.id);
      const doneKey = String((await entry(done.id))!.storageKey);

      const waiting = started(
        await start(await staff("uploader"), claimFor(bytes))
      );
      storage.browserPut(waiting.upload, bytes);
      const waitingKey = String((await entry(waiting.id))!.storageKey);

      expect(storage.objects.has(doneKey)).toBe(true);
      expect(storage.objects.has(waitingKey)).toBe(true);
      for (const id of [done.id, waiting.id]) {
        await new Nextly().delete({ collection: CONTRACTS, id } as never);
      }
      await expect(entry(done.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
      expect(storage.objects.has(doneKey)).toBe(false);
      expect(storage.objects.has(waitingKey)).toBe(false);
    });

    it("refuses staff without the permission before anything is written", async () => {
      const before = await entryCount();
      const objects = storage.objects.size;
      const res = await start(
        await staff("stranger"),
        claimFor(pdf("refused"))
      );
      expect(res.status).toBe(403);
      expect(await entryCount()).toBe(before);
      expect(storage.objects.size).toBe(objects);
    });

    it("judges an API key by its own scope, never as the person who made it", async () => {
      const keys = t.getService("apiKeyService") as unknown as ApiKeyService;
      const mint = async (tokenType: "read-only" | "full-access") =>
        (
          await keys.createApiKey(ids.owner, {
            name: tokenType,
            tokenType,
            expiresIn: "unlimited",
          })
        ).key;
      const before = await entryCount();
      // The owner holds super-admin; a read-only key they made may not write.
      const readOnly = await start(
        { authorization: `Bearer ${await mint("read-only")}` },
        claimFor(pdf("read-only key"))
      );
      expect(readOnly.status).toBe(403);
      expect(await entryCount()).toBe(before);

      // Control: a full-access key of the same maker uploads, recorded as the key.
      const full = await start(
        { authorization: `Bearer ${await mint("full-access")}` },
        claimFor(pdf("full-access key"))
      );
      expect(full.status).toBe(201);
      expect(await entry(started(full).id)).toMatchObject({
        uploadedByKind: "apiKey",
      });
    });

    it("refuses a request with no caller, and a write from another site, before anything is written", async () => {
      const before = await entryCount();
      expect((await start({}, claimFor(pdf("nobody")))).status).toBe(401);
      const crossSite = await start(
        { ...(await staff("uploader")), origin: "https://elsewhere.example" },
        claimFor(pdf("cross-site"))
      );
      expect(crossSite.status).toBe(403);
      expect((crossSite.body.error as { code: string }).code).toBe(
        "CSRF_FAILED"
      );
      const crossSitePerson = await start(
        { ...member("m1"), origin: "https://elsewhere.example" },
        claimFor(pdf("cross-site person"))
      );
      expect((crossSitePerson.body.error as { code: string }).code).toBe(
        "CSRF_FAILED"
      );
      expect(await entryCount()).toBe(before);
    });

    it.each([
      [
        "a type the collection does not accept",
        { mimeType: "text/plain", filename: "note.txt" },
        "FILE_TYPE_NOT_ACCEPTED",
      ],
      ["a blocked extension", { filename: "note.html" }, "FILE_NAME_INVALID"],
      [
        "a name whose extension is another type's",
        { filename: "note.png" },
        "FILE_NAME_TYPE_MISMATCH",
      ],
      [
        "a size over the collection's limit",
        { size: 64 * 1024 + 1 },
        "FILE_TOO_LARGE",
      ],
      [
        "a name with a path in it",
        { filename: "../note.pdf" },
        "FILE_NAME_INVALID",
      ],
    ])("refuses %s before anything is written", async (_label, claim, code) => {
      const before = await entryCount();
      const res = await start(
        await staff("uploader"),
        claimFor(pdf("claim"), claim)
      );
      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body.error)).toContain(code);
      expect(await entryCount()).toBe(before);
    });

    it("rejects content of another type than claimed, deleting it", async () => {
      const res = await start(await staff("uploader"), claimFor(HTML));
      const { id, upload } = started(res);
      expect(storage.browserPut(upload, HTML).ok).toBe(true);
      const key = String((await entry(id))!.storageKey);

      const done = await complete(await staff("uploader"), id);
      expect(done.status).toBe(400);
      expect(JSON.stringify(done.body.error)).toContain("FILE_REJECTED");
      expect(await entry(id)).toMatchObject({
        fileStatus: "rejected",
        rejectReason: "type-mismatch",
      });
      expect(storage.objects.has(key)).toBe(false);
      // A rejected file stays rejected.
      expect((await complete(await staff("uploader"), id)).status).toBe(400);
    });

    it("rejects bytes of another size than claimed, where storage did not refuse them", async () => {
      const bytes = pdf("claimed size");
      const res = await start(await staff("uploader"), claimFor(bytes));
      const { id, upload } = started(res);
      // A bucket enforcing the signed length refuses the body outright.
      const longer = Buffer.concat([bytes, Buffer.from("more")]);
      expect(storage.browserPut(upload, longer).ok).toBe(false);
      // One that does not: the confirm reads the size back and refuses.
      storage.storeDirectly(upload, longer, "application/pdf");
      const done = await complete(await staff("uploader"), id);
      expect(done.status).toBe(400);
      expect(await entry(id)).toMatchObject({
        fileStatus: "rejected",
        rejectReason: "size-mismatch",
      });
    });

    it("keeps an upload pending while nothing has arrived, then confirms it", async () => {
      const bytes = pdf("late");
      const { id, upload } = started(
        await start(await staff("uploader"), claimFor(bytes))
      );
      const early = await complete(await staff("uploader"), id);
      expect(early.status).toBe(400);
      expect(JSON.stringify(early.body.error)).toContain("FILE_NOT_UPLOADED");
      expect((await entry(id))!.fileStatus).toBe("pending");
      storage.browserPut(upload, bytes);
      expect((await complete(await staff("uploader"), id)).status).toBe(200);
    });

    it("lets only the uploader confirm, answering anyone else as a missing upload", async () => {
      const bytes = pdf("not yours");
      const { id, upload } = started(
        await start(await staff("uploader"), claimFor(bytes))
      );
      storage.browserPut(upload, bytes);
      const missing = await complete(
        await staff("other"),
        "00000000-0000-4000-8000-000000000000"
      );
      for (const headers of [
        await staff("other"),
        await staff("owner"),
        member("m1"),
      ]) {
        const refused = await complete(headers, id);
        expect(refused.status).toBe(404);
        expect((refused.body.error as { code: string }).code).toBe(
          (missing.body.error as { code: string }).code
        );
        expect((refused.body.error as { message: string }).message).toBe(
          (missing.body.error as { message: string }).message
        );
      }
      expect((await entry(id))!.fileStatus).toBe("pending");
      // Control: the uploader confirms it.
      expect((await complete(await staff("uploader"), id)).status).toBe(200);
    });

    it("lets a signed-in person of a named kind upload, judged by the collection's rules", async () => {
      const bytes = pdf("member upload");
      const res = await start(member("m1"), claimFor(bytes));
      expect(res.status).toBe(201);
      const { id, upload } = started(res);
      expect(await entry(id)).toMatchObject({
        uploadedByKind: KIND,
        uploadedById: "m1",
      });
      storage.browserPut(upload, bytes);
      // Another member is not the uploader.
      expect((await complete(member("m2"), id)).status).toBe(404);
      expect((await complete(member("m1"), id)).status).toBe(200);

      // The collection's rule refuses an unverified member, before anything is written.
      const before = await entryCount();
      expect(
        (await start(member("m3"), claimFor(pdf("unverified")))).status
      ).toBe(403);
      expect(await entryCount()).toBe(before);
    });

    it("does not recognise a person on a collection that names no kind", async () => {
      const before = await entryCount(STAFF_ONLY);
      expect(
        (await start(member("m1"), claimFor(pdf("no kinds")), STAFF_ONLY))
          .status
      ).toBe(401);
      expect(await entryCount(STAFF_ONLY)).toBe(before);
      // Control: staff upload to it.
      expect(
        (
          await start(
            await staff("uploader"),
            claimFor(pdf("staff ok")),
            STAFF_ONLY
          )
        ).status
      ).toBe(201);
    });

    it("answers a collection without files as it answers a missing one", async () => {
      const unknown = await start(
        await staff("uploader"),
        claimFor(pdf("x")),
        "no-such-thing"
      );
      expect(unknown.status).toBe(404);
      const before = await entryCount("notes");
      for (const slug of ["users", "notes"]) {
        const res = await start(
          await staff("uploader"),
          claimFor(pdf("x")),
          slug
        );
        expect(res.status, slug).toBe(404);
        expect(res.text.replace(/"requestId":"[^"]*"/, ""), slug).toBe(
          unknown.text.replace(/"requestId":"[^"]*"/, "")
        );
      }
      expect(await entryCount("notes")).toBe(before);
    });

    it("refuses a confirm that comes after the wait, deleting the bytes", async () => {
      const bytes = pdf("too late");
      const { id, upload } = started(
        await start(member("m1"), claimFor(bytes))
      );
      storage.browserPut(upload, bytes);
      const key = String((await entry(id))!.storageKey);
      // Only the clock the confirm reads moves; a member has no token to expire.
      vi.useFakeTimers({ toFake: ["Date"], now: Date.now() + 2 * 3600_000 });
      let late: Awaited<ReturnType<typeof complete>>;
      try {
        late = await complete(member("m1"), id);
      } finally {
        vi.useRealTimers();
      }
      expect(late.status).toBe(400);
      expect(JSON.stringify(late.body.error)).toContain("FILE_REJECTED");
      expect(await entry(id)).toMatchObject({
        fileStatus: "rejected",
        rejectReason: "abandoned",
      });
      expect(storage.objects.has(key)).toBe(false);
    });

    it("cleans up uploads never confirmed past their wait, leaving fresh ones", async () => {
      const bytes = pdf("abandoned");
      const old = started(
        await start(await staff("uploader"), claimFor(bytes))
      );
      storage.browserPut(old.upload, bytes);
      const key = String((await entry(old.id))!.storageKey);
      const sweep = (now: Date) =>
        sweepAbandonedUploads(
          {
            collections: () => [
              { slug: CONTRACTS, files: FILES },
              { slug: STAFF_ONLY, files: FILES },
            ],
            entries: () =>
              container.get<CollectionsHandler>("collectionsHandler"),
          },
          now
        );
      // Now, within the hour, nothing is swept; nor just past it, while a
      // confirm that began in time may still be checking the bytes.
      await sweep(new Date());
      await sweep(new Date(Date.now() + 3600_000 + 60_000));
      expect((await entry(old.id))!.fileStatus).toBe("pending");
      expect(storage.objects.has(key)).toBe(true);

      // The controlled clock: the sweep runs as if two hours had passed, then
      // the fresh upload is made, still within its hour of that.
      const later = new Date(Date.now() + 2 * 3600_000);
      const swept = await sweep(later);
      expect(swept).toBeGreaterThanOrEqual(1);
      expect(await entry(old.id)).toMatchObject({
        fileStatus: "rejected",
        rejectReason: "abandoned",
      });
      expect(storage.objects.has(key)).toBe(false);
      const fresh = started(
        await start(await staff("uploader"), claimFor(pdf("fresh")))
      );
      await sweep(new Date());
      expect((await entry(fresh.id))!.fileStatus).toBe("pending");
      // A late confirm of the swept upload is refused.
      expect((await complete(await staff("uploader"), old.id)).status).toBe(
        400
      );
    });
  }
);

describe("starting an app with a private collection", () => {
  it("is refused when no storage that keeps files private takes the collection", async () => {
    // No storage plugin: the collection would fall to the local disk, which
    // serves every file publicly, so the start is refused rather than served.
    await expect(
      createTestNextly({
        collections: [
          defineCollection({ slug: CONTRACTS, files: FILES, fields: [] }),
        ],
      })
    ).rejects.toMatchObject({ code: "CONFIGURATION_ERROR" });

    // Control: the same collection on private storage starts.
    const storage = new MemoryPrivateStorage();
    const started = await createTestNextly({
      storagePlugins: [storage.plugin([CONTRACTS])],
      collections: [
        defineCollection({ slug: CONTRACTS, files: FILES, fields: [] }),
      ],
    });
    await started.destroy();
  });
});
