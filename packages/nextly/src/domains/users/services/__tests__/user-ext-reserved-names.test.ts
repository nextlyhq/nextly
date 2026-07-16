/**
 * Rows that predate the create-time name guard must not reach the merge:
 * a custom field named `email` or `id` is assigned over the built-in on the
 * user object and replaces its validation in the merged schema.
 */
import { describe, expect, it, vi } from "vitest";

import type { UserFieldDefinitionRecord } from "../../../../schemas/user-field-definitions/types";
import type { UserFieldDefinitionService } from "../user-field-definition-service";
import { UserExtSchemaService } from "../user-ext-schema-service";

function record(
  name: string,
  overrides: Partial<UserFieldDefinitionRecord> = {}
): UserFieldDefinitionRecord {
  return {
    id: `id-${name}`,
    name,
    label: name,
    type: "text",
    required: false,
    defaultValue: null,
    options: null,
    placeholder: null,
    description: null,
    sortOrder: 0,
    source: "ui",
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as UserFieldDefinitionRecord;
}

function serviceReturning(records: UserFieldDefinitionRecord[]) {
  const warn = vi.fn();
  const fieldDefService = {
    getMergedFields: vi.fn().mockResolvedValue(records),
  } as unknown as UserFieldDefinitionService;

  const service = new UserExtSchemaService("postgresql", fieldDefService, {
    debug: vi.fn(),
    info: vi.fn(),
    warn,
    error: vi.fn(),
  });

  return { service, warn };
}

describe("loadMergedFields — names that would displace a built-in", () => {
  it("keeps ordinary fields", async () => {
    const { service } = serviceReturning([
      record("phoneNumber"),
      record("jobTitle"),
    ]);
    await service.loadMergedFields();

    expect(service.getMergedFieldConfigs().map(f => f.name)).toEqual([
      "phoneNumber",
      "jobTitle",
    ]);
  });

  it.each(["email", "id", "name", "passwordHash", "isActive", "roles"])(
    "drops a stored field named %s",
    async name => {
      const { service } = serviceReturning([record(name), record("jobTitle")]);
      await service.loadMergedFields();

      expect(service.getMergedFieldConfigs().map(f => f.name)).toEqual([
        "jobTitle",
      ]);
    }
  );

  it("says which field it dropped and why", async () => {
    const { service, warn } = serviceReturning([record("email")]);
    await service.loadMergedFields();

    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("unusable name"),
      expect.objectContaining({
        name: "email",
        reason: "USER_FIELD_NAME_RESERVED",
      })
    );
  });

  it("drops a stored field whose name cannot be a column identifier", async () => {
    const { service } = serviceReturning([record("has-dash")]);
    await service.loadMergedFields();

    expect(service.getMergedFieldConfigs()).toEqual([]);
  });

  it("keeps a dropped field out of the generated user_ext columns", async () => {
    const { service } = serviceReturning([record("email"), record("jobTitle")]);
    await service.loadMergedFields();

    const sql = service.generateMigrationSQL(service.getMergedFieldConfigs());
    expect(sql).toContain("job_title");
    expect(sql).not.toMatch(/"email"|`email`/);
  });
});
