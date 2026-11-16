/**
 * A submission's answers as its emails list them.
 *
 * The property that separates a useful list from a plausible broken one is that
 * a choice reads as its option's LABEL ("Backend engineer"), not the value the
 * form stores ("backend-engineer"): a list that printed stored values would pass
 * any test that only checked a label column was present.
 */
import { describe, expect, it } from "vitest";

import type { AnyFormField } from "../../types";
import { submissionAnswers } from "../answers";

const FIELDS = [
  { type: "text", name: "full_name", label: "Full name" },
  {
    type: "select",
    name: "role",
    label: "Role",
    options: [
      { label: "Backend engineer", value: "backend-engineer" },
      { label: "Product designer", value: "product-designer" },
    ],
  },
  {
    type: "radio",
    name: "relocate",
    label: "Open to relocating?",
    options: [{ label: "Remote only", value: "remote-only" }],
  },
  { type: "checkbox", name: "keep", label: "Keep my details" },
  { type: "file", name: "cv", label: "CV" },
  { type: "hidden", name: "source", label: "Source" },
  { type: "textarea", name: "notes", label: "Anything else?" },
] as unknown as AnyFormField[];

describe("submissionAnswers", () => {
  it("lists answers by label, in the form's order, with choices by option label", () => {
    const answers = submissionAnswers(FIELDS, {
      relocate: "remote-only",
      full_name: "Hina Rossi",
      role: "backend-engineer",
      keep: false,
    });

    expect(answers).toEqual([
      { label: "Full name", value: "Hina Rossi" },
      { label: "Role", value: "Backend engineer" },
      { label: "Open to relocating?", value: "Remote only" },
      { label: "Keep my details", value: "No" },
    ]);
  });

  it("joins several chosen options by their labels", () => {
    const [answer] = submissionAnswers([FIELDS[1]], {
      role: ["backend-engineer", "product-designer"],
    });
    expect(answer.value).toBe("Backend engineer, Product designer");
  });

  it("keeps a stored value no option names, rather than dropping it", () => {
    const [answer] = submissionAnswers([FIELDS[1]], { role: "retired-role" });
    expect(answer.value).toBe("retired-role");
  });

  it("leaves out hidden fields and questions left blank", () => {
    const answers = submissionAnswers(FIELDS, {
      full_name: "Ali Shah",
      source: "website",
      notes: "   ",
    });

    expect(answers).toEqual([{ label: "Full name", value: "Ali Shah" }]);
  });

  it("leaves out a question its condition hid, even when a value was sent for it", () => {
    const fields = [
      {
        type: "radio",
        name: "attendance",
        label: "How will you join?",
        options: [
          { label: "In person", value: "in-person" },
          { label: "Online", value: "online" },
        ],
      },
      {
        type: "text",
        name: "dietary",
        label: "Dietary needs",
        conditionalLogic: {
          enabled: true,
          action: "show",
          operator: "AND",
          conditions: [
            { field: "attendance", comparison: "equals", value: "in-person" },
          ],
        },
      },
    ] as unknown as AnyFormField[];

    const online = submissionAnswers(fields, {
      attendance: "online",
      dietary: "Vegan",
    });
    expect(online.map(a => a.label)).toEqual(["How will you join?"]);

    // The control: shown, the same answer is listed.
    const inPerson = submissionAnswers(fields, {
      attendance: "in-person",
      dietary: "Vegan",
    });
    expect(inPerson.map(a => a.label)).toEqual([
      "How will you join?",
      "Dietary needs",
    ]);
  });

  it("says a file was uploaded, and whether it comes with the email, never its id", () => {
    const fields = [
      { type: "file", name: "cv", label: "CV", attachToEmail: true },
      { type: "file", name: "photos", label: "Photos" },
    ] as unknown as AnyFormField[];

    const answers = submissionAnswers(fields, {
      cv: "9594cadb-e41e-43ae-baa3-fd2d121a7cdf",
      photos: ["a", "b"],
    });

    expect(answers).toEqual([
      { label: "CV", value: "1 file, attached" },
      { label: "Photos", value: "2 files, uploaded" },
    ]);
  });
});
