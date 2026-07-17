/**
 * The url and phone user field types are validated as text but must still get a
 * real text column in user_ext (they are stored, not skipped or defaulted to a
 * different primitive).
 */
import { describe, expect, it } from "vitest";

import type { UserFieldConfig } from "../../../../users/config/types";
import { UserExtSchemaService } from "../user-ext-schema-service";

function field(name: string, type: string): UserFieldConfig {
  return { name, label: name, type } as unknown as UserFieldConfig;
}

describe("UserExtSchemaService — built-in url/phone columns", () => {
  it("maps url and phone to varchar columns on postgres", () => {
    const sql = new UserExtSchemaService("postgresql").generateMigrationSQL([
      field("website", "url"),
      field("mobile", "phone"),
    ]);
    expect(sql).toMatch(/"website"\s+VARCHAR\(255\)/i);
    expect(sql).toMatch(/"mobile"\s+VARCHAR\(255\)/i);
  });

  it("maps url and phone to text columns on sqlite", () => {
    const sql = new UserExtSchemaService("sqlite").generateMigrationSQL([
      field("website", "url"),
      field("mobile", "phone"),
    ]);
    expect(sql).toMatch(/"website"\s+TEXT/i);
    expect(sql).toMatch(/"mobile"\s+TEXT/i);
  });
});
