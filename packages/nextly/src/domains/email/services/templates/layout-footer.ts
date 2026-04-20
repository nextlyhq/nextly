/**
 * Default Email Layout — Footer
 *
 * Table-based HTML email wrapper (closing tags) that completes the
 * outer structure opened by `layout-header`. Includes a copyright
 * line with `{{year}}` and `{{appName}}` variables.
 *
 * Reserved slug: `_email-footer`
 *
 * @module services/email/templates/layout-footer
 * @since 1.0.0
 */

import type { EmailTemplateInsert } from "../../../../schemas/email-templates/types";

export const layoutFooterTemplate: EmailTemplateInsert = {
  name: "Email Footer",
  slug: "_email-footer",
  subject: "",
  htmlContent: `            </td>
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
    { name: "year", description: "Current year", required: false },
    { name: "appName", description: "Application name", required: false },
  ],
  plainTextContent: null,
};
