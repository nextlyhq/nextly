/**
 * A template's envelope: what a save accepts for From, Reply-To and the
 * copies, and what a send makes of them.
 *
 * - From's display name may use variables; its address may not.
 * - Reply-To may use variables, and one that renders to something other than
 *   an address fails the send as not retryable, naming the field.
 * - Copies are fixed addresses, added after the send's own without
 *   duplicates, and refused on a template that carries a secret.
 * - A field that uses no variables is sent exactly as stored.
 */
import { describe, expect, it } from "vitest";

import { NextlyError } from "../../../errors";
import {
  checkTemplateEnvelope,
  renderTemplateFrom,
  renderTemplateReplyTo,
  withTemplateCopies,
} from "../template-envelope";

const OPEN = { carriesSecret: false };

/** The validation errors a save is refused with, or [] when it is accepted. */
function refusals(
  input: Parameters<typeof checkTemplateEnvelope>[0],
  rules = OPEN
): Array<{ path: string; code: string }> {
  try {
    checkTemplateEnvelope(input, rules);
    return [];
  } catch (error) {
    expect(error).toBeInstanceOf(NextlyError);
    expect((error as NextlyError).code).toBe("VALIDATION_ERROR");
    const data = (error as NextlyError).publicData as {
      errors: Array<{ path: string; code: string }>;
    };
    return data.errors.map(({ path, code }) => ({ path, code }));
  }
}

/** What a send fails with, as the caller and the log see it. */
function failure(run: () => unknown): NextlyError {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(NextlyError);
    return error as NextlyError;
  }
  return expect.fail("the send was expected to fail");
}

describe("saving a template's From", () => {
  it("accepts variables in the display name", () => {
    expect(
      refusals({ fromOverride: "{{ shopName }} Support <help@shop.example>" })
    ).toEqual([]);
    expect(
      refusals({ fromOverride: '"{{ shopName }}, Inc" <help@shop.example>' })
    ).toEqual([]);
  });

  it("refuses a variable in the address, with or without a display name", () => {
    expect(refusals({ fromOverride: "Shop <{{ sender }}>" })).toEqual([
      { path: "fromOverride", code: "VARIABLE_ADDRESS" },
    ]);
    expect(refusals({ fromOverride: "{{ sender }}@shop.example" })).toEqual([
      { path: "fromOverride", code: "VARIABLE_ADDRESS" },
    ]);
    // A display name with no address in brackets is all address.
    expect(refusals({ fromOverride: "{{ sender }}" })).toEqual([
      { path: "fromOverride", code: "VARIABLE_ADDRESS" },
    ]);
  });

  it("refuses a display name Liquid can't read", () => {
    expect(
      refusals({ fromOverride: "{% if vip %}VIP <help@shop.example>" })
    ).toEqual([{ path: "fromOverride", code: "LIQUID_SYNTAX" }]);
  });

  it("leaves a From without variables as it always was", () => {
    // Not judged as an address here: a stored From that a provider refuses is
    // the provider's to say, as it was before.
    expect(refusals({ fromOverride: "Support <help@shop.example>" })).toEqual(
      []
    );
    expect(refusals({ fromOverride: "not an address" })).toEqual([]);
  });
});

describe("saving a template's Reply-To", () => {
  it("accepts variables, and refuses a Reply-To Liquid can't read", () => {
    expect(refusals({ replyTo: "{{ customer.email }}" })).toEqual([]);
    expect(refusals({ replyTo: "{{ customer.email" })).toEqual([
      { path: "replyTo", code: "LIQUID_SYNTAX" },
    ]);
  });
});

describe("saving a template's copies", () => {
  it("stores fixed addresses trimmed, each once, and an empty list as none", () => {
    expect(
      checkTemplateEnvelope(
        {
          cc: [" staff@shop.example", "Staff <STAFF@shop.example>"],
          bcc: [],
        },
        OPEN
      )
    ).toEqual({ cc: ["staff@shop.example"], bcc: null });
  });

  it("refuses a variable, naming the entry", () => {
    expect(
      refusals({ cc: ["staff@shop.example", "{{ manager.email }}"] })
    ).toEqual([{ path: "cc.1", code: "VARIABLE_ADDRESS" }]);
    expect(refusals({ bcc: ["{% if x %}a@b.example{% endif %}"] })).toEqual([
      { path: "bcc.0", code: "VARIABLE_ADDRESS" },
    ]);
  });

  it("refuses an entry that is not one address, and a value that is not a list", () => {
    expect(refusals({ cc: ["a@shop.example, b@shop.example"] })).toEqual([
      { path: "cc.0", code: "INVALID" },
    ]);
    expect(refusals({ bcc: [42] })).toEqual([
      { path: "bcc.0", code: "INVALID" },
    ]);
    expect(refusals({ cc: "a@shop.example" })).toEqual([
      { path: "cc", code: "INVALID" },
    ]);
  });

  it("refuses any copy on a template that carries a secret", () => {
    const secret = { carriesSecret: true };
    expect(refusals({ cc: ["staff@shop.example"] }, secret)).toEqual([
      { path: "cc", code: "CARRIES_SECRET" },
    ]);
    expect(refusals({ bcc: ["staff@shop.example"] }, secret)).toEqual([
      { path: "bcc", code: "CARRIES_SECRET" },
    ]);
    // Clearing them is how a stored copy is taken off such a template.
    expect(refusals({ cc: null, bcc: [] }, secret)).toEqual([]);
    // The control: the same copies on a template without the mark.
    expect(refusals({ cc: ["staff@shop.example"] })).toEqual([]);
  });
});

describe("a send's From", () => {
  it("sends a From without variables exactly as stored", () => {
    expect(renderTemplateFrom("Support <help@shop.example>", {}, "t")).toBe(
      "Support <help@shop.example>"
    );
  });

  it("renders the display name from the send's data before the fixed address", () => {
    expect(
      renderTemplateFrom(
        "{{ shopName }} Support <help@shop.example>",
        { shopName: "Acme" },
        "t"
      )
    ).toBe("Acme Support <help@shop.example>");
  });

  it("quotes a rendered name that holds a separator, and keeps it on one line", () => {
    expect(
      renderTemplateFrom(
        "{{ shopName }} <help@shop.example>",
        { shopName: 'Acme, "Best"\r\nBcc: x@evil.example' },
        "t"
      )
    ).toBe('"Acme, \\"Best\\" Bcc: x@evil.example" <help@shop.example>');
  });

  it("sends the address alone when the name renders empty", () => {
    expect(
      renderTemplateFrom("{{ shopName }} <help@shop.example>", {}, "t")
    ).toBe("help@shop.example");
  });

  it("fails, as not retryable, on a variable address stored past the save-time check", () => {
    const error = failure(() =>
      renderTemplateFrom("Shop <{{ sender }}>", { sender: "a@b.example" }, "t")
    );
    expect(error.logContext).toMatchObject({
      retryable: false,
      field: "fromOverride",
      slug: "t",
    });
  });
});

describe("a send's Reply-To", () => {
  it("sends a Reply-To without variables exactly as stored", () => {
    // Even one that is not an address, as before: the send's own check and
    // the provider judge it, not this.
    expect(renderTemplateReplyTo("help desk", {}, "t")).toBe("help desk");
  });

  it("renders it from the send's data", () => {
    expect(
      renderTemplateReplyTo(
        "{{ customer.email }}",
        { customer: { email: "buyer@example.com" } },
        "t"
      )
    ).toBe("buyer@example.com");
  });

  it("sets none when it renders empty", () => {
    expect(
      renderTemplateReplyTo(
        "{% if email %}{{ email }}{% endif %}",
        { email: "" },
        "t"
      )
    ).toBeUndefined();
  });

  it("fails, as not retryable and naming the field, when it renders to something that is not an address", () => {
    const error = failure(() =>
      renderTemplateReplyTo(
        "{{ email }}",
        { email: "not an address" },
        "orders"
      )
    );
    expect(error.code).toBe("BUSINESS_RULE_VIOLATION");
    expect(error.publicMessage).toMatch(/Reply-To/);
    expect(error.logContext).toMatchObject({
      retryable: false,
      field: "replyTo",
      slug: "orders",
    });
    // The rendered value came from the send's data and stays out of the log.
    expect(JSON.stringify(error.logContext)).not.toContain("not an address");
  });

  it("refuses a rendered line break rather than letting it start a header", () => {
    // Liquid's line context turns the break into a space, which leaves two
    // words: not an address.
    const error = failure(() =>
      renderTemplateReplyTo(
        "{{ email }}",
        { email: "a@b.example\r\nBcc: x@evil.example" },
        "t"
      )
    );
    expect(error.logContext).toMatchObject({ field: "replyTo" });
  });

  it("refuses a value that renders to more than one address", () => {
    const error = failure(() =>
      renderTemplateReplyTo(
        "{{ email }}",
        { email: "a@x.example, b@evil.example" },
        "t"
      )
    );
    expect(error.logContext).toMatchObject({ field: "replyTo" });
  });

  it("refuses a display name that splits the address into two", () => {
    const error = failure(() =>
      renderTemplateReplyTo(
        "{{ name }} <{{ email }}>",
        { name: "b@evil.example, Bob", email: "bob@x.example" },
        "t"
      )
    );
    expect(error.logContext).toMatchObject({ field: "replyTo" });
  });

  it("accepts one address with a display name, a quoted comma included", () => {
    expect(
      renderTemplateReplyTo(
        "{{ name }} <{{ email }}>",
        { name: "Bob", email: "bob@x.example" },
        "t"
      )
    ).toBe("Bob <bob@x.example>");
    expect(
      renderTemplateReplyTo(
        "{{ name }} <{{ email }}>",
        { name: '"Doe, Jane"', email: "jane@x.example" },
        "t"
      )
    ).toBe('"Doe, Jane" <jane@x.example>');
  });
});

describe("a send's copies", () => {
  it("returns the send's own unchanged when the template has none", () => {
    const cc = ["a@example.com"];
    const result = withTemplateCopies(
      { to: "to@example.com", cc },
      { cc: null, bcc: [] }
    );
    expect(result.cc).toBe(cc);
    expect(result.bcc).toBeUndefined();
  });

  it("adds the template's after the send's own", () => {
    expect(
      withTemplateCopies(
        { to: "to@example.com", cc: ["send@example.com"] },
        { cc: ["staff@shop.example"], bcc: ["audit@shop.example"] }
      )
    ).toEqual({
      cc: ["send@example.com", "staff@shop.example"],
      bcc: ["audit@shop.example"],
    });
  });

  it("adds no address the send already reaches, whatever its case or display name", () => {
    expect(
      withTemplateCopies(
        {
          to: ["to@example.com"],
          cc: ["Send <SEND@example.com>"],
          bcc: ["hidden@example.com"],
        },
        {
          cc: ["send@example.com", "TO@example.com", "staff@shop.example"],
          bcc: [
            "hidden@example.com",
            "staff@shop.example",
            "audit@shop.example",
          ],
        }
      )
    ).toEqual({
      cc: ["Send <SEND@example.com>", "staff@shop.example"],
      bcc: ["hidden@example.com", "audit@shop.example"],
    });
  });
});
