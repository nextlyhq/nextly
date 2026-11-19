// @vitest-environment jsdom
/**
 * Activity's search by address: it searches only when submitted, with the
 * whole address trimmed, keeps the address out of the browser's saved form
 * entries, and offers a way back to the whole Activity only while searching.
 *
 * @module components/features/email-hub/activity/__tests__/AddressSearch.test
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { AddressSearch } from "../AddressSearch";

function field(): HTMLInputElement {
  return screen.getByLabelText(
    "Find what was sent to an address"
  ) as HTMLInputElement;
}

describe("the search by address", () => {
  it("searches only when submitted, for the address as typed less its spaces", () => {
    const onSearch = vi.fn();
    render(
      <AddressSearch searching={false} onSearch={onSearch} onClear={vi.fn()} />
    );
    fireEvent.change(field(), { target: { value: "  ada@example.test " } });
    // Typing alone searches nothing: each search is recorded.
    expect(onSearch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    expect(onSearch).toHaveBeenCalledWith("ada@example.test");
  });

  it("keeps the address out of the browser's saved form entries", () => {
    render(
      <AddressSearch searching={false} onSearch={vi.fn()} onClear={vi.fn()} />
    );
    expect(field().getAttribute("autocomplete")).toBe("off");
    expect(field().getAttribute("type")).toBe("email");
    expect(field().getAttribute("name")).toBeNull();
  });

  it("offers Clear search only while searching, emptying the field", () => {
    const onClear = vi.fn();
    const { rerender } = render(
      <AddressSearch searching={false} onSearch={vi.fn()} onClear={onClear} />
    );
    expect(screen.queryByRole("button", { name: "Clear search" })).toBeNull();
    rerender(<AddressSearch searching onSearch={vi.fn()} onClear={onClear} />);
    fireEvent.change(field(), { target: { value: "ada@example.test" } });
    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
    expect(onClear).toHaveBeenCalledTimes(1);
    expect(field().value).toBe("");
  });
});
