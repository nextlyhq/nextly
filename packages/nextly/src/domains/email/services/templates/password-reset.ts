/**
 * Default Password Reset Email Template
 *
 * Sent when a user requests a password reset via the forgot password
 * flow. Contains a CTA button linking to the reset password page.
 * Uses a table-based bulletproof button for Outlook compatibility.
 * Content is wrapped by the shared header/footer layout.
 *
 * Slug: `password-reset`
 *
 * @module services/email/templates/password-reset
 * @since 1.0.0
 */

import type { EmailTemplateVersion } from "../../../../schemas/email-templates/types";
import type { OwnerTemplate } from "../../template-ownership";

export const passwordResetTemplate: OwnerTemplate = {
  name: "Password Reset",
  slug: "password-reset",
  description:
    "Sent when someone asks to reset their password, with the link that sets a new one.",
  // The link sets a new password for whoever opens it.
  carriesSecret: true,
  subject: "Reset your {{appName}} password",
  htmlContent: `<h1 style="margin: 0; padding: 0 0 16px; font-size: 24px; font-weight: 600; color: #18181b; line-height: 32px;">Password Reset</h1>
<p style="margin: 0; padding: 0 0 8px; font-size: 16px; color: #3f3f46; line-height: 24px;">Hi {{userName}},</p>
<p style="margin: 0; padding: 0 0 24px; font-size: 16px; color: #3f3f46; line-height: 24px;">We received a request to reset your password. Click the button below to set a new password.</p>
<table role="presentation" border="0" cellspacing="0" cellpadding="0" width="100%">
  <tr>
    <td align="center" style="padding: 0 0 24px;">
      <!--[if mso]><v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" href="{{resetLink}}" style="height:44px;v-text-anchor:middle;width:200px;" arcsize="14%" fillcolor="{{nextly_brand.accentColor}}" stroke="f"><v:textbox inset="0,0,0,0"><center style="color:#ffffff;font-family:sans-serif;font-size:16px;font-weight:500;">Reset Password</center></v:textbox></v:roundrect><![endif]-->
      <!--[if !mso]><!--><a href="{{resetLink}}" style="display: inline-block; padding: 12px 24px; background-color: {{nextly_brand.accentColor}}; color: #ffffff; text-decoration: none; border-radius: 6px; font-size: 16px; font-weight: 500; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; line-height: 20px;">Reset Password</a><!--<![endif]-->
    </td>
  </tr>
</table>
<p style="margin: 0; padding: 0 0 8px; font-size: 14px; color: #71717a; line-height: 20px;">This link will expire in <strong>{{expiresIn}}</strong>.</p>
<p style="margin: 0; padding: 0 0 16px; font-size: 14px; color: #71717a; line-height: 20px;">If you didn't request a password reset, you can safely ignore this email.</p>
<table role="presentation" border="0" cellspacing="0" cellpadding="0" width="100%">
  <tr>
    <td style="padding: 16px 0 0; border-top: 1px solid #e4e4e7;">
      <p style="margin: 0; font-size: 12px; color: #71717a; line-height: 18px;">If the button above doesn't work, copy and paste the following URL into your browser:</p>
      <p style="margin: 0; padding: 4px 0 0; font-size: 12px; color: #71717a; line-height: 18px; word-break: break-all;">{{resetLink}}</p>
    </td>
  </tr>
</table>`,
  plainTextContent: `Password Reset

Hi {{userName}},

We received a request to reset your password. Visit the following link to set a new password:

{{resetLink}}

This link will expire in {{expiresIn}}.

If you didn't request a password reset, you can safely ignore this email.`,
  variables: [
    {
      name: "userName",
      type: "text",
      label: "Name",
      description: "The user's display name",
      required: false,
      example: "Ada Lovelace",
    },
    {
      name: "resetLink",
      type: "link",
      label: "Reset link",
      description: "Password reset URL",
      required: true,
      example: "https://example.com/admin/reset-password?token=sample",
    },
    {
      name: "expiresIn",
      type: "text",
      label: "Link expires in",
      description: "Token expiration time (e.g., '1 hour')",
      required: true,
      example: "1 hour",
    },
    {
      name: "appName",
      type: "text",
      label: "App name",
      description: "Application name",
      required: true,
      example: "Acme",
    },
    {
      name: "userEmail",
      type: "text",
      label: "Email address",
      description: "The user's email address",
      required: false,
      example: "ada@example.com",
    },
    {
      name: "year",
      type: "number",
      label: "Year",
      description: "Current year (used in layout footer)",
      required: false,
      example: 2026,
    },
  ],
  useLayout: true,
  isActive: true,
};

/**
 * This template as core shipped it before brand settings, kept as one of
 * core's earlier versions: a stored row that still holds it was never edited,
 * so it follows core to the version above, whose button is written in the
 * brand accent. With the starting accent the two render identically.
 */
export const PASSWORD_RESET_BEFORE_BRAND: EmailTemplateVersion = {
  subject: "Reset your {{appName}} password",
  htmlContent: `<h1 style="margin: 0; padding: 0 0 16px; font-size: 24px; font-weight: 600; color: #18181b; line-height: 32px;">Password Reset</h1>
<p style="margin: 0; padding: 0 0 8px; font-size: 16px; color: #3f3f46; line-height: 24px;">Hi {{userName}},</p>
<p style="margin: 0; padding: 0 0 24px; font-size: 16px; color: #3f3f46; line-height: 24px;">We received a request to reset your password. Click the button below to set a new password.</p>
<table role="presentation" border="0" cellspacing="0" cellpadding="0" width="100%">
  <tr>
    <td align="center" style="padding: 0 0 24px;">
      <!--[if mso]><v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" href="{{resetLink}}" style="height:44px;v-text-anchor:middle;width:200px;" arcsize="14%" fillcolor="#18181b" stroke="f"><v:textbox inset="0,0,0,0"><center style="color:#ffffff;font-family:sans-serif;font-size:16px;font-weight:500;">Reset Password</center></v:textbox></v:roundrect><![endif]-->
      <!--[if !mso]><!--><a href="{{resetLink}}" style="display: inline-block; padding: 12px 24px; background-color: #18181b; color: #ffffff; text-decoration: none; border-radius: 6px; font-size: 16px; font-weight: 500; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; line-height: 20px;">Reset Password</a><!--<![endif]-->
    </td>
  </tr>
</table>
<p style="margin: 0; padding: 0 0 8px; font-size: 14px; color: #71717a; line-height: 20px;">This link will expire in <strong>{{expiresIn}}</strong>.</p>
<p style="margin: 0; padding: 0 0 16px; font-size: 14px; color: #71717a; line-height: 20px;">If you didn't request a password reset, you can safely ignore this email.</p>
<table role="presentation" border="0" cellspacing="0" cellpadding="0" width="100%">
  <tr>
    <td style="padding: 16px 0 0; border-top: 1px solid #e4e4e7;">
      <p style="margin: 0; font-size: 12px; color: #a1a1aa; line-height: 18px;">If the button above doesn't work, copy and paste the following URL into your browser:</p>
      <p style="margin: 0; padding: 4px 0 0; font-size: 12px; color: #a1a1aa; line-height: 18px; word-break: break-all;">{{resetLink}}</p>
    </td>
  </tr>
</table>`,
  plainTextContent: `Password Reset

Hi {{userName}},

We received a request to reset your password. Visit the following link to set a new password:

{{resetLink}}

This link will expire in {{expiresIn}}.

If you didn't request a password reset, you can safely ignore this email.`,
  preheader: null,
};
