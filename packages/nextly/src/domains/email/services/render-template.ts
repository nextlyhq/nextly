/**
 * The one composition of an email template into what a recipient receives.
 *
 * Sending and previewing both call this. A narrower view — the preview
 * surfaces' `{ subject, html }` — is DERIVED from the result rather than
 * computed alongside it: the two compositions that existed before agreed when
 * they were written and had drifted on four observable properties by the time
 * they were unified, each in the flattering direction, because a preview that
 * omits something looks correct.
 *
 * Pure, and layout-INJECTED rather than layout-resolving. Resolving which
 * layout wraps a template needs the database; composing with it does not, and
 * only the second half belongs here. That split is what lets an unsaved draft
 * be rendered through the same code as a saved row.
 */
import type {
  EmailTemplateKind,
  EmailTemplateRecord,
} from "../../../schemas/email-templates/types";

import { htmlToText, interpolateTemplate } from "./template-engine";

/** The slot a layout declares for the message body. */
const CONTENT_MARKER = "{{content}}";

/**
 * The product name used when nothing is configured.
 *
 * Declared once and imported by every caller that needs a fallback: a second
 * literal is a second answer to the same question, and the two would drift
 * exactly as the two compositions this module replaced did.
 */
export const DEFAULT_APP_NAME = "Nextly";

/**
 * The wrapper for the inbox preview line.
 *
 * Hidden in every client that honours inline styles, so it contributes preview
 * text without appearing in the rendered body.
 */
const PREHEADER_OPEN =
  '<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">';

/**
 * What a render needs from a template, whether or not it has been saved.
 *
 * Structurally satisfied by `EmailTemplateRecord`, so a saved row is passed
 * directly and a draft supplies the same fields.
 */
export interface TemplateFields {
  subject: string;
  htmlContent: string;
  plainTextContent: string | null;
  preheader: string | null;
  useLayout: boolean;
  kind: EmailTemplateKind;
}

/** The complete artifact: everything the transport is handed. */
export interface RenderedTemplate {
  subject: string;
  /** Layout-wrapped, with the preheader prepended. */
  html: string;
  /** The authored plain text, else one derived from the body. */
  text: string;
}

export interface RenderTemplateOptions {
  /** Value for `{{appName}}` when the caller's data supplies none. */
  appName: string;
}

export function renderTemplate(
  template: TemplateFields,
  layout: Pick<EmailTemplateRecord, "htmlContent"> | null,
  data: Record<string, unknown>,
  options: RenderTemplateOptions
): RenderedTemplate {
  // Mail clients render a subject as plain text, so escaping it would show the
  // reader `&amp;` where the value contains `&`.
  const subject = interpolateTemplate(template.subject, data, {
    escapeHtml: false,
  });

  let html = interpolateTemplate(template.htmlContent, data);

  // Derived BEFORE the preheader and the layout are spliced in. The preheader
  // is a hidden preview line, and a text part derived after it would repeat
  // that line as the message's opening words; the layout's chrome would follow
  // it into the text part for the same reason.
  const text = template.plainTextContent?.trim()
    ? interpolateTemplate(template.plainTextContent, data, {
        escapeHtml: false,
      })
    : htmlToText(html);

  if (template.preheader?.trim()) {
    const preheader = interpolateTemplate(template.preheader, data);
    html = `${PREHEADER_OPEN}${preheader}</div>${html}`;
  }

  // A layout row IS a wrapper, so wrapping it in another would nest two
  // documents. It renders as itself.
  if (template.kind !== "layout" && template.useLayout && layout) {
    html = spliceIntoLayout(layout.htmlContent, html, {
      ...data,
      // A layout's own chrome routinely references these, and a caller sending
      // one specific template has no reason to know that. Supplied here so a
      // footer never renders blank, and only where the caller said nothing.
      year: data.year ?? new Date().getFullYear().toString(),
      appName: data.appName ?? options.appName,
    });
  }

  return { subject, html, text };
}

/**
 * Inject an already-rendered body at the wrapper's first `{{content}}`.
 *
 * The body is spliced verbatim and never re-interpolated or re-escaped: it is
 * finished HTML, and a second pass would either escape its markup into visible
 * text or expand a `{{...}}` that legitimately survived from user content.
 *
 * A well-formed layout carries exactly one marker. With none, the body is
 * appended after the wrapper so a malformed layout drops nothing.
 */
function spliceIntoLayout(
  wrapper: string,
  body: string,
  variables: Record<string, unknown>
): string {
  const at = wrapper.indexOf(CONTENT_MARKER);
  if (at === -1) return interpolateTemplate(wrapper, variables) + body;
  return (
    interpolateTemplate(wrapper.slice(0, at), variables) +
    body +
    interpolateTemplate(wrapper.slice(at + CONTENT_MARKER.length), variables)
  );
}
