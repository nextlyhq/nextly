/**
 * Default Welcome Email Template
 *
 * Sent to new users after account creation when `sendWelcomeEmail`
 * is enabled. Includes a verify email button so the user can confirm
 * their address before logging in. Uses inline CSS for email client
 * compatibility. Content is wrapped by the shared header/footer layout.
 *
 * Slug: `welcome`
 *
 * @module services/email/templates/welcome
 * @since 1.0.0
 */

import type { EmailTemplateInsert } from "../../../../schemas/email-templates/types";

export const welcomeTemplate: EmailTemplateInsert = {
  name: "Welcome Email",
  slug: "welcome",
  subject: "Welcome to {{appName}}, {{userName}}!",
  htmlContent: `<h1 style="margin: 0; padding: 0 0 16px; font-size: 24px; font-weight: 600; color: #18181b; line-height: 32px;">Welcome, {{userName}}!</h1>
<p style="margin: 0; padding: 0 0 16px; font-size: 16px; color: #3f3f46; line-height: 24px;">Thank you for joining <strong>{{appName}}</strong>. We're excited to have you on board.</p>
<p style="margin: 0; padding: 0 0 24px; font-size: 16px; color: #3f3f46; line-height: 24px;">Your account has been created with the email address <strong>{{userEmail}}</strong>. To get started, please verify your email address by clicking the button below.</p>
<table role="presentation" border="0" cellspacing="0" cellpadding="0" width="100%">
  <tr>
    <td align="center" style="padding: 0 0 24px;">
      <!--[if mso]><v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" href="{{verifyLink}}" style="height:44px;v-text-anchor:middle;width:200px;" arcsize="14%" fillcolor="#18181b" stroke="f"><v:textbox inset="0,0,0,0"><center style="color:#ffffff;font-family:sans-serif;font-size:16px;font-weight:500;">Verify Email</center></v:textbox></v:roundrect><![endif]-->
      <!--[if !mso]><!--><a href="{{verifyLink}}" style="display: inline-block; padding: 12px 24px; background-color: #18181b; color: #ffffff; text-decoration: none; border-radius: 6px; font-size: 16px; font-weight: 500; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; line-height: 20px;">Verify Email</a><!--<![endif]-->
    </td>
  </tr>
</table>
<p style="margin: 0; padding: 0 0 16px; font-size: 14px; color: #71717a; line-height: 20px;">This link will expire in <strong>{{expiresIn}}</strong>.</p>
<p style="margin: 0; font-size: 16px; color: #3f3f46; line-height: 24px;">If you have any questions, feel free to reach out to our support team.</p>
<table role="presentation" border="0" cellspacing="0" cellpadding="0" width="100%">
  <tr>
    <td style="padding: 16px 0 0; border-top: 1px solid #e4e4e7;">
      <p style="margin: 0; font-size: 12px; color: #a1a1aa; line-height: 18px;">If the button above doesn't work, copy and paste the following URL into your browser:</p>
      <p style="margin: 0; padding: 4px 0 0; font-size: 12px; color: #a1a1aa; line-height: 18px; word-break: break-all;">{{verifyLink}}</p>
    </td>
  </tr>
</table>`,
  plainTextContent: `Welcome, {{userName}}!

Thank you for joining {{appName}}. We're excited to have you on board.

Your account has been created with the email address {{userEmail}}. To get started, please verify your email address by visiting the link below:

{{verifyLink}}

This link will expire in {{expiresIn}}.

If you have any questions, feel free to reach out to our support team.`,
  variables: [
    {
      name: "userName",
      description: "The new user's display name",
      required: true,
    },
    { name: "appName", description: "Application name", required: true },
    {
      name: "userEmail",
      description: "The new user's email address",
      required: false,
    },
    {
      name: "verifyLink",
      description: "Email verification URL",
      required: true,
    },
    {
      name: "expiresIn",
      description: "Token expiry duration (e.g. 24 hours)",
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
