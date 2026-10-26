/**
 * Guards the password-field helpers: password values must be bcrypt-hashed
 * before storage and never serialized back to a client, at any nesting
 * depth. A regression here would store plaintext or disclose a stored hash.
 */
import { describe, expect, it } from "vitest";

import { verifyPassword } from "../../../auth/password";
import {
  carryStoredPasswords,
  hashPasswordFieldValues,
  hasPasswordField,
  NO_FIELD_GROUPS,
  reachesPasswordField,
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
    await hashPasswordFieldValues(data, FIELDS, NO_FIELD_GROUPS);

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
    await hashPasswordFieldValues(data, FIELDS, NO_FIELD_GROUPS);
    expect(data.secret).not.toBe(bcryptLooking);
    await expect(
      verifyPassword(bcryptLooking, data.secret as string)
    ).resolves.toBe(true);
  });

  it("strips empty strings so update keeps the stored hash", async () => {
    const data: Record<string, unknown> = { secret: "", title: "t" };
    await hashPasswordFieldValues(data, FIELDS, NO_FIELD_GROUPS);
    expect("secret" in data).toBe(false);
    expect(data.title).toBe("t");
  });

  it("keeps an explicit null (clears the stored value)", async () => {
    const data: Record<string, unknown> = { secret: null };
    await hashPasswordFieldValues(data, FIELDS, NO_FIELD_GROUPS);
    expect(data.secret).toBeNull();
  });

  it("strips non-string values instead of storing them raw", async () => {
    const data: Record<string, unknown> = { secret: 12345 };
    await hashPasswordFieldValues(data, FIELDS, NO_FIELD_GROUPS);
    expect("secret" in data).toBe(false);
  });

  it("leaves data untouched when no password value is provided", async () => {
    const data: Record<string, unknown> = { title: "only" };
    await hashPasswordFieldValues(data, FIELDS, NO_FIELD_GROUPS);
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
    stripPasswordFieldValues(entry, FIELDS, NO_FIELD_GROUPS);
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

describe("reachesPasswordField", () => {
  const HELD = [
    {
      name: "box",
      type: "group",
      fields: [{ name: "held", type: "component", component: "pin" }],
    },
  ];
  const PIN = [{ name: "pin", type: "password" }];

  it("follows a field group held inline to its password", () => {
    expect(reachesPasswordField(HELD, { fieldsOf: () => PIN })).toBe(true);
    expect(
      reachesPasswordField(HELD, {
        fieldsOf: () => [{ name: "title", type: "text" }],
      })
    ).toBe(false);
  });

  it("counts a field group held inline that it has no fields for", () => {
    // The strip withholds such an instance, so the read has to run it.
    expect(reachesPasswordField(HELD, NO_FIELD_GROUPS)).toBe(true);
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
    await hashPasswordFieldValues(data, NESTED, NO_FIELD_GROUPS);

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

  it("hashes each occurrence of one password with its own salt", async () => {
    const data: Record<string, unknown> = {
      creds: { token: "samesecret" },
      keys: [{ secret: "samesecret" }, { secret: "samesecret" }],
    };
    await hashPasswordFieldValues(data, NESTED, NO_FIELD_GROUPS);

    const stored = [
      (data.creds as { token: string }).token,
      ...(data.keys as Array<{ secret: string }>).map(row => row.secret),
    ];
    expect(new Set(stored).size).toBe(3);
    for (const hash of stored) {
      await expect(verifyPassword("samesecret", hash)).resolves.toBe(true);
    }
  });

  it("strips nested password values from responses", () => {
    const entry: Record<string, unknown> = {
      creds: { token: "$2a$hash", label: "kept" },
      keys: [{ secret: "$2a$hash", note: "kept" }],
    };
    stripPasswordFieldValues(entry, NESTED, NO_FIELD_GROUPS);
    expect(entry.creds).toEqual({ label: "kept" });
    expect(entry.keys).toEqual([{ note: "kept" }]);
  });
});

describe("carryStoredPasswords", () => {
  const HASH_A = `$2a$10$${"a".repeat(53)}`;
  const HASH_B = `$2a$10$${"b".repeat(53)}`;

  it("puts back a password named like a member every object inherits", () => {
    const fields = [
      {
        name: "box",
        type: "group",
        fields: [
          { name: "a", type: "text" },
          { name: "toString", type: "password" },
        ],
      },
    ];
    const data: Record<string, unknown> = { box: { a: "2" } };

    const kept = carryStoredPasswords(
      data,
      { box: { a: "1", toString: HASH_A } },
      fields,
      NO_FIELD_GROUPS
    );

    expect(Object.hasOwn(data.box as object, "toString")).toBe(true);
    expect((data.box as Record<string, unknown>).toString).toBe(HASH_A);
    expect([...kept]).toEqual([HASH_A]);
  });

  it("gives a row without an id none of the passwords of a list whose rows carry ids", () => {
    const fields = [
      {
        name: "lines",
        type: "repeater",
        fields: [
          { name: "label", type: "text" },
          { name: "pw", type: "password" },
        ],
      },
    ];
    // Row `a` is removed, a new row is added in its place, and `b` is kept.
    const data: Record<string, unknown> = {
      lines: [{ label: "new" }, { id: "b", label: "b" }],
    };

    carryStoredPasswords(
      data,
      {
        lines: [
          { id: "a", label: "a", pw: HASH_A },
          { id: "b", label: "b", pw: HASH_B },
        ],
      },
      fields,
      NO_FIELD_GROUPS
    );

    const lines = data.lines as Array<Record<string, unknown>>;
    expect(lines[0]?.pw).toBeUndefined();
    expect(lines[1]?.pw).toBe(HASH_B);
  });

  it("gives rows that carry ids none of the passwords of stored rows that carry none", () => {
    const fields = [
      {
        name: "lines",
        type: "repeater",
        fields: [
          { name: "label", type: "text" },
          { name: "pw", type: "password" },
        ],
      },
    ];
    // Stored without ids; sent with ids, a new row ahead of the old one.
    const data: Record<string, unknown> = {
      lines: [
        { id: "n", label: "new" },
        { id: "a", label: "a" },
      ],
    };

    carryStoredPasswords(
      data,
      { lines: [{ label: "a", pw: HASH_A }] },
      fields,
      NO_FIELD_GROUPS
    );

    const lines = data.lines as Array<Record<string, unknown>>;
    expect(lines[0]?.pw).toBeUndefined();
  });

  it("gives a field group's instance none of the password of a different instance it replaces", () => {
    const fields = [
      {
        name: "box",
        type: "group",
        fields: [{ name: "held", type: "component", component: "pin" }],
      },
    ];
    // One list per field group, as a resolved reach returns it.
    const pin = [{ name: "pw", type: "password" }];
    const reach = {
      fieldsOf: (slug: string) => (slug === "pin" ? pin : undefined),
    };
    const data: Record<string, unknown> = { box: { held: { id: "b" } } };

    carryStoredPasswords(
      data,
      { box: { held: { id: "a", pw: HASH_A } } },
      fields,
      reach
    );

    expect(
      ((data.box as Record<string, unknown>).held as Record<string, unknown>).pw
    ).toBeUndefined();
  });

  it("treats a password sent as undefined as left out", () => {
    const fields = [
      {
        name: "box",
        type: "group",
        fields: [{ name: "pw", type: "password" }],
      },
    ];
    const data: Record<string, unknown> = { box: { pw: undefined } };

    carryStoredPasswords(
      data,
      { box: { pw: HASH_A } },
      fields,
      NO_FIELD_GROUPS
    );

    expect((data.box as Record<string, unknown>).pw).toBe(HASH_A);
  });
});
