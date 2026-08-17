import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";

import { SettingsRowGroup } from "./SettingsRowGroup";

describe("SettingsRowGroup", () => {
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
