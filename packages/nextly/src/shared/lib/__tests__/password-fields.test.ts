/**
 * Guards the password-field helpers: password values must be bcrypt-hashed
 * before storage and never serialized back to a client, at any nesting
 * depth. A regression here would store plaintext or disclose a stored hash.
 */
import { describe, expect, it } from "vitest";

import { verifyPassword } from "../../../auth/password";
import {
  queriesPassword,
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

  describe("repeater rows, now stored with ids", () => {
    const LINES = [
      {
        name: "lines",
        type: "repeater",
        fields: [
          { name: "label", type: "text" },
          { name: "pw", type: "password" },
          { name: "pin", type: "password" },
        ],
      },
    ];
    const STORED = {
      lines: [
        { id: "a", label: "a", pw: HASH_A },
        { id: "b", label: "b", pw: HASH_B },
      ],
    };
    /** Carry the stored passwords onto `lines`, as sent; the rows after. */
    const carried = (lines: Array<Record<string, unknown>>) => {
      const data: Record<string, unknown> = { lines };
      const kept = carryStoredPasswords(data, STORED, LINES, NO_FIELD_GROUPS);
      return { rows: data.lines as Array<Record<string, unknown>>, kept };
    };

    it("keeps each password on its own row through a reorder by id", () => {
      const { rows } = carried([{ id: "b" }, { id: "a" }]);
      expect(rows.map(row => row.pw)).toEqual([HASH_B, HASH_A]);
    });

    it("drops a removed row's password", () => {
      const { rows, kept } = carried([{ id: "b" }]);
      expect(rows.map(row => row.pw)).toEqual([HASH_B]);
      expect([...kept]).toEqual([HASH_B]);
    });

    it("never carries a row's password to a row at another place that names none, or to a copy", () => {
      // Row b moved first; the new id-less row now at b's old place takes
      // nothing of b's or a's.
      const moved = carried([{ id: "b" }, { label: "new" }]);
      expect(moved.rows.map(row => row.pw)).toEqual([HASH_B, undefined]);
      // A second row naming a's id is a copy, and gets no password.
      const copied = carried([{ id: "a" }, { id: "a" }]);
      expect(copied.rows.map(row => row.pw)).toEqual([HASH_A, undefined]);
    });

    it("refuses a row sent without its id that changed, rather than guess whose password it keeps", () => {
      // Reordered by a writer that sends no ids: by position, a's row would
      // be handed b's password.
      let refused: unknown;
      try {
        carried([{ label: "b" }, { label: "a" }]);
      } catch (error) {
        refused = error;
      }
      expect(refused).toMatchObject({
        code: "VALIDATION_ERROR",
        publicData: {
          errors: [
            {
              path: "lines.0",
              code: "ROW_ID_REQUIRED",
              message: expect.stringContaining(
                "Row 1 of 'lines' changed without its id"
              ),
            },
          ],
        },
      });
    });

    it("names a nested row by its whole path when it refuses it", () => {
      const nested = [
        {
          name: "lines",
          type: "repeater",
          fields: [
            {
              name: "items",
              type: "repeater",
              fields: [
                { name: "label", type: "text" },
                { name: "pw", type: "password" },
              ],
            },
          ],
        },
      ];
      const stored = {
        lines: [{ id: "a", items: [{ id: "i", label: "i", pw: HASH_A }] }],
      };
      const data: Record<string, unknown> = {
        lines: [{ id: "a", items: [{ label: "edited" }] }],
      };
      let refused: unknown;
      try {
        carryStoredPasswords(data, stored, nested, NO_FIELD_GROUPS);
      } catch (error) {
        refused = error;
      }
      expect(refused).toMatchObject({
        publicData: {
          errors: [
            {
              path: "lines.0.items.0",
              message: expect.stringContaining("Row 1 of 'lines.0.items'"),
            },
          ],
        },
      });
    });

    it("tells rows apart by an authored id inside a group before keeping a password", () => {
      const tagged = [
        {
          name: "creds",
          type: "repeater",
          fields: [
            {
              name: "meta",
              type: "group",
              fields: [{ name: "id", type: "text" }],
            },
            { name: "pw", type: "password" },
          ],
        },
      ];
      const stored = {
        creds: [
          { id: "a", meta: { id: "x" }, pw: HASH_A },
          { id: "b", meta: { id: "y" }, pw: HASH_B },
        ],
      };
      // Swapped by a writer sending no ids: by position, x would get y's.
      const data: Record<string, unknown> = {
        creds: [{ meta: { id: "y" } }, { meta: { id: "x" } }],
      };
      expect(() =>
        carryStoredPasswords(data, stored, tagged, NO_FIELD_GROUPS)
      ).toThrow();
    });

    it("keeps the password of an unchanged id-less row among rows with ids", () => {
      // b is sent with its id; a, unchanged, without. a takes the stored row
      // at its place, which no sent row names, and keeps its password.
      const { rows } = carried([{ label: "a" }, { id: "b" }]);
      expect(rows.map(row => row.pw)).toEqual([HASH_A, HASH_B]);
      // Changed, the same row is refused rather than its password dropped.
      expect(() => carried([{ label: "edited" }, { id: "b" }])).toThrow();
    });

    it("matches a row read at depth, its relationship populated, as unchanged", () => {
      const linked = [
        {
          name: "links",
          type: "repeater",
          fields: [
            { name: "target", type: "relationship", relationTo: "pages" },
            { name: "pw", type: "password" },
          ],
        },
      ];
      const stored = { links: [{ id: "a", target: "page-1", pw: HASH_A }] };
      // Round-tripped from a populated read, without ids or the password.
      const data: Record<string, unknown> = {
        links: [{ target: { id: "page-1", title: "Home" } }],
      };
      carryStoredPasswords(data, stored, linked, NO_FIELD_GROUPS);
      expect((data.links as Array<Record<string, unknown>>)[0]?.pw).toBe(
        HASH_A
      );
    });

    it("reads an empty id as no id, so the row's password is never dropped", () => {
      // An empty id names no row: unchanged, the row keeps its password by
      // place; changed, it is refused like any row sent without its id.
      const { rows } = carried([{ id: "", label: "a" }, { id: "b" }]);
      expect(rows.map(row => row.pw)).toEqual([HASH_A, HASH_B]);
      expect(() => carried([{ id: "", label: "edited" }])).toThrow();
    });

    it("keeps everything else working without ids", () => {
      // A row sending its own password keeps no stored one: nothing to guess.
      expect(carried([{ label: "x", pw: "new-secret" }]).rows[0]?.pw).toBe(
        "new-secret"
      );
      // A stored row with no password has nothing to hand on.
      const plain = { lines: [{ id: "a", label: "a" }] };
      const data: Record<string, unknown> = { lines: [{ label: "edited" }] };
      expect(() =>
        carryStoredPasswords(data, plain, LINES, NO_FIELD_GROUPS)
      ).not.toThrow();
      // Rows stored before rows had ids pair by position, as they did.
      const legacy = { lines: [{ label: "a", pw: HASH_A }] };
      const edited: Record<string, unknown> = { lines: [{ label: "edited" }] };
      carryStoredPasswords(edited, legacy, LINES, NO_FIELD_GROUPS);
      expect((edited.lines as Array<Record<string, unknown>>)[0]?.pw).toBe(
        HASH_A
      );
    });

    it("never carries a password into a different field", () => {
      const { rows } = carried([{ id: "a" }]);
      expect(rows[0]?.pw).toBe(HASH_A);
      expect(rows[0]?.pin).toBeUndefined();
    });
  });

  it("keeps each password of a repeater sent without any ids, though its stored rows carry them", () => {
    // Every write stores repeater rows with ids, so a writer that never sends
    // them would otherwise lose every password it leaves out: a list sent
    // with no ids at all pairs by position, as it did before rows had ids.
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
    const data: Record<string, unknown> = {
      lines: [{ label: "a" }, { label: "b" }],
    };

    const kept = carryStoredPasswords(
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
    expect(lines.map(line => line.pw)).toEqual([HASH_A, HASH_B]);
    expect([...kept].sort()).toEqual([HASH_A, HASH_B].sort());
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

describe("queriesPassword", () => {
  const fields = [
    { name: "title", type: "text" },
    { name: "pin", type: "password" },
    {
      name: "account",
      type: "group",
      fields: [{ name: "code", type: "password" }],
    },
    { name: "profile", type: "group", fields: [{ name: "bio", type: "text" }] },
    // An unnamed container: its children are columns of the table itself.
    { type: "row", fields: [{ name: "recoveryCode", type: "password" }] },
  ];

  it("finds a password, and a container holding one, in any spelling", () => {
    expect(queriesPassword(fields, "pin")).toBe(true);
    expect(queriesPassword(fields, "account")).toBe(true);
    expect(queriesPassword(fields, "account.code")).toBe(true);
    expect(queriesPassword(fields, "recovery_code")).toBe(true);
  });

  it("finds a password inside an unnamed container by its own name", () => {
    expect(queriesPassword(fields, "recoveryCode")).toBe(true);
  });

  it("leaves fields that hold no password alone", () => {
    expect(queriesPassword(fields, "title")).toBe(false);
    expect(queriesPassword(fields, "profile.bio")).toBe(false);
  });
});
