/**
 * Default Email Layout
 *
 * Table-based HTML email wrapper (Outlook-safe, inline CSS, dark-mode
 * meta, centered 600px card). A `kind: "layout"` row whose `{{content}}`
 * placeholder marks where a template body is injected at send time.
 *
 * Written in the brand settings (`../../brand-settings.ts`): the colours, the
 * font, the logo and the footer come from the `brand` variable, through plain
 * paths only, so the layout reads the same on both template engines. With the
 * starting brand settings it renders exactly as the layout before them did.
 *
 * @module services/email/templates/default-layout
 * @since 1.0.0
 */

import type { EmailTemplateVersion } from "../../../../schemas/email-templates/types";
import type { OwnerTemplate } from "../../template-ownership";

export const DEFAULT_LAYOUT_SLUG = "default-layout";

/** Placeholder in a layout's `htmlContent` where the body is injected. */
export const LAYOUT_CONTENT_PLACEHOLDER = "{{content}}";

/**
 * The default layout as core shipped it before brand settings, kept as one of
 * core's earlier versions: a stored row that still holds it was never edited,
 * so it follows core to the version below rather than being kept as the
 * site's own. It is also what the version below must render identically to
 * with the starting brand settings.
 */
export const DEFAULT_LAYOUT_BEFORE_BRAND: EmailTemplateVersion = {
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
  plainTextContent: null,
  preheader: null,
};

export const defaultLayoutTemplate: OwnerTemplate = {
  name: "Default Layout",
  slug: DEFAULT_LAYOUT_SLUG,
  kind: "layout",
  description:
    "Wraps every email that uses a layout and chooses no other, with the site's header and footer.",
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
<body style="margin: 0; padding: 0; font-family: {{brand.fontFamily}}; background-color: {{brand.backgroundColor}}; -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%;">
  <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" class="email-bg" style="background-color: {{brand.backgroundColor}};">
    <tr>
      <td align="center" style="padding: 40px 20px;">
        {{brand.html.logo}}<!--[if mso]><table role="presentation" border="0" cellspacing="0" cellpadding="0" width="600"><tr><td><![endif]-->
        <table role="presentation" border="0" cellspacing="0" cellpadding="0" width="100%" style="max-width: 600px;">
          <tr>
            <td class="email-card" style="background-color: {{brand.contentColor}}; border-radius: 8px; padding: 32px;">{{content}}</td>
          </tr>
        </table>
        <!--[if mso]></td></tr></table><![endif]-->
        <table role="presentation" border="0" cellspacing="0" cellpadding="0" width="100%" style="max-width: 600px;">
          <tr>
            <td align="center" style="padding: 20px 0;">
              <p class="email-muted" style="margin: 0; font-size: 12px; line-height: 18px; color: #71717a; font-family: {{brand.fontFamily}};">{{brand.html.footer}}</p>{{brand.html.links}}
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
    {
      name: "brand",
      description:
        "Brand settings: colours, font, logo and footer (brand.html holds the markup they make)",
      required: false,
    },
  ],
  plainTextContent: null,
};
