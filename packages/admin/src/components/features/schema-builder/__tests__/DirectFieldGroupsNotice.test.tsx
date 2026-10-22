// A field group placed directly in another field group's fields has no storage: what is entered
// there is not saved, and a save that carries it is refused. The builder names each one so an
// existing definition shows what to move, rather than leaving it to the first refused save.
import { describe, expect, it } from "vitest";

import { render, screen } from "@admin/__tests__/utils";

import { DirectFieldGroupsNotice } from "../DirectFieldGroupsNotice";
/** A field as the field group's stored definition holds it. */
type StoredField = {
  name: string;
  label?: string;
  type: string;
  virtual?: boolean;
  fields?: StoredField[];
};

function field(
  name: string,
  overrides: Partial<StoredField> = {}
): StoredField {
  return { name, label: name, type: "text", ...overrides };
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

  // A virtual field group is computed on read and stores nothing anywhere, so nothing is lost and
  // the write does not refuse it: the notice classifies fields as the write does.
  it("does not name a virtual field group placed directly in the fields", () => {
    const { container } = render(
      <DirectFieldGroupsNotice
        fields={[field("badge", { type: "component", virtual: true })]}
      />
    );
    expect(container).toBeEmptyDOMElement();
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
