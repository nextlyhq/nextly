/**
 * Default Email Layout
 *
 * Table-based HTML email wrapper (Outlook-safe, inline CSS, dark-mode
 * meta, centered 600px card). A `kind: "layout"` row whose `{{content}}`
 * placeholder marks where a template body is injected at send time.
 *
 * @module services/email/templates/default-layout
 * @since 1.0.0
 */

import type { EmailTemplateInsert } from "../../../../schemas/email-templates/types";

export const DEFAULT_LAYOUT_SLUG = "default-layout";

/** Placeholder in a layout's `htmlContent` where the body is injected. */
export const LAYOUT_CONTENT_PLACEHOLDER = "{{content}}";

export const defaultLayoutTemplate: EmailTemplateInsert = {
  name: "Default Layout",
  slug: DEFAULT_LAYOUT_SLUG,
  kind: "layout",
  subject: "",
  htmlContent: `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
  <meta charset="utf-8">
  <meta http-equiv="Content-Type" content="text/html; charset=utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="color-scheme" content="light dark">
  <meta name="supported-color-schemes" content="light dark">
  <title>{{appName}}</title>
  <!--[if mso]>
  <noscript>
    <xml>
      <o:OfficeDocumentSettings>
        <o:PixelsPerInch>96</o:PixelsPerInch>
      </o:OfficeDocumentSettings>
    </xml>
  </noscript>
  <![endif]-->
  <style>
    body { margin: 0; padding: 0; -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
    table { border-collapse: collapse; mso-table-lspace: 0pt; mso-table-rspace: 0pt; }
    img { border: 0; line-height: 100%; outline: none; text-decoration: none; -ms-interpolation-mode: bicubic; }
    @media (prefers-color-scheme: dark) {
      .email-bg { background-color: #1a1a2e !important; }
      .email-card { background-color: #27272a !important; }
      .email-card h1, .email-card h2, .email-card p { color: #fafafa !important; }
      .email-muted { color: #a1a1aa !important; }
    }
  </style>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f4f4f5; -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%;">
  <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" class="email-bg" style="background-color: #f4f4f5;">
    <tr>
      <td align="center" style="padding: 40px 20px;">
        <!--[if mso]><table role="presentation" border="0" cellspacing="0" cellpadding="0" width="600"><tr><td><![endif]-->
        <table role="presentation" border="0" cellspacing="0" cellpadding="0" width="100%" style="max-width: 600px;">
          <tr>
            <td class="email-card" style="background-color: #ffffff; border-radius: 8px; padding: 32px;">{{content}}</td>
          </tr>
        </table>
        <!--[if mso]></td></tr></table><![endif]-->
        <table role="presentation" border="0" cellspacing="0" cellpadding="0" width="100%" style="max-width: 600px;">
          <tr>
            <td align="center" style="padding: 20px 0;">
              <p class="email-muted" style="margin: 0; font-size: 12px; line-height: 18px; color: #71717a; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">&copy; {{year}} {{appName}}. All rights reserved.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`,
  useLayout: false,
  isActive: true,
  variables: [
    {
      name: "content",
      description: "Template body injected here",
      required: true,
    },
    { name: "year", description: "Current year", required: false },
    { name: "appName", description: "Application name", required: false },
  ],
  plainTextContent: null,
};
