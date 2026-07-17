/**
 * Guards the password-field helpers: password values must be bcrypt-hashed
 * before storage and never serialized back to a client, at any nesting
 * depth. A regression here would store plaintext or disclose a stored hash.
 */
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

  it("detects a password nested in a group or repeater", () => {
    expect(
      hasPasswordField([
        {
          name: "creds",
          type: "group",
          fields: [{ name: "token", type: "password" }],
        },
      ])
    ).toBe(true);
    expect(
      hasPasswordField([
        {
          name: "keys",
          type: "repeater",
          fields: [{ name: "secret", type: "password" }],
        },
      ])
    ).toBe(true);
  });
});

describe("nested password fields", () => {
  const NESTED = [
    {
      name: "creds",
      type: "group",
      fields: [{ name: "token", type: "password" }],
    },
    {
      name: "keys",
      type: "repeater",
      fields: [{ name: "secret", type: "password" }],
    },
  ];

  it("hashes passwords inside groups and repeater rows", async () => {
    const data: Record<string, unknown> = {
      creds: { token: "groupsecret" },
      keys: [{ secret: "row1secret" }, { secret: "row2secret" }],
    };
    await hashPasswordFieldValues(data, NESTED);

    const creds = data.creds as { token: string };
    expect(creds.token).not.toBe("groupsecret");
    await expect(verifyPassword("groupsecret", creds.token)).resolves.toBe(
      true
    );
    const keys = data.keys as Array<{ secret: string }>;
    await expect(verifyPassword("row1secret", keys[0].secret)).resolves.toBe(
      true
    );
    await expect(verifyPassword("row2secret", keys[1].secret)).resolves.toBe(
      true
    );
  });

  it("strips nested password values from responses", () => {
    const entry: Record<string, unknown> = {
      creds: { token: "$2a$hash", label: "kept" },
      keys: [{ secret: "$2a$hash", note: "kept" }],
    };
    stripPasswordFieldValues(entry, NESTED);
    expect(entry.creds).toEqual({ label: "kept" });
    expect(entry.keys).toEqual([{ note: "kept" }]);
  });
});
