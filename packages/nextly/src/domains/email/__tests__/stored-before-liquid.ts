/**
 * A template stored the way an install stored it before Liquid, for tests of
 * what an upgrade keeps on the old engine.
 */
import { randomUUID } from "node:crypto";

import type { TestDialect, TestNextly } from "../../../plugins/test-nextly";

/**
 * Store a template as an install before Liquid did, straight into the
 * table: some of what these hold no longer passes the save-time check.
 */
export async function storeAsBefore(
  t: TestNextly,
  dialect: TestDialect,
  slug: string,
  htmlContent: string,
  kind: "template" | "layout" = "template"
): Promise<string> {
  const id = randomUUID();
  const q = (n: string) => (dialect === "mysql" ? `\`${n}\`` : `"${n}"`);
  const p = (i: number) => (dialect === "postgresql" ? `$${i}` : "?");
  const columns = [
    "id",
    "name",
    "slug",
    "subject",
    "html_content",
    "kind",
    "use_layout",
    "is_active",
    "created_at",
    "updated_at",
  ];
  const now = new Date();
  await t.adapter.executeQuery(
    `INSERT INTO ${q("email_templates")} (${columns.map(q).join(", ")}) VALUES (${columns.map((_, i) => p(i + 1)).join(", ")})`,
    [
      id,
      slug,
      slug,
      "Hello {{name}}",
      htmlContent,
      kind,
      dialect === "postgresql" ? false : 0,
      dialect === "postgresql" ? true : 1,
      now,
      now,
    ]
  );
  return id;
}
