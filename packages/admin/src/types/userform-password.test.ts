/**
 * Every admin form that sets a password accepts exactly what the server
 * accepts. The server's rule is the authority; the admin keeps a copy only so
 * a person sees what is wrong before submitting, so the copy is held to the
 * server's rule here on the same cases.
 *
 * The server's schema is imported from its source, as
 * hooks/__tests__/system-resources-parity.test.ts does: the `nextly` package
 * entry is server code and does not belong in the admin's client bundle.
 */
import { describe, expect, it } from "vitest";

import { PasswordSchema } from "../../../nextly/src/schemas/_zod/validation";
import { passwordSchema } from "../lib/validation";

import { createUserFormSchema, editUserFormSchema } from "./userform";

/** A password of `length` characters that meets every other rule. */
const ofLength = (length: number) => "Aa1!".padEnd(length, "a");

// Each case names what it exercises, and what the server decides about it,
// so a case that stopped exercising anything would show. The server's rule
// is length (code points), the common list and the digester's 72-byte reach
// — no character class is required — so the class-mix cases decide true.
const CASES: { name: string; password: string; server: boolean }[] = [
  { name: "a hyphen as the symbol", password: "Passw0rd-x", server: true },
  { name: "a space as the symbol", password: "Pass w0rd", server: true },
  { name: "a non-Latin symbol", password: "Passw0rd€", server: true },
  { name: "a letter outside A-Z", password: "Passw0rdé", server: true },
  { name: "every letter uppercase", password: "PASSW0RD!", server: true },
  { name: "no uppercase letter", password: "passw0rd!", server: true },
  { name: "no symbol", password: "Passw0rdX", server: true },
  {
    name: "a near-miss of a listed password",
    password: "Password!",
    server: false,
  },
  { name: "the head of the common list", password: "password", server: false },
  {
    name: "lowercase only at the minimum length, no class needed",
    password: "xyzwvuts",
    server: true,
  },
  { name: "7 characters", password: ofLength(7), server: false },
  { name: "8 characters", password: ofLength(8), server: true },
  {
    name: "72 ASCII characters, exactly at the digester's reach",
    password: "a".repeat(72),
    server: true,
  },
  {
    name: "73 ASCII characters, one byte past the reach",
    password: "a".repeat(73),
    server: false,
  },
  {
    name: "18 emoji, 18 characters and exactly 72 bytes",
    password: "😀".repeat(18),
    server: true,
  },
  {
    name: "19 emoji, 76 bytes — past the reach",
    password: "😀".repeat(19),
    server: false,
  },
  {
    name: "129 emoji — past the 128-character cap as well",
    password: "😀".repeat(129),
    server: false,
  },
];

const account = {
  fullName: "Ada Lovelace",
  email: "ada@example.com",
  roles: ["editor"],
};

const FORMS: { name: string; accepts: (password: string) => boolean }[] = [
  {
    name: "the shared rule (sign-up, setup, reset, invite, first sign-in)",
    accepts: password => passwordSchema.safeParse(password).success,
  },
  {
    name: "the create-user form, setting a password now",
    accepts: password =>
      createUserFormSchema.safeParse({
        ...account,
        signInMethod: "password",
        password,
      }).success,
  },
  {
    name: "the edit-user form, setting a new password",
    accepts: password =>
      editUserFormSchema.safeParse({ ...account, password }).success,
  },
];

describe("the server's password rule", () => {
  it.each(CASES)("decides $name as expected", ({ password, server }) => {
    expect(PasswordSchema.safeParse(password).success).toBe(server);
  });
});

describe.each(FORMS)("$name", ({ accepts }) => {
  it.each(CASES)("decides $name as the server does", ({ password }) => {
    expect(accepts(password)).toBe(PasswordSchema.safeParse(password).success);
  });
});

describe("the forms' other password states", () => {
  it("lets the edit form keep the current password when the field is empty", () => {
    expect(
      editUserFormSchema.safeParse({ ...account, password: "" }).success
    ).toBe(true);
  });

  it("needs no password when the create form sends an invite", () => {
    expect(
      createUserFormSchema.safeParse({ ...account, signInMethod: "invite" })
        .success
    ).toBe(true);
  });

  it("names each rule a password misses, as the server does", () => {
    const result = createUserFormSchema.safeParse({
      ...account,
      signInMethod: "password",
      password: "password",
    });

    expect(result.success).toBe(false);
    expect(
      result.error?.issues
        .filter(issue => issue.path.join(".") === "password")
        .map(issue => issue.message)
    ).toEqual(
      PasswordSchema.safeParse("password").error?.issues.map(
        issue => issue.message
      )
    );
  });
});

// What the edit page sends, a password exactly as typed and none for an empty
// field, is asserted where the page itself submits: in
// src/pages/dashboard/users/edit.test.tsx, which observes the mutation.
