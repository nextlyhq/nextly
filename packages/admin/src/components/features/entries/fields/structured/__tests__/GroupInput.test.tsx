/**
 * GroupInput.hideGutter wiring test.
 *
 * Pins the contract that:
 *  - Without `admin.hideGutter`, named groups render in a Card chrome
 *    (border + bordered header + padded content).
 *  - With `admin.hideGutter: true`, named groups drop the Card chrome and
 *    render as a flat collapsible (label + chevron above, fields directly
 *    below) so groups declared purely for nesting don't add visual weight.
 *
 * Regression coverage for the wiring gap where `hideGutter` lived on the
 */
import type { GroupFieldConfig } from "nextly/config";
import { useForm, FormProvider } from "react-hook-form";
import { describe, it, expect } from "vitest";

import { render } from "@admin/__tests__/utils";

import { GroupInput } from "../GroupInput";

function Harness({ field }: { field: GroupFieldConfig }) {
  const methods = useForm({ defaultValues: {} });
  return (
    <FormProvider {...methods}>
      <GroupInput name={field.name ?? ""} field={field} />
    </FormProvider>
  );
}

const namedGroup: GroupFieldConfig = {
  type: "group",
  name: "address",
  label: "Shipping address",
  fields: [{ type: "text", name: "city", label: "City" } as never],
};

describe("GroupInput — hideGutter knob", () => {
  it("renders Card chrome by default (border + bordered header)", () => {
    const { container } = render(<Harness field={namedGroup} />);
    // The default branch wraps the group in a Card-like element with
    // border classes — `border-primary/5` is the Card style we drop in
    // hideGutter mode. Looking for it confirms the chrome is present.
    const styled = container.querySelector('div[class*="border-primary/5"]');
    expect(styled).toBeTruthy();
  });

  it("drops the Card chrome when admin.hideGutter is true", () => {
    const flatGroup: GroupFieldConfig = {
      ...namedGroup,
      admin: { hideGutter: true },
    };
    const { container } = render(<Harness field={flatGroup} />);
    // Same border class should be absent on the flat path.
    expect(
      container.querySelector('div[class*="border-primary/5"]')
    ).toBeNull();
  });

  it("still shows the label + chevron when hideGutter is true", () => {
    const flatGroup: GroupFieldConfig = {
      ...namedGroup,
      admin: { hideGutter: true },
    };
    const { container, getByText } = render(<Harness field={flatGroup} />);
    // Label visible.
    expect(getByText("Shipping address")).toBeInTheDocument();
    // The trigger button is the only `aria-expanded` host on this surface
    // — confirms the collapsible is still in place.
    expect(container.querySelector("[aria-expanded]")).toBeTruthy();
  });
});
