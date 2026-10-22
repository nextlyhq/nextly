/**
 * What the email editor completes and what it marks as a problem.
 *
 * Completion is exercised the way an author meets it: after `{{`, after a
 * dot, after a `|` and after `{%`. Problems are the ones the server's engine
 * refuses, at the line it would name.
 */
import { CompletionContext } from "@codemirror/autocomplete";
import { html } from "@codemirror/lang-html";
import { liquid } from "@codemirror/lang-liquid";
import { EditorState } from "@uiw/react-codemirror";
import { describe, expect, it } from "vitest";

import {
  emailCompletionSource,
  propertyCompletions,
  variableCompletions,
  type CompletionData,
} from "../liquid/liquid-completion";
import { liquidProblems } from "../liquid/liquid-problems";

const data: CompletionData = {
  declared: [{ name: "customer", description: "Who ordered", required: true }],
  sample: {
    customer: { name: "Priya", address: { city: "Lahore" } },
    order: { lines: [{ title: "Mug", quantity: 2 }], total: 18 },
  },
};

/** The labels offered with the caret at the end of `doc`. */
function offered(doc: string): string[] {
  const state = EditorState.create({
    doc,
    extensions: [liquid({ base: html() })],
  });
  const context = new CompletionContext(state, doc.length, true);
  const result = emailCompletionSource(data)(context);
  return result ? result.options.map(option => option.label) : [];
}

describe("completion", () => {
  it("offers variables after {{", () => {
    const labels = offered("<p>{{ ");
    expect(labels).toContain("customer");
    expect(labels).toContain("order");
    // Built-ins every email gets.
    expect(labels).toContain("appName");
  });

  it("offers a value's properties after a dot, through nested objects", () => {
    expect(offered("{{ customer.")).toEqual(
      expect.arrayContaining(["name", "address"])
    );
    expect(offered("{{ customer.address.")).toEqual(["city"]);
  });

  it("offers a list's item properties, as a loop variable holds them", () => {
    expect(
      propertyCompletions(data.sample, ["order", "lines"]).map(c => c.label)
    ).toEqual(["title", "quantity"]);
  });

  it("offers filters after |", () => {
    const labels = offered("{{ customer.name | ");
    expect(labels).toContain("upcase");
    expect(labels).toContain("default");
  });

  it("offers tags after {%, without the ones the engine removes", () => {
    const labels = offered("{% ");
    expect(labels).toContain("if");
    expect(labels).toContain("for");
    for (const removed of ["include", "render", "echo", "liquid", "cycle"]) {
      expect(labels).not.toContain(removed);
    }
  });

  it("lists each variable once, with what it is", () => {
    const variables = variableCompletions(data);
    expect(variables.filter(v => v.label === "customer")).toHaveLength(1);
    // A declaration's description wins over the test data's shape.
    expect(variables.find(v => v.label === "customer")?.detail).toBe(
      "Who ordered"
    );
    expect(variables.find(v => v.label === "order")?.detail).toBe("object");
  });
});

describe("problems", () => {
  it("finds nothing in a template that parses", () => {
    expect(
      liquidProblems("<p>{% if vip %}VIP{% endif %} {{ name | upcase }}</p>")
    ).toEqual([]);
  });

  it("names the line of an unclosed tag", () => {
    const [problem] = liquidProblems("<p>one</p>\n<p>{% if vip %}two</p>");
    expect(problem.line).toBe(2);
    expect(problem.message).toMatch(/not closed|endif/);
  });

  it("refuses a filter the engine doesn't have, at its line", () => {
    const [problem] = liquidProblems("line one\n{{ name | shout }}");
    expect(problem.line).toBe(2);
    expect(problem.message).toMatch(/shout/);
  });

  it("refuses the tags the engine removes, as a save would", () => {
    expect(liquidProblems("{% include 'header' %}")).toHaveLength(1);
    expect(liquidProblems("{% echo name %}")).toHaveLength(1);
  });

  it("marks where the problem is, inside the template", () => {
    const source = "Hi {{ name | shout }}";
    const [problem] = liquidProblems(source);
    expect(problem.from).toBeGreaterThanOrEqual(0);
    expect(problem.to).toBeLessThanOrEqual(source.length);
    expect(problem.to).toBeGreaterThan(problem.from);
  });
});
