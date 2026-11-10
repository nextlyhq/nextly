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

  it("leaves out files, hidden fields and questions left blank or hidden by a condition", () => {
    const answers = submissionAnswers(FIELDS, {
      full_name: "Ali Shah",
      cv: "9594cadb-e41e-43ae-baa3-fd2d121a7cdf",
      source: "website",
      notes: "   ",
    });

    expect(answers).toEqual([{ label: "Full name", value: "Ali Shah" }]);
  });
});
