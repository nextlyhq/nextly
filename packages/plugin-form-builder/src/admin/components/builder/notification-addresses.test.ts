/**
 * One rule for whether a notification's addresses are usable, asked by two
 * callers: the field as it is left, and the page before it saves.
 *
 * They have to be the same rule. The editor writes to the form as the author
 * types, so a field that rejects an address and a save that accepts it means
 * the malformed one persists and the delivery path hands it to the provider —
 * which is what happened while the editor held the only copy of the answer.
 */
import { describe, expect, it } from "vitest";

import type { FormNotification } from "../../../types";

import {
  addressError,
  addressErrorsIn,
  badAddressMessage,
  notificationsBlockingSave,
  notificationsWithBadAddresses,
} from "./notification-addresses";

function aNotification(over: Partial<FormNotification> = {}): FormNotification {
  return {
    id: "n1",
    name: "Admin notification",
    enabled: true,
    recipientType: "static",
    to: "admin@example.com",
    cc: [],
    bcc: [],
    ...over,
  } as FormNotification;
}

describe("one address", () => {
  it("rejects a malformed one", () => {
    expect(addressError("to", "not-an-address")).toBeDefined();
  });

  it("accepts a blank one", () => {
    // Every address here is optional or has an inherited default, so blank is
    // a choice rather than a mistake.
    expect(addressError("senderEmail", "")).toBeUndefined();
    expect(addressError("senderEmail", undefined)).toBeUndefined();
  });

  it("leaves a field reference alone in reply-to", () => {
    // `{{email}}` resolves against each submission at send time, so there is
    // no address here to check yet.
    expect(addressError("replyTo", "{{email}}")).toBeUndefined();
    // And the same spelling IS an error where a reference is not accepted.
    expect(addressError("to", "{{email}}")).toBeDefined();
  });

  it("recognises only the spelling the send path resolves", () => {
    // `resolveFieldRef` matches `{{name}}` exactly. A value this exempted but
    // delivery did not resolve would reach the mail provider with its braces
    // intact, so the two read one parser and this pins the agreement.
    expect(addressError("replyTo", "{{ email }}")).toBeDefined();
    expect(addressError("replyTo", "{{my-field}}")).toBeDefined();
    expect(addressError("replyTo", "{{my_field}}")).toBeUndefined();
  });
});

describe("a whole notification", () => {
  it("reports each bad address by field", () => {
    const errors = addressErrorsIn(
      aNotification({ senderEmail: "bad", to: "worse", replyTo: "worst" })
    );
    expect(Object.keys(errors).sort()).toEqual([
      "replyTo",
      "senderEmail",
      "to",
    ]);
  });

  it("does not check the recipient when it names a field", () => {
    // A `field` recipient holds a form field's name, which is not an address.
    const errors = addressErrorsIn(
      aNotification({ recipientType: "field", to: "email" })
    );
    expect(errors.to).toBeUndefined();
  });

  it("passes a well-formed one", () => {
    expect(addressErrorsIn(aNotification())).toEqual({});
  });
});

describe("what a save must refuse", () => {
  it("names the offending rules", () => {
    const names = notificationsWithBadAddresses([
      aNotification(),
      aNotification({ id: "n2", name: "Customer receipt", to: "nope" }),
    ]);
    expect(names).toEqual(["Customer receipt"]);
  });

  it("still names an unnamed rule", () => {
    // "" would make the message read "has an invalid email address" with
    // nothing in front of it.
    const names = notificationsWithBadAddresses([
      aNotification({ name: "  ", to: "nope" }),
    ]);
    expect(names).toEqual(["Untitled notification"]);
  });

  it("passes a list with nothing wrong in it", () => {
    expect(notificationsWithBadAddresses([aNotification()])).toEqual([]);
  });

  it("says nothing when there is nothing to say", () => {
    expect(badAddressMessage([aNotification()])).toBeNull();
  });

  it("names the single offender, and counts several", () => {
    expect(badAddressMessage([aNotification({ to: "nope" })])).toBe(
      "Admin notification has an invalid email address"
    );
    expect(
      badAddressMessage([
        aNotification({ to: "nope" }),
        aNotification({ id: "n2", name: "Receipt", senderEmail: "bad" }),
      ])
    ).toBe("2 notifications have invalid email addresses");
  });

  it("refuses a nameless rule, and says so before the address", () => {
    // The sheet disabled its own commit while the name was blank; there is no
    // commit there any more, so the precondition lives here. Naming comes
    // first because an address complaint about "Untitled notification" names
    // nothing the author can go and fix.
    expect(
      notificationsBlockingSave([aNotification({ name: "  ", to: "nope" })])
    ).toBe("A notification needs a name");

    expect(
      notificationsBlockingSave([
        aNotification({ name: "" }),
        aNotification({ id: "n2", name: "" }),
      ])
    ).toBe("2 notifications need a name");
  });

  it("falls through to the address once every rule is named", () => {
    expect(notificationsBlockingSave([aNotification({ to: "nope" })])).toBe(
      "Admin notification has an invalid email address"
    );
    expect(notificationsBlockingSave([aNotification()])).toBeNull();
  });
});
