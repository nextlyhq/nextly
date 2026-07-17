import { describe, expect, it } from "vitest";

import type { FormField, FormNotification } from "../types";

import {
  buildFieldReferenceMap,
  findFieldReferences,
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
