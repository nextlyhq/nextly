import { describe, expect, it } from "vitest";

import type { FormField, FormNotification } from "../types";

import {
  buildFieldReferenceMap,
  findFieldReferences,
  renameInFieldConditions,
  renameInNotifications,
} from "./field-references";

function textField(name: string, label = name): FormField {
  return { type: "text", name, label, required: false };
}

function notification(
  overrides: Partial<FormNotification> & { name: string }
): FormNotification {
  return {
    id: overrides.name,
    enabled: true,
    recipientType: "static",
    to: "team@example.com",
    cc: [],
    bcc: [],
    ...overrides,
  };
}

describe("findFieldReferences", () => {
  it("finds a field referenced by another field's conditional logic", () => {
    const fields: FormField[] = [
      textField("plan"),
      {
        ...textField("company", "Company name"),
        conditionalLogic: {
          enabled: true,
          action: "show",
          operator: "AND",
          conditions: [{ field: "plan", comparison: "equals", value: "pro" }],
        },
      },
    ];

    const refs = findFieldReferences("plan", fields, []);
    expect(refs).toEqual([{ kind: "condition", label: "Company name" }]);
  });

  it("ignores conditions whose conditional logic is disabled", () => {
    const fields: FormField[] = [
      textField("plan"),
      {
        ...textField("company"),
        conditionalLogic: {
          enabled: false,
          action: "show",
          operator: "AND",
          conditions: [{ field: "plan", comparison: "equals", value: "pro" }],
        },
      },
    ];

    expect(findFieldReferences("plan", fields, [])).toEqual([]);
  });

  it("does not count a field's own conditions as a reference to itself", () => {
    const fields: FormField[] = [
      {
        ...textField("plan"),
        conditionalLogic: {
          enabled: true,
          action: "hide",
          operator: "AND",
          conditions: [{ field: "plan", comparison: "isEmpty" }],
        },
      },
    ];

    expect(findFieldReferences("plan", fields, [])).toEqual([]);
  });

  it("finds a field used as a notification recipient", () => {
    const notifications = [
      notification({
        name: "Autoresponder",
        recipientType: "field",
        to: "{{email}}",
      }),
    ];

    expect(findFieldReferences("email", [], notifications)).toEqual([
      { kind: "notification", label: "Autoresponder" },
    ]);
  });

  it("finds interpolations in cc and bcc, tolerating whitespace", () => {
    const notifications = [
      notification({ name: "Team copy", cc: ["{{ email }}"] }),
      notification({ name: "Archive", bcc: ["{{email}}"] }),
    ];

    const refs = findFieldReferences("email", [], notifications);
    expect(refs.map(r => r.label).sort()).toEqual(["Archive", "Team copy"]);
  });

  it("does not match other fields or partial names", () => {
    const notifications = [
      notification({ name: "Autoresponder", to: "{{email_backup}}" }),
    ];

    expect(findFieldReferences("email", [], notifications)).toEqual([]);
  });

  it("finds a field used as a notification reply-to", () => {
    const notifications = [
      notification({ name: "Admin notification", replyTo: "{{email}}" }),
    ];

    expect(findFieldReferences("email", [], notifications)).toEqual([
      { kind: "notification", label: "Admin notification" },
    ]);
  });

  it("finds a field named by a notification's send condition", () => {
    const notifications = [
      notification({
        name: "Sales alert",
        condition: { field: "budget", comparison: "equals", value: "high" },
      }),
    ];

    expect(findFieldReferences("budget", [], notifications)).toEqual([
      { kind: "notification", label: "Sales alert" },
    ]);
  });

  it("finds a field named by one of several conditions, or attached by name", () => {
    const notifications = [
      notification({
        name: "Access team",
        conditions: {
          match: "any",
          list: [
            { field: "join", comparison: "equals", value: "online" },
            { field: "access", comparison: "isNotEmpty" },
          ],
        },
      }),
      notification({ name: "Hiring", attachFields: ["cv"] }),
    ];

    expect(findFieldReferences("access", [], notifications)).toEqual([
      { kind: "notification", label: "Access team" },
    ]);
    expect(findFieldReferences("cv", [], notifications)).toEqual([
      { kind: "notification", label: "Hiring" },
    ]);
  });

  it("ignores references held by disabled notifications", () => {
    const notifications = [
      notification({
        name: "Paused rule",
        enabled: false,
        recipientType: "field",
        to: "{{email}}",
        replyTo: "{{email}}",
        condition: { field: "email", comparison: "isNotEmpty" },
      }),
    ];

    expect(findFieldReferences("email", [], notifications)).toEqual([]);
  });

  it("reports one reference per notification even when it references the field several ways", () => {
    const notifications = [
      notification({
        name: "Autoresponder",
        recipientType: "field",
        to: "{{email}}",
        replyTo: "{{email}}",
        condition: { field: "email", comparison: "isNotEmpty" },
      }),
    ];

    expect(findFieldReferences("email", [], notifications)).toEqual([
      { kind: "notification", label: "Autoresponder" },
    ]);
  });

  it("builds the whole reference map in one pass", () => {
    const fields: FormField[] = [
      textField("plan"),
      {
        ...textField("company", "Company"),
        conditionalLogic: {
          enabled: true,
          action: "show",
          operator: "AND",
          conditions: [{ field: "plan", comparison: "equals", value: "pro" }],
        },
      },
    ];

    const map = buildFieldReferenceMap(fields, []);
    expect(map.get("plan")).toEqual([{ kind: "condition", label: "Company" }]);
    expect(map.get("company")).toEqual([]);
  });

  it("returns empty for an unreferenced field", () => {
    expect(
      findFieldReferences(
        "phone",
        [textField("email")],
        [notification({ name: "Plain" })]
      )
    ).toEqual([]);
  });
});

describe("moving references with a renamed field", () => {
  const notification: FormNotification = {
    id: "n1",
    name: "Team",
    enabled: false,
    recipientType: "field",
    to: "{{ email }}",
    cc: ["{{email}}", "{{email_2}}"],
    bcc: ["boss@example.com"],
    replyTo: "{{email}}",
    condition: { field: "email", comparison: "isNotEmpty" },
  };

  it("renames every address and the condition, and nothing else", () => {
    const [next] = renameInNotifications([notification], "email", "work");
    expect(next).toEqual({
      ...notification,
      to: "{{work}}",
      cc: ["{{work}}", "{{email_2}}"],
      bcc: ["boss@example.com"],
      replyTo: "{{work}}",
      condition: { field: "work", comparison: "isNotEmpty" },
    });
  });

  it("renames the field in several conditions and in the files attached", () => {
    const [next] = renameInNotifications(
      [
        {
          ...notification,
          conditions: {
            match: "all",
            list: [
              { field: "email", comparison: "isNotEmpty" },
              { field: "join", comparison: "equals", value: "online" },
            ],
          },
          attachFields: ["email", "photo"],
        },
      ],
      "email",
      "work"
    );
    expect(next?.conditions).toEqual({
      match: "all",
      list: [
        { field: "work", comparison: "isNotEmpty" },
        { field: "join", comparison: "equals", value: "online" },
      ],
    });
    expect(next?.attachFields).toEqual(["work", "photo"]);
  });

  it("renames conditions on the field in every other field, enabled or not", () => {
    const fields = [
      { type: "email", name: "email", label: "Email" },
      {
        type: "text",
        name: "company",
        label: "Company",
        conditionalLogic: {
          enabled: false,
          action: "show",
          operator: "AND",
          conditions: [
            { field: "email", comparison: "isNotEmpty" },
            { field: "email_2", comparison: "isNotEmpty" },
          ],
        },
      },
    ] as FormField[];
    const [, company] = renameInFieldConditions(fields, "email", "work");
    expect(company?.conditionalLogic?.conditions).toEqual([
      { field: "work", comparison: "isNotEmpty" },
      { field: "email_2", comparison: "isNotEmpty" },
    ]);
  });

  it("renames in a stored notification that predates the cc and bcc lists", () => {
    const { cc: _cc, bcc: _bcc, ...older } = notification;
    const [next] = renameInNotifications(
      [older as FormNotification],
      "email",
      "work"
    );
    expect(next).toEqual({
      ...older,
      to: "{{work}}",
      replyTo: "{{work}}",
      condition: { field: "work", comparison: "isNotEmpty" },
    });
  });
});
