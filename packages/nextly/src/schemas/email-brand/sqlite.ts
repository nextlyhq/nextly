/**
 * `email_brand` on SQLite: the site's email brand settings.
 *
 * One row (`id` is always `default`). Each setting is nullable, and null is
 * its starting value, which `domains/email/brand-settings.ts` defines; a site
 * that never saved any has no row at all and reads every starting value.
 *
 * @module schemas/email-brand/sqlite
 */
// The same table in each dialect's Drizzle builders: each dialect's column
// functions are distinct, so the declarations cannot be shared, and the
// parity test is what holds them in step.
// fallow-ignore-file code-duplication
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { EMAIL_BRAND_TABLE } from "./table-name";

export const nextlyEmailBrandSqlite = sqliteTable(EMAIL_BRAND_TABLE, {
  id: text("id").primaryKey(),
  logoUrl: text("logo_url"),
  logoWidth: integer("logo_width"),
  accentColor: text("accent_color"),
  backgroundColor: text("background_color"),
  contentColor: text("content_color"),
  fontFamily: text("font_family"),
  footerText: text("footer_text"),
  footerLinks: text("footer_links", { mode: "json" }),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});
