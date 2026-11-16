/**
 * A form's file uploads, on every dialect.
 *
 * The upload route stores a file for one file field of an open form and
 * records it, and refuses one for a form that is not open, a field that is
 * not a file field, a type or size the field does not take, and a visitor
 * past the limit. A submission a request writes may name only uploads issued
 * for its own form and field that no other submission claimed, and claims
 * them in its own transaction; an update keeps the ids a submission already
 * holds; a write no request produced is trusted. Deleting a submission (by a
 * person, with its form, or by the nightly pass) deletes the files it held
 * once the deletion commits, unless the site uses one or another submission
 * still names it, and the nightly pass deletes the uploads no submission
 * claimed within a day.
 */
import { definePlugin, type PluginContext } from "@nextlyhq/plugin-sdk";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
import { NextlyError, runJobsPass } from "nextly";
import { defineCollection, text, upload } from "nextly/config";
import { createDynamicHandlers } from "nextly/runtime";
import { afterEach, describe, expect, it } from "vitest";

import { FORM_UPLOADS_SLUG } from "../collections/uploads";
import { UPLOAD_NOT_CLAIMABLE } from "../handlers/upload-claims";
import { RETENTION_JOB } from "../handlers/retention";
import { formBuilder } from "../plugin";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The key core records a built media usage record under, as a new site's is
 * from the start: until it is set, every file reads as in use and nothing is
 * deleted on a guess.
 */
const USAGE_RECORDED = "media.usage.recorded:3";

const FIELDS = [
  { type: "text", name: "name", label: "Name" },
  {
    type: "file",
    name: "cv",
    label: "CV",
    accept: ".pdf,application/pdf",
    maxFileSize: 2048,
  },
  {
    type: "file",
    name: "papers",
    label: "Papers",
    accept: "application/pdf",
    multiple: true,
  },
];

/** A site collection whose documents use media, as a page's cover does. */
const POSTS = defineCollection({
  slug: "fu_posts",
  fields: [
    text({ name: "title" }),
    upload({ name: "cover", relationTo: "media" }),
  ],
});

/** A small PDF, told apart by `marker`. */
function pdf(marker: string): Buffer {
  return Buffer.from(`%PDF-1.4\n%${marker}\n%%EOF\n`, "ascii");
}

/** A one-pixel GIF: a type the media library takes by default. */
const GIF = Buffer.from(
  "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
  "base64"
);

/** The catch-all's params for a `/api/...` path, as Next.js supplies them. */
function params(...segments: string[]) {
  return { params: Promise.resolve({ params: segments }) };
}

interface UploadRow {
  id: string;
  media: string;
  form: string;
  field: string;
  submission?: string | null;
  releasedAt?: unknown;
}

interface Answer {
  status: number;
  body: Record<string, unknown> & {
    error?: { message?: string; data?: { errors?: Array<{ path: string }> } };
  };
}

let current: TestNextly | undefined;
let probe: PluginContext | undefined;
/** A fresh visitor address per boot, so no rate window carries over. */
let visitor = 10;

afterEach(async () => {
  const instance = current;
  current = undefined;
  probe = undefined;
  await instance?.destroy();
});

async function boot(
  dialect: TestDialect,
  rateLimit = { maxSubmissions: 10, windowMs: 60_000 }
) {
  const fb = formBuilder({
    spamProtection: {
      honeypot: false,
      recaptcha: { enabled: false },
      rateLimit,
    },
  });
  current = await createTestNextly({
    dialect,
    plugins: [
      fb.plugin,
      definePlugin({
        name: "@test/fb-uploads-probe",
        version: "1.0.0",
        nextly: ">=0.0.0",
        init: ctx => {
          probe = ctx;
        },
      }),
    ],
    collections: [POSTS],
    seedPublic: true,
    // The visitor's address is read from `x-forwarded-for`, as behind a proxy.
    security: { trustProxy: true },
  });
  const t = current;
  const meta = t.getService("metaService" as never) as unknown as {
    set(key: string, value: unknown): Promise<void>;
  };
  await meta.set(USAGE_RECORDED, { rebuiltAt: new Date().toISOString() });

  const form = async (slug: string, status = "published") =>
    String(
      (
        await t.nextly.create({
          collection: "forms",
          data: { name: slug, slug, status, fields: FIELDS },
        })
      ).item.id
    );
  const applyId = await form("apply");
  const otherId = await form("other");
  const handlers = createDynamicHandlers();
  const ip = `203.0.113.${visitor++}`;

  const answer = async (res: Response): Promise<Answer> => ({
    status: res.status,
    body: (await res.json()) as Answer["body"],
  });

  /** A visitor's upload of `file` for `field` of the form at `slug`. */
  const uploadTo = async (
    slug: string,
    field: string,
    file = { name: "cv.pdf", type: "application/pdf", bytes: pdf("cv") }
  ) => {
    const body = new FormData();
    body.append("field", field);
    body.append(
      "file",
      new File([new Uint8Array(file.bytes)], file.name, { type: file.type })
    );
    return answer(
      await handlers.POST(
        new Request(`http://localhost/api/forms/${slug}/upload`, {
          method: "POST",
          body,
          headers: { "x-forwarded-for": ip },
        }),
        params("forms", slug, "upload")
      )
    );
  };

  /** The media id of a visitor's accepted upload. */
  const uploaded = async (slug: string, field: string, marker = field) => {
    const res = await uploadTo(slug, field, {
      name: `${marker}.pdf`,
      type: "application/pdf",
      bytes: pdf(marker),
    });
    expect(res.status).toBe(201);
    return String(res.body.mediaId);
  };

  /** A visitor's submission to the form at `slug`. */
  const submit = async (slug: string, data: Record<string, unknown>) =>
    answer(
      await handlers.POST(
        new Request(`http://localhost/api/forms/${slug}/submit`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-forwarded-for": ip,
          },
          body: JSON.stringify({ data }),
        }),
        params("forms", slug, "submit")
      )
    );

  const uploads = async () =>
    (await t.nextly.find({ collection: FORM_UPLOADS_SLUG, limit: 100 }))
      .items as unknown as UploadRow[];
  const uploadOf = async (mediaId: string) =>
    (await uploads()).find(row => row.media === mediaId);

  const submissionIds = async () =>
    (
      await t.nextly.find({ collection: "form-submissions", limit: 100 })
    ).items.map(item => String((item as { id: unknown }).id));

  const mediaExists = async (id: string) => {
    try {
      await probe!.services.media.findById(id, {});
      return true;
    } catch (error) {
      if (NextlyError.isNotFound(error)) return false;
      throw error;
    }
  };

  /** A file put in the library some other way: a site's own logo, say. */
  const libraryFile = async (marker: string) => {
    const bytes = pdf(marker);
    return (
      await probe!.services.media.upload(
        {
          buffer: bytes,
          filename: `${marker}.pdf`,
          mimeType: "application/pdf",
          size: bytes.length,
        },
        { as: "system" }
      )
    ).id;
  };

  /** An edit of a submission's answers that a request made, as staff's is. */
  const requestEdit = (id: string, data: Record<string, unknown>) =>
    probe!.services.collections.updateEntry(
      "form-submissions",
      id,
      { data, _overwrite: true },
      {
        as: "system",
        request: new Request("http://localhost/admin/api/edit", {
          headers: { "x-forwarded-for": ip },
        }),
      }
    );

  /** Make a stored row look `days` old, by its `createdAt`. */
  const age = async (table: string, id: string, days: number) => {
    await t.adapter.update(
      table,
      { created_at: new Date(Date.now() - days * DAY_MS) },
      { and: [{ column: "id", op: "=", value: id }] }
    );
  };

  /** The retention job, queued as its schedule queues it, and one pass. */
  const runRetention = async () => {
    await t.nextly.jobs.queue({ task: RETENTION_JOB, input: null } as never);
    await runJobsPass(t.adapter as never, t.getService("jobRegistry" as never));
  };

  return {
    t,
    applyId,
    otherId,
    form,
    uploadTo,
    uploaded,
    submit,
    uploads,
    uploadOf,
    submissionIds,
    mediaExists,
    libraryFile,
    requestEdit,
    age,
    runRetention,
  };
}

/** The paths a refusal names. */
function refusedPaths(res: Answer): string[] {
  return (res.body.error?.data?.errors ?? []).map(error => error.path);
}

describe.each(getConfiguredTestDialects())(
  "the form upload route (%s)",
  dialect => {
    it("stores a file for an open form's file field and records the upload", async () => {
      const { applyId, uploadTo, uploads, mediaExists } = await boot(dialect);

      const res = await uploadTo("apply", "cv");

      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        message: "File uploaded.",
        field: "cv",
        mimeType: "application/pdf",
      });
      const mediaId = String(res.body.mediaId);
      expect(await mediaExists(mediaId)).toBe(true);
      expect(await uploads()).toEqual([
        expect.objectContaining({
          media: mediaId,
          form: applyId,
          field: "cv",
          submission: null,
        }),
      ]);
    });

    it("refuses a form that is not open, a field that takes no file, and a file the field does not take", async () => {
      const { t, form, uploadTo, uploads } = await boot(dialect);
      await form("drafted", "draft");
      // Published first, then closed: a form is explained as closed only
      // once it has been public; one never published reads as absent.
      await t.nextly.update({
        collection: "forms",
        id: await form("ended"),
        data: { status: "closed", _overwrite: true },
      });

      expect((await uploadTo("nobody", "cv")).status).toBe(404);
      expect((await uploadTo("drafted", "cv")).status).toBe(404);
      expect((await uploadTo("ended", "cv")).status).toBe(409);

      const textField = await uploadTo("apply", "name");
      expect(textField.status).toBe(400);
      expect(refusedPaths(textField)).toEqual(["field"]);

      // A type the media library takes, and the field does not.
      const wrongType = await uploadTo("apply", "cv", {
        name: "dot.gif",
        type: "image/gif",
        bytes: GIF,
      });
      expect(wrongType.status).toBe(400);
      expect(wrongType.body.error?.data?.errors).toEqual([
        expect.objectContaining({ path: "file", code: "INVALID_TYPE" }),
      ]);

      // Over the field's own 2 KB.
      const tooLarge = await uploadTo("apply", "cv", {
        name: "big.pdf",
        type: "application/pdf",
        bytes: Buffer.concat([pdf("big"), Buffer.alloc(4096, 32)]),
      });
      expect(tooLarge.status).toBe(400);
      expect(tooLarge.body.error?.data?.errors).toEqual([
        expect.objectContaining({ path: "file", code: "SIZE_EXCEEDED" }),
      ]);

      // Nothing refused was kept.
      expect(await uploads()).toEqual([]);
    });

    it("refuses a visitor past five uploads per submission the limit allows", async () => {
      const { uploadTo } = await boot(dialect, {
        maxSubmissions: 1,
        windowMs: 60_000,
      });
      for (let i = 0; i < 5; i += 1) {
        expect((await uploadTo("apply", "papers")).status).toBe(201);
      }
      expect((await uploadTo("apply", "papers")).status).toBe(429);
    });
  }
);

describe.each(getConfiguredTestDialects())(
  "what a submission's file answer may name (%s)",
  dialect => {
    it("claims a visitor's own upload for the new submission, in its write", async () => {
      const { uploaded, submit, uploadOf, submissionIds } = await boot(dialect);
      const cv = await uploaded("apply", "cv");
      const papers = [
        await uploaded("apply", "papers", "p1"),
        await uploaded("apply", "papers", "p2"),
      ];

      const res = await submit("apply", { name: "Ada", cv, papers });

      expect(res.status).toBe(201);
      const id = String(res.body.submissionId);
      expect(await submissionIds()).toEqual([id]);
      for (const mediaId of [cv, ...papers]) {
        expect((await uploadOf(mediaId))?.submission).toBe(id);
      }
    });

    it("refuses a file the route did not issue, and stores nothing", async () => {
      const { libraryFile, submit, submissionIds } = await boot(dialect);
      const logo = await libraryFile("logo");

      const res = await submit("apply", { name: "Ada", cv: logo });

      expect(res.status).toBe(400);
      expect(res.body.error?.data?.errors).toEqual([
        { path: "cv", code: "INVALID", message: UPLOAD_NOT_CLAIMABLE },
      ]);
      expect(await submissionIds()).toEqual([]);
    });

    it("refuses an upload another submission has claimed", async () => {
      const { uploaded, submit, submissionIds, uploadOf } = await boot(dialect);
      const cv = await uploaded("apply", "cv");
      const first = await submit("apply", { name: "Ada", cv });
      expect(first.status).toBe(201);

      const second = await submit("apply", { name: "Eve", cv });

      expect(second.status).toBe(400);
      expect(refusedPaths(second)).toEqual(["cv"]);
      expect(await submissionIds()).toEqual([String(first.body.submissionId)]);
      expect((await uploadOf(cv))?.submission).toBe(
        String(first.body.submissionId)
      );
    });

    it("refuses an upload made for another field, or another form", async () => {
      const { uploaded, submit, submissionIds, uploadOf } = await boot(dialect);
      const paper = await uploaded("apply", "papers");
      const elsewhere = await uploaded("other", "cv");

      const wrongField = await submit("apply", { name: "Ada", cv: paper });
      const wrongForm = await submit("apply", { name: "Ada", cv: elsewhere });

      expect(wrongField.status).toBe(400);
      expect(refusedPaths(wrongField)).toEqual(["cv"]);
      expect(wrongForm.status).toBe(400);
      expect(refusedPaths(wrongForm)).toEqual(["cv"]);
      expect(await submissionIds()).toEqual([]);
      // And neither was claimed by the refused write.
      expect((await uploadOf(paper))?.submission).toBeNull();
      expect((await uploadOf(elsewhere))?.submission).toBeNull();
    });

    it("keeps the ids an edit sends back, and refuses one it adds", async () => {
      const { t, applyId, requestEdit, libraryFile } = await boot(dialect);
      // A submission stored with a file the route never issued, as one
      // stored by server code, or before uploads were recorded, is.
      const legacy = await libraryFile("legacy");
      const id = String(
        (
          await t.nextly.create({
            collection: "form-submissions",
            data: {
              form: applyId,
              data: { name: "Ada", cv: legacy },
              status: "new",
              submittedAt: new Date(),
            },
          })
        ).item.id
      );

      // Another answer edited, the file answer sent back as it was.
      await requestEdit(id, { name: "Ada Lovelace", cv: legacy });
      const stored = (await t.nextly.findByID({
        collection: "form-submissions",
        id,
      })) as { data: Record<string, unknown> };
      expect(stored.data).toMatchObject({ name: "Ada Lovelace", cv: legacy });

      // A file the submission does not hold, named by the edit.
      const logo = await libraryFile("logo");
      await expect(
        requestEdit(id, { name: "Ada Lovelace", cv: legacy, papers: [logo] })
      ).rejects.toMatchObject({
        publicData: {
          errors: [{ path: "papers", message: UPLOAD_NOT_CLAIMABLE }],
        },
      });
    });

    it("trusts a write no request produced, claiming an issued upload it names", async () => {
      const { t, applyId, uploaded, libraryFile, uploadOf } =
        await boot(dialect);
      const cv = await uploaded("apply", "cv");
      const logo = await libraryFile("logo");

      const created = await t.nextly.create({
        collection: "form-submissions",
        data: {
          form: applyId,
          data: { name: "Ada", cv, papers: [logo] },
          status: "new",
          submittedAt: new Date(),
        },
      });

      expect((await uploadOf(cv))?.submission).toBe(String(created.item.id));
    });
  }
);

describe.each(getConfiguredTestDialects())(
  "deleting what holds files (%s)",
  dialect => {
    it("deletes a submission's files after it is deleted, keeping one the site uses", async () => {
      const { t, uploaded, submit, mediaExists, uploads } = await boot(dialect);
      const cv = await uploaded("apply", "cv");
      const paper = await uploaded("apply", "papers");
      const id = String(
        (await submit("apply", { name: "Ada", cv, papers: [paper] })).body
          .submissionId
      );
      // The site puts the visitor's paper on a page.
      await t.nextly.create({
        collection: "fu_posts",
        data: { title: "Featured", cover: paper },
      });

      await t.nextly.delete({ collection: "form-submissions", id });

      expect(await mediaExists(cv)).toBe(false);
      expect(await mediaExists(paper)).toBe(true);
      // The one kept stays recorded, released, for the next pass to ask again.
      expect(await uploads()).toEqual([
        expect.objectContaining({
          media: paper,
          releasedAt: expect.anything(),
        }),
      ]);
    });

    it("keeps a file while another submission a trusted write stored still names it", async () => {
      const { t, applyId, uploaded, submit, mediaExists, uploads } =
        await boot(dialect);
      const cv = await uploaded("apply", "cv");
      const first = String(
        (await submit("apply", { name: "Ada", cv })).body.submissionId
      );
      // Server code stores a second submission naming the same file.
      const second = String(
        (
          await t.nextly.create({
            collection: "form-submissions",
            data: {
              form: applyId,
              data: { name: "Copy of Ada", cv },
              status: "new",
              submittedAt: new Date(),
            },
          })
        ).item.id
      );

      await t.nextly.delete({ collection: "form-submissions", id: first });

      expect(await mediaExists(cv)).toBe(true);
      expect((await uploads()).map(row => row.submission)).toEqual([second]);

      // The last submission naming it goes, and the file with it.
      await t.nextly.delete({ collection: "form-submissions", id: second });

      expect(await mediaExists(cv)).toBe(false);
      expect(await uploads()).toEqual([]);
    });

    it("deletes the files of a form's submissions, and its unclaimed uploads, with the form", async () => {
      const { t, applyId, uploaded, submit, mediaExists, uploads } =
        await boot(dialect);
      const cv = await uploaded("apply", "cv");
      const unclaimed = await uploaded("apply", "papers");
      const kept = await uploaded("other", "cv");
      await submit("apply", { name: "Ada", cv });

      await t.nextly.delete({ collection: "forms", id: applyId });

      expect(await mediaExists(cv)).toBe(false);
      expect(await mediaExists(unclaimed)).toBe(false);
      expect(await mediaExists(kept)).toBe(true);
      expect((await uploads()).map(row => row.media)).toEqual([kept]);
    });

    it("deletes an aged submission's files in the nightly pass, and unclaimed uploads after a day", async () => {
      const {
        t,
        applyId,
        uploaded,
        submit,
        mediaExists,
        uploadOf,
        uploads,
        age,
        runRetention,
      } = await boot(dialect);
      await t.nextly.update({
        collection: "forms",
        id: applyId,
        data: { settings: { keepDays: 30 }, _overwrite: true },
      });
      const oldCv = await uploaded("apply", "cv", "old");
      const newCv = await uploaded("apply", "cv", "new");
      const used = await uploaded("apply", "papers", "used");
      const old = String(
        (await submit("apply", { name: "Old", cv: oldCv, papers: [used] })).body
          .submissionId
      );
      await submit("apply", { name: "New", cv: newCv });
      await t.nextly.create({
        collection: "fu_posts",
        data: { title: "Featured", cover: used },
      });
      await age("dc_form_submissions", old, 40);
      const abandoned = await uploaded("apply", "papers", "abandoned");
      const fresh = await uploaded("apply", "papers", "fresh");
      await age("dc_form_uploads", (await uploadOf(abandoned))!.id, 2);

      await runRetention();
      // A second run finds nothing more to do, and fails at nothing.
      await runRetention();

      expect(await mediaExists(oldCv)).toBe(false);
      expect(await mediaExists(abandoned)).toBe(false);
      // Another submission's file, a file the site uses, and an upload made
      // within the day all stay.
      expect(await mediaExists(newCv)).toBe(true);
      expect(await mediaExists(used)).toBe(true);
      expect(await mediaExists(fresh)).toBe(true);
      expect((await uploads()).map(row => row.media).sort()).toEqual(
        [newCv, used, fresh].sort()
      );
    });

    it("finishes a released upload whose file is already gone", async () => {
      const { t, uploaded, submit, uploads, runRetention } =
        await boot(dialect);
      const cv = await uploaded("apply", "cv");
      const id = String(
        (await submit("apply", { name: "Ada", cv })).body.submissionId
      );
      // The file deleted from the library first, then the submission, as a
      // run that stopped between deleting a file and its record leaves it.
      await probe!.services.media.delete(cv, { as: "system" });
      await t.nextly.delete({ collection: "form-submissions", id });

      await runRetention();

      expect(await uploads()).toEqual([]);
    });
  }
);
