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
// so a case that stopped exercising anything would show.
const CASES: { name: string; password: string; server: boolean }[] = [
  { name: "a hyphen as the symbol", password: "Passw0rd-x", server: true },
  { name: "a space as the symbol", password: "Pass w0rd", server: true },
  { name: "a non-Latin symbol", password: "Passw0rd€", server: true },
  { name: "a letter outside A-Z", password: "Passw0rdé", server: true },
  { name: "no lowercase letter", password: "PASSW0RD!", server: false },
  { name: "no uppercase letter", password: "passw0rd!", server: false },
  { name: "no number", password: "Password!", server: false },
  { name: "no symbol", password: "Passw0rdX", server: false },
  { name: "7 characters", password: ofLength(7), server: false },
  { name: "8 characters", password: ofLength(8), server: true },
  { name: "9 characters", password: ofLength(9), server: true },
  { name: "127 characters", password: ofLength(127), server: true },
  { name: "128 characters", password: ofLength(128), server: true },
  { name: "129 characters", password: ofLength(129), server: false },
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
