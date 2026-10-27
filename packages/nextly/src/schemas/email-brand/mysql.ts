/**
 * `email_brand` on MySQL: the site's email brand settings.
 *
 * One row (`id` is always `default`). Each setting is nullable, and null is
 * its starting value, which `domains/email/brand-settings.ts` defines; a site
 * that never saved any has no row at all and reads every starting value.
 *
 * @module schemas/email-brand/mysql
 */
// The same table in each dialect's Drizzle builders: each dialect's column
// functions are distinct, so the declarations cannot be shared, and the
// parity test is what holds them in step.
// fallow-ignore-file code-duplication
import {
  datetime,
  int,
  json,
  mysqlTable,
  text,
  varchar,
} from "drizzle-orm/mysql-core";

import { EMAIL_BRAND_TABLE } from "./table-name";

export const nextlyEmailBrandMysql = mysqlTable(EMAIL_BRAND_TABLE, {
  id: varchar("id", { length: 50 }).primaryKey(),
  logoUrl: varchar("logo_url", { length: 2048 }),
  logoWidth: int("logo_width"),
  accentColor: varchar("accent_color", { length: 16 }),
  backgroundColor: varchar("background_color", { length: 16 }),
  contentColor: varchar("content_color", { length: 16 }),
  fontFamily: varchar("font_family", { length: 32 }),
  footerText: text("footer_text"),
  footerLinks: json("footer_links"),
  updatedAt: datetime("updated_at")
    .notNull()
    .$defaultFn(() => new Date()),
});
