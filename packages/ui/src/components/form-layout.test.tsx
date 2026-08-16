// @vitest-environment jsdom
/**
 * The layout owns the measure so pages stop setting their own. FormActions
 * never computes dirtiness: the page passes it down from the form state that
 * already tracks it, because two implementations of "has this changed" drift.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { FormActions, FormLayout } from "./form-layout";

// Each `it` below renders into the shared jsdom document, and unmounting after
// every test keeps a leftover mount from one case out of the next case's DOM.
afterEach(cleanup);

describe("FormLayout", () => {
  it("centres a bounded measure by default", () => {
    render(
      <FormLayout>
        <span>body</span>
      </FormLayout>
    );
    const region = screen.getByText("body").parentElement;
    expect(region?.className).toContain("mx-auto");
    expect(region?.className).toContain("max-w-");
  });

  it("uses the form measure by default", () => {
    render(
      <FormLayout>
        <span>narrow</span>
      </FormLayout>
    );
    const region = screen.getByText("narrow").parentElement;
    expect(region?.className).toContain("max-w-[56rem]");
  });

  it("uses a wider measure when asked", () => {
    render(
      <FormLayout width="wide">
        <span>wide</span>
      </FormLayout>
    );
    const region = screen.getByText("wide").parentElement;
    expect(region?.className).toContain("max-w-[72rem]");
  });
});

describe("FormActions", () => {
  it("renders its buttons", () => {
    render(
      <FormActions>
        <button type="submit">Create key</button>
      </FormActions>
    );
    expect(screen.getByRole("button", { name: "Create key" })).toBeDefined();
  });

  it("announces unsaved changes only when the page says so", () => {
    const { rerender } = render(
      <FormActions dirty>
        <button type="submit">Save</button>
      </FormActions>
    );
    expect(screen.getByText(/unsaved/i)).toBeDefined();

    rerender(
      <FormActions>
        <button type="submit">Save</button>
      </FormActions>
    );
    expect(screen.queryByText(/unsaved/i)).toBeNull();
  });
});
