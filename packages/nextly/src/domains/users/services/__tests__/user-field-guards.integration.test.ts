/**
 * A custom user field's name becomes a `user_ext` column and a key on the
 * user object, where it is assigned over the built-ins. These tests hold the
 * line at the service, which is the single chokepoint every caller reaches:
 * the admin dispatcher, `POST /api/user-fields` and `PATCH /api/user-fields/:id`
 * all route through it.
 */
import { afterEach, describe, expect, it } from "vitest";

import { NextlyError } from "../../../../errors";
import {
  createTestNextly,
  type TestNextly,
} from "../../../../plugins/test-nextly";
import type { UserFieldDefinitionService } from "../user-field-definition-service";

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

async function bootService(): Promise<UserFieldDefinitionService> {
  current = await createTestNextly();
  return current.getService(
    "userFieldDefinitionService"
  ) as unknown as UserFieldDefinitionService;
}

const validField = {
  name: "phoneNumber",
  label: "Phone Number",
  type: "text",
};

describe("createField — name guard", () => {
  it("creates a field with an ordinary name", async () => {
    const service = await bootService();
    const field = await service.createField(validField);
    expect(field.name).toBe("phoneNumber");
  });

  it.each(["email", "id", "name", "passwordHash", "isActive", "roles"])(
    "refuses to create a field named %s",
    async name => {
      const service = await bootService();
      await expect(
        service.createField({ ...validField, name })
      ).rejects.toBeInstanceOf(NextlyError);
    }
  );

  it("refuses a built-in name in a different case", async () => {
    const service = await bootService();
    await expect(
      service.createField({ ...validField, name: "EMAIL" })
    ).rejects.toBeInstanceOf(NextlyError);
  });

  it("refuses a name that cannot be a column identifier", async () => {
    const service = await bootService();
    await expect(
      service.createField({ ...validField, name: "has-dash" })
    ).rejects.toBeInstanceOf(NextlyError);
  });

  it("refuses a type with no column representation", async () => {
    const service = await bootService();
    await expect(
      service.createField({ ...validField, type: "relationship" })
    ).rejects.toBeInstanceOf(NextlyError);
  });

  it("reports the rejection against the offending key", async () => {
    const service = await bootService();
    const error = await service
      .createField({ ...validField, name: "email" })
      .catch((e: unknown) => e);

    expect(NextlyError.is(error)).toBe(true);
    const data = (error as NextlyError).publicData as {
      errors: Array<{ path: string; code: string; message: string }>;
    };
    expect(data.errors[0].path).toBe("name");
    expect(data.errors[0].code).toBe("USER_FIELD_NAME_RESERVED");
    expect(data.errors[0].message).toContain("email");
  });

  it("stores nothing when the name is refused", async () => {
    const service = await bootService();
    await service.createField(validField);
    await service
      .createField({ ...validField, name: "email" })
      .catch(() => undefined);

    const fields = await service.listFields();
    expect(fields.map(f => f.name)).toEqual(["phoneNumber"]);
  });
});

describe("updateField — name and type are fixed at creation", () => {
  it("refuses to rename a field", async () => {
    const service = await bootService();
    const field = await service.createField(validField);

    await expect(
      service.updateField(field.id, { name: "mobile" })
    ).rejects.toBeInstanceOf(NextlyError);
  });

  it("refuses to rename a field onto a built-in", async () => {
    const service = await bootService();
    const field = await service.createField(validField);

    await expect(
      service.updateField(field.id, { name: "email" })
    ).rejects.toBeInstanceOf(NextlyError);

    const reread = await service.getField(field.id);
    expect(reread.name).toBe("phoneNumber");
  });

  it("refuses to change a field's type", async () => {
    const service = await bootService();
    const field = await service.createField(validField);

    await expect(
      service.updateField(field.id, { type: "number" })
    ).rejects.toBeInstanceOf(NextlyError);
  });

  it("accepts name and type echoed back unchanged", async () => {
    const service = await bootService();
    const field = await service.createField(validField);

    const updated = await service.updateField(field.id, {
      name: "phoneNumber",
      type: "text",
      label: "Mobile Number",
    });

    expect(updated.label).toBe("Mobile Number");
    expect(updated.name).toBe("phoneNumber");
  });

  it("refuses to change whether a field stores multiple values", async () => {
    // hasMany picks a scalar vs a json column, so it is as fixed as the type.
    const service = await bootService();
    const field = await service.createField(validField);

    const error = await service
      .updateField(field.id, { hasMany: true })
      .catch((e: unknown) => e);

    expect(NextlyError.is(error)).toBe(true);
    const data = (error as NextlyError).publicData as {
      errors: Array<{ path: string; code: string; message: string }>;
    };
    expect(data.errors[0].path).toBe("hasMany");
    expect(data.errors[0].code).toBe("USER_FIELD_HAS_MANY_IMMUTABLE");
  });

  it("accepts hasMany echoed back unchanged", async () => {
    // An unset field stores hasMany as null, which is equivalent to false, so
    // echoing false must not fire the guard.
    const service = await bootService();
    const field = await service.createField(validField);

    const updated = await service.updateField(field.id, {
      hasMany: false,
      label: "Still Single-Valued",
    });

    expect(updated.label).toBe("Still Single-Valued");
  });

  it("still updates everything that is not the field's identity", async () => {
    const service = await bootService();
    const field = await service.createField(validField);

    const updated = await service.updateField(field.id, {
      label: "Mobile",
      required: true,
      placeholder: "+1 555 0100",
      description: "Reachable during office hours",
      isActive: false,
    });

    expect(updated.label).toBe("Mobile");
    expect(updated.required).toBe(true);
    expect(updated.placeholder).toBe("+1 555 0100");
    expect(updated.isActive).toBe(false);
  });
});
