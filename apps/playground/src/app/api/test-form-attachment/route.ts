import { getNextly } from "@revnixhq/nextly";

import nextlyConfig from "../../../../nextly.config";

/**
 * Full end-to-end form notification attachment test.
 *
 * GET  → shows existing forms
 * POST → creates form + submission, notification hook fires with attachment
 *
 * POST body: { "to": "recipient@email.com", "mediaId": "..." }
 */

export async function GET() {
  try {
    const nextly = await getNextly({ config: nextlyConfig });
    const forms = await nextly.find({ collection: "forms", limit: 10 });
    return Response.json({ forms: forms.docs });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const { to, mediaId } = await request.json();
    if (!to || !mediaId) {
      return Response.json(
        { error: 'Body must include "to" and "mediaId"' },
        { status: 400 }
      );
    }

    const nextly = await getNextly({ config: nextlyConfig });

    // Step 1: Find or create a test form
    let form: any;
    const existing = await nextly.find({
      collection: "forms",
      where: { slug: { equals: "attach-test" } },
      limit: 1,
    });
    form = existing?.docs?.[0];

    if (!form) {
      console.log("[e2e] Creating test form...");
      form = await nextly.create({
        collection: "forms",
        data: {
          name: "Attach Test",
          slug: "attach-test",
          fields: [
            {
              id: "f-name",
              type: "text",
              name: "fullName",
              label: "Full Name",
              required: true,
              width: "full",
            },
            {
              id: "f-resume",
              type: "file",
              name: "resume",
              label: "Resume",
              required: false,
              width: "full",
              attachToEmail: true,
            },
          ],
          notifications: [
            {
              id: "n1",
              name: "Notify HR",
              enabled: true,
              recipientType: "static",
              to,
              cc: [],
              bcc: [],
              templateSlug: "welcome",
            },
          ],
          status: "published",
          settings: {
            confirmationType: "message",
            confirmationMessage: "Thanks!",
          },
        },
      });
      console.log("[e2e] Form created:", form.id);
    } else {
      console.log("[e2e] Reusing form:", form.id);
    }

    // Step 2: Create a submission — triggers afterCreate hook → notification
    console.log("[e2e] Creating submission with mediaId:", mediaId);
    const submission = await nextly.create({
      collection: "form-submissions",
      data: {
        form: form.id,
        status: "submitted",
        submittedAt: new Date().toISOString(),
        data: {
          fullName: "E2E Tester",
          resume: mediaId,
        },
      },
    });

    console.log("[e2e] Submission created:", submission.id);

    return Response.json({
      success: true,
      formId: form.id,
      submissionId: submission.id,
      note: `Form submitted. If notification hook fired, check ${to} for email with attachment.`,
    });
  } catch (error: any) {
    console.error("[e2e] Full error:", error);
    return Response.json(
      {
        error: error.message,
        code: error.code,
        detail: error.detail || error.cause || undefined,
      },
      { status: 500 }
    );
  }
}
