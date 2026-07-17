import { describe, expect, it } from "vitest";

import type { FormField, FormNotificationItem } from "../types";

import {
  buildFieldReferenceMap,
  findFieldReferences,
} from "./field-references";

function textField(name: string, label = name): FormField {
  return { type: "text", name, label, required: false };
}

function notification(
  overrides: Partial<FormNotificationItem> & { name: string }
): FormNotificationItem {
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
