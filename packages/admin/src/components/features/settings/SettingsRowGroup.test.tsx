import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";

import { SettingsRowGroup } from "./SettingsRowGroup";

describe("SettingsRowGroup", () => {
  it("supplies no vertical padding of its own", () => {
    // `FormSection` applies the rhythm to every direct child and the two are
    // additive, so a group that also padded itself would render at double the
    // gap. This is the second row idiom to have carried its own padding; the
    // section owning it is what makes them agree.
    const { container } = render(
      <SettingsRowGroup label="Events" description="Pick some">
        <input aria-label="one" />
      </SettingsRowGroup>
    );
    const row = container.querySelector('[class*="md:grid-cols-[2fr_3fr]"]');

    expect(row).not.toBeNull();
    expect(row?.className).not.toMatch(/(^|\s)py-/);
  });

  it("renders the label", () => {
    render(
      <SettingsRowGroup label="My Group">
        <input data-testid="control" />
      </SettingsRowGroup>
    );
    expect(screen.getByText("My Group")).toBeInTheDocument();
  });

  it("renders the description when provided", () => {
    render(
      <SettingsRowGroup label="My Group" description="extra help">
        <input data-testid="control" />
      </SettingsRowGroup>
    );
    expect(screen.getByText("extra help")).toBeInTheDocument();
  });

  it("names itself via role=group and aria-labelledby rather than label-for", () => {
    render(
      <SettingsRowGroup label="My Group">
        <input data-testid="control" />
      </SettingsRowGroup>
    );
    const group = screen.getByRole("group", { name: "My Group" });
    const labelledBy = group.getAttribute("aria-labelledby");
    expect(labelledBy).toBeTruthy();
    expect(document.getElementById(labelledBy as string)).toHaveTextContent(
      "My Group"
    );
    expect(document.querySelector("label")).not.toBeInTheDocument();
  });
});
