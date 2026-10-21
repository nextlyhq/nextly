// A field group placed directly in another field group's fields has no storage: what is entered
// there is not saved, and a save that carries it is refused. The builder names each one so an
// existing definition shows what to move, rather than leaving it to the first refused save.
import { describe, expect, it } from "vitest";

import { render, screen } from "@admin/__tests__/utils";

import { DirectFieldGroupsNotice } from "../DirectFieldGroupsNotice";
import type { BuilderField } from "../types";

function field(
  name: string,
  overrides: Partial<BuilderField> = {}
): BuilderField {
  return {
    id: `field_${name}`,
    name,
    label: name,
    type: "text",
    validation: {},
    ...overrides,
  };
}

describe("DirectFieldGroupsNotice", () => {
  it("names each field group placed directly in the fields", () => {
    render(
      <DirectFieldGroupsNotice
        fields={[
          field("title"),
          field("badge", { label: "Badge", type: "component" }),
          field("meta", {
            type: "group",
            fields: [field("seal", { type: "component" })],
          }),
        ]}
      />
    );
    const notice = screen.getByText(/is not saved/);
    expect(notice).toHaveTextContent("Badge");
    expect(notice).not.toHaveTextContent("seal");
  });

  it("draws nothing when every field group is held in a group or repeater", () => {
    const { container } = render(
      <DirectFieldGroupsNotice
        fields={[
          field("chips", {
            type: "repeater",
            fields: [field("badge", { type: "component" })],
          }),
        ]}
      />
    );
    expect(container).toBeEmptyDOMElement();
  });
});
