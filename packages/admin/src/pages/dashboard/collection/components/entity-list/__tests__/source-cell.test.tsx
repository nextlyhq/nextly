import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SourceCell } from "../entity-list-labels";

describe("where an entry comes from", () => {
  it.each([
    ["code", undefined, "Defined in code"],
    ["ui", undefined, "Made in the Builder"],
    // A plugin's Single or field group outside its plugin's own section.
    ["plugin:@acme/shop", undefined, "@acme/shop"],
    // The name the list gives is the one shown.
    ["plugin:@acme/shop", "Shop", "Shop"],
    ["somewhere", undefined, "\u2014"],
    [undefined, undefined, "\u2014"],
  ])("reads %s, listed as %s, as %s", (source, pluginName, shown) => {
    render(<SourceCell source={source} pluginName={pluginName} />);

    expect(screen.getByText(shown)).toBeInTheDocument();
  });
});
