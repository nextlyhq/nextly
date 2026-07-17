import { describe, expect, it } from "vitest";

import { buildNotificationEmails, parseJsonColumn } from "../plugin";
import type { FormNotification } from "../types";

function rule(
  overrides: Partial<FormNotification> & { id: string }
): FormNotification {
  return {
    name: overrides.id,
    enabled: true,
    recipientType: "static",
    to: "team@example.com",
    cc: [],
    bcc: [],
    templateSlug: "form-notification",
    ...overrides,
  };
}

function build(
  notifications: FormNotification[],
  submittedData: Record<string, unknown> = {},
  defaultFrom?: string
) {
  return buildNotificationEmails({
    notifications,
    submittedData,
    formName: "Contact",
    submissionId: "sub_1",
    defaultFrom,
  });
}

describe("buildNotificationEmails", () => {
  it("resolves the sender from the rule first, then the plugin default, then leaves it to the provider chain", () => {
    const { emails } = build(
      [
        rule({ id: "own", senderEmail: "rule@example.com" }),
        rule({ id: "plugin-default" }),
      ],
      {},
      "default@example.com"
    );
    expect(emails.map(e => e.from)).toEqual([
      "rule@example.com",
      "default@example.com",
    ]);

    const { emails: noDefault } = build([rule({ id: "none" })]);
    expect(noDefault[0].from).toBeUndefined();
  });

  it("treats a whitespace-only sender as unset", () => {
    const { emails } = build(
      [rule({ id: "blank", senderEmail: "   " })],
      {},
      "default@example.com"
    );
    expect(emails[0].from).toBe("default@example.com");
  });

  it("skips a rule whose send condition is unmet and sends when it is met", () => {
    const notifications = [
      rule({
        id: "sales",
        condition: { field: "budget", comparison: "equals", value: "high" },
      }),
    ];

    const unmet = build(notifications, { budget: "low" });
    expect(unmet.emails).toEqual([]);
    expect(unmet.skipped).toEqual([
      { notificationId: "sales", reason: "condition-unmet" },
    ]);

    const met = build(notifications, { budget: "high" });
    expect(met.emails).toHaveLength(1);
    expect(met.skipped).toEqual([]);
  });

  it("sends unconditionally when no condition is set", () => {
    const { emails, skipped } = build([rule({ id: "always" })]);
    expect(emails).toHaveLength(1);
    expect(skipped).toEqual([]);
  });

  it("resolves reply-to field references and drops references to values the visitor left empty", () => {
    const notifications = [
      rule({ id: "with-value", replyTo: "{{email}}" }),
      rule({ id: "without-value", replyTo: "{{missing}}" }),
      rule({ id: "literal", replyTo: "replies@example.com" }),
    ];

    const { emails } = build(notifications, { email: "visitor@example.com" });
    expect(emails.map(e => e.replyTo)).toEqual([
      "visitor@example.com",
      undefined,
      "replies@example.com",
    ]);
  });

  it("skips disabled rules silently and reports missing templates and empty recipients", () => {
    const { emails, skipped } = build([
      rule({ id: "off", enabled: false }),
      rule({ id: "no-template", templateSlug: undefined }),
      rule({ id: "no-recipient", to: "" }),
      rule({
        id: "unresolved-field",
        recipientType: "field",
        to: "{{email}}",
      }),
    ]);

    expect(emails).toEqual([]);
    expect(skipped).toEqual([
      { notificationId: "no-template", reason: "no-template" },
      { notificationId: "no-recipient", reason: "empty-recipient" },
      { notificationId: "unresolved-field", reason: "empty-recipient" },
    ]);
  });

  it("deduplicates rules sharing an id and keeps cc/bcc only when non-empty", () => {
    const { emails } = build([
      rule({ id: "dup", cc: ["cc@example.com"], bcc: [] }),
      rule({ id: "dup" }),
    ]);

    expect(emails).toHaveLength(1);
    expect(emails[0].cc).toEqual(["cc@example.com"]);
    expect(emails[0].bcc).toBeUndefined();
  });

  it("carries the form metadata into the template variables", () => {
    const { emails } = build([rule({ id: "vars" })], { email: "a@b.co" });
    expect(emails[0].variables).toMatchObject({
      email: "a@b.co",
      formName: "Contact",
      submissionId: "sub_1",
    });
  });
});

describe("parseJsonColumn", () => {
  it("passes objects through and parses serialized JSON from text-storage dialects", () => {
    expect(parseJsonColumn({ a: 1 })).toEqual({ a: 1 });
    expect(parseJsonColumn('{"email":"a@b.co","text":"send"}')).toEqual({
      email: "a@b.co",
      text: "send",
    });
  });

  it("degrades every non-object shape to an empty record", () => {
    expect(parseJsonColumn(null)).toEqual({});
    expect(parseJsonColumn(undefined)).toEqual({});
    expect(parseJsonColumn("not json")).toEqual({});
    expect(parseJsonColumn("[1,2]")).toEqual({});
    expect(parseJsonColumn(42)).toEqual({});
    expect(parseJsonColumn([1, 2])).toEqual({});
  });
});
