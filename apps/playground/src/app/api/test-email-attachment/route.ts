import { getNextly } from "@revnixhq/nextly";

import nextlyConfig from "../../../../nextly.config";

/**
 * Test route for email attachment E2E verification.
 *
 * GET  → lists all media files (find one to use as mediaId)
 * POST → sends a test email with an attachment
 *
 * Body: { "to": "recipient@example.com", "mediaId": "..." }
 */

export async function GET() {
  try {
    const nextly = await getNextly({ config: nextlyConfig });

    // List media to find available files
    const media = await nextly.media.find({ limit: 20 });

    return Response.json({
      message: "Available media files. Pick a mediaId for POST.",
      media: media.docs.map((m: any) => ({
        id: m.id,
        filename: m.filename ?? m.originalFilename,
        mimeType: m.mimeType,
        size: m.size,
        url: m.url,
      })),
    });
  } catch (error) {
    return Response.json(
      {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const { to, mediaId } = await request.json();

    if (!to || !mediaId) {
      return Response.json(
        { error: 'Body must include "to" (email) and "mediaId" (string)' },
        { status: 400 }
      );
    }

    const nextly = await getNextly({ config: nextlyConfig });

    console.log("[test-email-attachment] Sending email with attachment...", {
      to,
      mediaId,
    });

    const result = await nextly.email.send({
      to,
      subject: "Nextly Attachment Test",
      html: `
        <h1>Email Attachment Test</h1>
        <p>If you see this with an attachment, Plan 24 works end-to-end!</p>
        <p>Media ID: <code>${mediaId}</code></p>
        <p>Sent at: ${new Date().toISOString()}</p>
      `,
      attachments: [{ mediaId }],
    });

    console.log("[test-email-attachment] Result:", result);

    return Response.json({
      message: "Email send attempted",
      result,
    });
  } catch (error) {
    console.error("[test-email-attachment] Error:", error);
    return Response.json(
      {
        error: error instanceof Error ? error.message : String(error),
        code: (error as any)?.code,
        stack: error instanceof Error ? error.stack : undefined,
      },
      { status: 500 }
    );
  }
}
