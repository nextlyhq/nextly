/**
 * Default Email Layout — Header
 *
 * Table-based HTML email wrapper (opening tags) that provides the
 * outer structure for all templates with `useLayout: true`. Uses
 * inline CSS for maximum email client compatibility, dark mode
 * meta tags as progressive enhancement, and a centered 600px
 * content area.
 *
 * Reserved slug: `_email-header`
 *
 * @module services/email/templates/layout-header
 * @since 1.0.0
 */

import type { EmailTemplateInsert } from "../../../../schemas/email-templates/types";

export const layoutHeaderTemplate: EmailTemplateInsert = {
  name: "Email Header",
  slug: "_email-header",
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
            <td class="email-card" style="background-color: #ffffff; border-radius: 8px; padding: 32px;">`,
  useLayout: false,
  isActive: true,
  variables: [
    { name: "appName", description: "Application name", required: false },
  ],
  plainTextContent: null,
};
