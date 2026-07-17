import { describe, expect, it } from "vitest";

import { verifyPassword } from "../../../auth/password";
import {
  hashPasswordFieldValues,
  hasPasswordField,
  stripPasswordFieldValues,
} from "../password-fields";

const FIELDS = [
  { name: "title", type: "text" },
  { name: "secret", type: "password" },
  { name: "pin", type: "password" },
];

describe("hashPasswordFieldValues", () => {
  it("replaces a submitted password with a verifiable bcrypt hash", async () => {
    const data: Record<string, unknown> = { title: "t", secret: "hunter2!" };
    await hashPasswordFieldValues(data, FIELDS);

    expect(data.secret).not.toBe("hunter2!");
    expect(typeof data.secret).toBe("string");
    await expect(
      verifyPassword("hunter2!", data.secret as string)
    ).resolves.toBe(true);
    expect(data.title).toBe("t");
  });

  it("always re-hashes, even bcrypt-looking input (no pre-hash detection)", async () => {
    const bcryptLooking = "$2a$12$abcdefghijklmnopqrstuvwxyz012345678901234";
    const data: Record<string, unknown> = { secret: bcryptLooking };
    await hashPasswordFieldValues(data, FIELDS);
    expect(data.secret).not.toBe(bcryptLooking);
    await expect(
      verifyPassword(bcryptLooking, data.secret as string)
    ).resolves.toBe(true);
  });

  it("strips empty strings so update keeps the stored hash", async () => {
    const data: Record<string, unknown> = { secret: "", title: "t" };
    await hashPasswordFieldValues(data, FIELDS);
    expect("secret" in data).toBe(false);
    expect(data.title).toBe("t");
  });

  it("keeps an explicit null (clears the stored value)", async () => {
    const data: Record<string, unknown> = { secret: null };
    await hashPasswordFieldValues(data, FIELDS);
    expect(data.secret).toBeNull();
  });

  it("strips non-string values instead of storing them raw", async () => {
    const data: Record<string, unknown> = { secret: 12345 };
    await hashPasswordFieldValues(data, FIELDS);
    expect("secret" in data).toBe(false);
  });

  it("leaves data untouched when no password value is provided", async () => {
    const data: Record<string, unknown> = { title: "only" };
    await hashPasswordFieldValues(data, FIELDS);
    expect(data).toEqual({ title: "only" });
  });
});

describe("stripPasswordFieldValues", () => {
  it("removes every password field value and nothing else", () => {
    const entry: Record<string, unknown> = {
      id: "1",
      title: "t",
      secret: "$2a$12$hash",
      pin: "$2a$12$hash2",
    };
    stripPasswordFieldValues(entry, FIELDS);
    expect(entry).toEqual({ id: "1", title: "t" });
  });
});

describe("hasPasswordField", () => {
  it("reports presence of password fields", () => {
    expect(hasPasswordField(FIELDS)).toBe(true);
    expect(hasPasswordField([{ name: "a", type: "text" }])).toBe(false);
  });
});
