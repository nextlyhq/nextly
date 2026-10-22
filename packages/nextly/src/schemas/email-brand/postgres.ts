/**
 * `nextly_email_brand` on PostgreSQL: the site's email brand settings.
 *
 * One row (`id` is always `default`). Each setting is nullable, and null is
 * its starting value, which `domains/email/brand-settings.ts` defines; a site
 * that never saved any has no row at all and reads every starting value.
 *
 * @module schemas/email-brand/postgres
 */
// The same table in each dialect's Drizzle builders: each dialect's column
// functions are distinct, so the declarations cannot be shared, and the
// parity test is what holds them in step.
// fallow-ignore-file code-duplication
import { integer, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

import { EMAIL_BRAND_TABLE } from "./table-name";

export const nextlyEmailBrandPg = pgTable(EMAIL_BRAND_TABLE, {
  id: text("id").primaryKey(),
  logoUrl: text("logo_url"),
  logoWidth: integer("logo_width"),
  accentColor: text("accent_color"),
  backgroundColor: text("background_color"),
  contentColor: text("content_color"),
  fontFamily: text("font_family"),
  footerText: text("footer_text"),
  footerLinks: jsonb("footer_links"),
  updatedAt: timestamp("updated_at", { withTimezone: false })
    .defaultNow()
    .notNull(),
});
