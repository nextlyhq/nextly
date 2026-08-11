/**
 * What a delivery log row is allowed to know.
 *
 * The table stores a hash instead of an address so it can answer "did this
 * send" without answering "to whom". That is only worth something if every
 * value written beside the hash respects it — and the one that does not by
 * default is the error string, because a mail server quotes the recipient back
 * at you when it rejects them.
 */

import { describe, expect, it, vi } from "vitest";

// The recipient digest is keyed with the install secret, so this module reads
// the environment where it previously read nothing.
vi.mock("../../../lib/env", () => ({
  env: {
    NEXTLY_SECRET: "test-secret-that-is-long-enough-for-derivation",
    DB_DIALECT: "sqlite",
    DATABASE_URL: undefined,
    NODE_ENV: "test",
  },
}));

import { createHash } from "crypto";

import {
  MAX_ERROR_LENGTH,
  REDACTED_ADDRESS,
  hashRecipient,
  redactAddresses,
  storableError,
} from "../delivery-record";

describe("hashing a recipient", () => {
  it("is stable for the same mailbox however it was typed", () => {
    // Support hashes the address they were given. If case or whitespace
    // changed the hash, the column would answer "no record" for a message
    // that was sent, which is the worst possible answer for an audit surface.
    const canonical = hashRecipient("someone@example.com");
    expect(hashRecipient("Someone@Example.com")).toBe(canonical);
    expect(hashRecipient("  someone@example.com  ")).toBe(canonical);
  });

  it("is not a bare digest of the address", () => {
    // An email address has too little entropy to resist an offline dictionary,
    // so an unkeyed hash still identifies a person to anyone holding the
    // table — pseudonymised, not anonymised, and carrying every identity
    // obligation the hash was meant to remove. The key is the thing the holder
    // of a stolen table does not have.
    const bare = createHash("sha256")
      .update("someone@example.com")
      .digest("hex");

    expect(hashRecipient("someone@example.com")).not.toBe(bare);
  });

  it("differs for different mailboxes", () => {
    // The control: normalisation must not collapse distinct people.
    expect(hashRecipient("a@example.com")).not.toBe(
      hashRecipient("b@example.com")
    );
  });

  it("does not contain the address it hashes", () => {
    const hash = hashRecipient("someone@example.com");
    expect(hash).not.toContain("someone");
    expect(hash).not.toContain("example.com");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("redacting a provider's failure message", () => {
  it("removes the address an SMTP rejection quotes back", () => {
    // The real shape of the leak: the recipient, in the row beside its own
    // hash, in the column an operator is most likely to read.
    expect(
      redactAddresses("550 5.1.1 <someone@example.com> User unknown")
    ).toBe(`550 5.1.1 <${REDACTED_ADDRESS}> User unknown`);
  });

  it("keeps the status code and the reason", () => {
    // The control that stops redaction from becoming "store nothing useful".
    const redacted = redactAddresses(
      "550 5.1.1 <someone@example.com> User unknown"
    );
    expect(redacted).toContain("550 5.1.1");
    expect(redacted).toContain("User unknown");
  });

  it("removes every address, not only the first", () => {
    expect(redactAddresses("from a@x.com to b@y.com rejected")).toBe(
      `from ${REDACTED_ADDRESS} to ${REDACTED_ADDRESS} rejected`
    );
  });

  it("leaves a message with no address alone", () => {
    expect(redactAddresses("535 Authentication credentials invalid")).toBe(
      "535 Authentication credentials invalid"
    );
  });
});

describe("address forms a narrower pattern would miss", () => {
  // All valid, and none of them looks like the address a shape-based rule is
  // usually written for: a quoted local part holds a space, an address literal
  // has brackets, and `localhost` has no dot. They are why the rule is
  // "anything with an @" rather than a shape.
  it.each([
    ['550 <"odd user"@example.com> User unknown', "odd user"],
    ["550 <user@[192.0.2.1]> User unknown", "192.0.2.1"],
    ["550 <postmaster@localhost> User unknown", "postmaster"],
  ])("removes the recipient from %s", (message, leaked) => {
    const redacted = redactAddresses(message);
    expect(redacted).not.toContain(leaked);
    // And the control, on every one: the diagnostic survives.
    expect(redacted).toContain("User unknown");
  });

  it("leaves text with no @ alone", () => {
    // The control for the breadth: a status line is not an address.
    expect(
      redactAddresses("535 5.7.8 Authentication credentials invalid")
    ).toBe("535 5.7.8 Authentication credentials invalid");
  });
});

describe("preparing an error for storage", () => {
  it("bounds a provider that returns a whole error page", () => {
    // The bound INCLUDES the ellipsis. An exported constant named for the
    // longest text stored is one a caller may size a column or a display
    // from, so returning one character more than it says would be wrong
    // wherever it is trusted.
    const stored = storableError("x".repeat(MAX_ERROR_LENGTH + 500));
    expect(stored.length).toBe(MAX_ERROR_LENGTH);
    expect(stored.endsWith("…")).toBe(true);
  });

  it("leaves a message exactly at the bound untouched", () => {
    // The control: the reservation must cost only messages that were going to
    // be cut anyway, not one that already fits.
    const exact = "x".repeat(MAX_ERROR_LENGTH);
    expect(storableError(exact)).toBe(exact);
    expect(storableError(exact)).not.toContain("…");
  });

  it("redacts before it truncates", () => {
    // Order matters: truncating first could cut an address in half and leave
    // the readable part of it stored.
    const long = `${"x".repeat(MAX_ERROR_LENGTH - 5)} someone@example.com`;
    expect(storableError(long)).not.toContain("someone@example.com");
  });
});
