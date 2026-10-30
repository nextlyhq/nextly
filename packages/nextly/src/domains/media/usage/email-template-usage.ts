/**
 * Which media items an email template uses, read from its stored row.
 *
 * A template refers to an item in two ways: as a default attachment, by the
 * item's id, and as an image in its HTML, by the item's address in an
 * `<img src>`. A layout is a template too, and is read the same way.
 *
 * @module domains/media/usage/email-template-usage
 */

import type { MediaReference } from "./media-references";
import {
  removeDocumentUsage,
  replaceDocumentUsage,
  type LocatedMediaReference,
  type UsageDb,
  type UsageSubject,
} from "./media-usage-store";

/** The table the templates are stored in. */
const EMAIL_TEMPLATES_TABLE = "email_templates";

/** Every `<img src>` address in an HTML string. */
const IMG_SRC = /<img\b[^>]*?\bsrc\s*=\s*(["'])(.*?)\1/gi;

function parsedList(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string" || value.trim() === "") return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** The references a stored template row makes, by the field that makes each. */
export function emailTemplateReferences(
  row: Record<string, unknown>
): MediaReference[] {
  const refs: MediaReference[] = [];
  for (const attachment of parsedList(row.attachments)) {
    const mediaId =
      typeof attachment === "object" && attachment !== null
        ? (attachment as { mediaId?: unknown }).mediaId
        : undefined;
    if (typeof mediaId === "string" && mediaId !== "") {
      refs.push({ fieldPath: "attachments", mediaId });
    }
  }
  const html = row.htmlContent ?? row.html_content;
  if (typeof html === "string") {
    for (const match of html.matchAll(IMG_SRC)) {
      const url = match[2];
      if (url) refs.push({ fieldPath: "htmlContent", url });
    }
  }
  return refs;
}

/** The record's subject for one template. */
function emailTemplateSubject(templateId: string): UsageSubject {
  return { kind: "email-template", slug: "", documentId: templateId };
}

/**
 * Rewrite the record of which media items the template uses from its stored
 * row, on `db`: the transaction of the write that changed it. A template that
 * is gone keeps no record.
 */
export async function recordEmailTemplateUsage(
  db: UsageDb,
  templateId: string
): Promise<void> {
  const subject = emailTemplateSubject(templateId);
  const [row] = await db.select<Record<string, unknown>>(
    EMAIL_TEMPLATES_TABLE,
    {
      columns: ["id", "attachments", "htmlContent"],
      where: { and: [{ column: "id", op: "=", value: templateId }] },
      limit: 1,
    }
  );
  if (row === undefined) {
    await removeDocumentUsage(db, subject);
    return;
  }
  const refs: LocatedMediaReference[] = emailTemplateReferences(row).map(
    ref => ({ ...ref, locale: "" })
  );
  await replaceDocumentUsage(db, subject, refs);
}
