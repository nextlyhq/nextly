/**
 * Default Email Verification Template
 *
 * Sent when a user needs to verify their email address (after
 * registration or email change). Contains a CTA button linking to
 * the email verification endpoint. Uses a table-based bulletproof
 * button for Outlook compatibility. Content is wrapped by the
 * shared header/footer layout.
 *
 * Slug: `email-verification`
 *
 * @module services/email/templates/email-verification
 * @since 1.0.0
 */

import type { EmailTemplateInsert } from "../../../../schemas/email-templates/types";

export const emailVerificationTemplate: EmailTemplateInsert = {
  name: "Email Verification",
  slug: "email-verification",
  subject: "Verify your {{appName}} email address",
  htmlContent: `<h1 style="margin: 0; padding: 0 0 16px; font-size: 24px; font-weight: 600; color: #18181b; line-height: 32px;">Verify Your Email</h1>
<p style="margin: 0; padding: 0 0 8px; font-size: 16px; color: #3f3f46; line-height: 24px;">Hi {{userName}},</p>
<p style="margin: 0; padding: 0 0 24px; font-size: 16px; color: #3f3f46; line-height: 24px;">Please verify your email address by clicking the button below.</p>
<table role="presentation" border="0" cellspacing="0" cellpadding="0" width="100%">
  <tr>
    <td align="center" style="padding: 0 0 24px;">
      <!--[if mso]><v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" href="{{verifyLink}}" style="height:44px;v-text-anchor:middle;width:200px;" arcsize="14%" fillcolor="#18181b" stroke="f"><v:textbox inset="0,0,0,0"><center style="color:#ffffff;font-family:sans-serif;font-size:16px;font-weight:500;">Verify Email</center></v:textbox></v:roundrect><![endif]-->
      <!--[if !mso]><!--><a href="{{verifyLink}}" style="display: inline-block; padding: 12px 24px; background-color: #18181b; color: #ffffff; text-decoration: none; border-radius: 6px; font-size: 16px; font-weight: 500; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; line-height: 20px;">Verify Email</a><!--<![endif]-->
    </td>
  </tr>
</table>
<p style="margin: 0; padding: 0 0 8px; font-size: 14px; color: #71717a; line-height: 20px;">This link will expire in <strong>{{expiresIn}}</strong>.</p>
<p style="margin: 0; padding: 0 0 16px; font-size: 14px; color: #71717a; line-height: 20px;">If you didn't create an account, you can safely ignore this email.</p>
<table role="presentation" border="0" cellspacing="0" cellpadding="0" width="100%">
  <tr>
    <td style="padding: 16px 0 0; border-top: 1px solid #e4e4e7;">
      <p style="margin: 0; font-size: 12px; color: #a1a1aa; line-height: 18px;">If the button above doesn't work, copy and paste the following URL into your browser:</p>
      <p style="margin: 0; padding: 4px 0 0; font-size: 12px; color: #a1a1aa; line-height: 18px; word-break: break-all;">{{verifyLink}}</p>
    </td>
  </tr>
</table>`,
  plainTextContent: `Verify Your Email

Hi {{userName}},

Please verify your email address by visiting the following link:

{{verifyLink}}

This link will expire in {{expiresIn}}.

If you didn't create an account, you can safely ignore this email.`,
  variables: [
    {
      name: "userName",
      description: "The user's display name",
      required: false,
    },
    {
      name: "verifyLink",
      description: "Email verification URL",
      required: true,
    },
    {
      name: "expiresIn",
      description: "Token expiration time (e.g., '24 hours')",
      required: true,
    },
    { name: "appName", description: "Application name", required: true },
    {
      name: "userEmail",
      description: "The user's email address",
      required: false,
    },
    {
      name: "year",
      description: "Current year (used in layout footer)",
      required: false,
    },
  ],
  useLayout: true,
  isActive: true,
};
