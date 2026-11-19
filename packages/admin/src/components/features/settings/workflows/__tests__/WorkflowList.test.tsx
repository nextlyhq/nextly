/**
 * The Workflows list draws each stage as Settings shows it everywhere else:
 * the label and colour saved for it, else the code's label on the neutral
 * swatch. The plausible broken list: one drawing the code's labels, or every
 * stage without its colour, while the editor shows the saved ones.
 */
import { describe, expect, it } from "vitest";

import { render, screen } from "@admin/__tests__/utils";

import { WorkflowList } from "../WorkflowList";

import { EDITORIAL } from "./fixtures";

describe("the Workflows list", () => {
  it("draws each stage with the label and colour Settings saved, else the code's label and no colour", () => {
    render(<WorkflowList workflows={[EDITORIAL]} />);

    expect(screen.queryByText("Legal check")).toBeNull();
    expect(
      screen.getByText("Lawyers").closest(".bg-warning-surface")
    ).not.toBeNull();
    expect(screen.getByText("Writing").closest(".bg-muted")).not.toBeNull();
  });
});
