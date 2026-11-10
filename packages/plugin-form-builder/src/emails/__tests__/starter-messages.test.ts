/**
 * The starter messages the plugin contributes to Settings › Email.
 *
 * Rendering them is the integration test's job
 * (`starter-messages.integration.test.ts`, through the real email service);
 * this holds what that test cannot see cheaply: every variable a body uses is
 * declared, so the Email hub's editor lists them, and each kind of
 * notification gets its own starter.
 */
import { describe, expect, it } from "vitest";

import {
  FORM_CONFIRMATION_TEMPLATE,
  FORM_SUBMISSION_TEMPLATE,
  formsEmailTemplates,
  starterTemplateFor,
} from "../starter-messages";

/** The top-level names a Liquid body reads, loop variables excluded. */
function namesRead(text: string): string[] {
  const loopVars = new Set(
    [...text.matchAll(/\{%\s*for\s+(\w+)\s+in/g)].map(m => m[1])
  );
  const names = [...text.matchAll(/\{\{\s*(\w+)/g)].map(m => m[1]);
  const loops = [...text.matchAll(/\{%\s*for\s+\w+\s+in\s+(\w+)/g)].map(
    m => m[1]
  );
  return [...new Set([...names, ...loops])].filter(n => !loopVars.has(n));
}

describe("formsEmailTemplates", () => {
  it("contributes the team's and the visitor's messages, as Liquid", () => {
    const templates = formsEmailTemplates();
    expect(templates.map(t => [t.slug, t.name, t.engine])).toEqual([
      [FORM_SUBMISSION_TEMPLATE, "Form submission", "liquid"],
      [FORM_CONFIRMATION_TEMPLATE, "Form confirmation", "liquid"],
    ]);
  });

  it("gives every message a plain-text body, so text-only clients get one answer per line", () => {
    for (const template of formsEmailTemplates()) {
      expect(template.plainTextContent, template.slug).toContain(
        "{{ answer.label }}: {{ answer.value }}"
      );
    }
  });

  it("declares every variable its subject and body read", () => {
    for (const template of formsEmailTemplates()) {
      const declared = new Set((template.variables ?? []).map(v => v.name));
      const read = namesRead(
        `${template.subject} ${template.htmlContent} ${template.plainTextContent ?? ""}`
      );
      expect(read.length).toBeGreaterThan(0);
      for (const name of read) expect(declared, template.slug).toContain(name);
    }
  });
});

describe("starterTemplateFor", () => {
  it("gives a notification to the visitor the confirmation and any other the team's email", () => {
    expect(starterTemplateFor("field")).toBe(FORM_CONFIRMATION_TEMPLATE);
    expect(starterTemplateFor("static")).toBe(FORM_SUBMISSION_TEMPLATE);
  });
});
