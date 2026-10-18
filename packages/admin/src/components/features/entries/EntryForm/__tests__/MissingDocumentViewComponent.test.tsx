/**
 * The sentence a document view draws when its component is not registered:
 * the developer's instruction only where the running server says it is in
 * development, and a plain one everywhere else.
 */
import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const branding = vi.hoisted(() => ({ current: {} as { devReload?: boolean } }));

vi.mock("@admin/context/providers/BrandingProvider", () => ({
  useBranding: () => branding.current,
}));

import { MissingDocumentViewComponent } from "../MissingDocumentViewComponent";

const PATH = "@acme/builder/admin#Builder";

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  branding.current = {};
});

describe("MissingDocumentViewComponent", () => {
  it("tells a developer which component and how to fix it", () => {
    branding.current = { devReload: true };
    render(<MissingDocumentViewComponent path={PATH} />);

    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain(
      "This screen's component isn't in the admin's component map."
    );
    expect(alert.textContent).toContain(PATH);
    expect(alert.textContent).toContain("nextly generate:types");
  });

  it.each([
    ["a production server", { devReload: false }],
    ["an answer that has not arrived", {}],
  ])("tells an author only that it is unavailable, on %s", (_case, value) => {
    branding.current = value;
    render(<MissingDocumentViewComponent path={PATH} />);

    const alert = screen.getByRole("alert");
    expect(alert.textContent).toBe(
      "This screen isn't available. Ask your developer."
    );
    // The detail is still said, where a developer looks.
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining(PATH));
  });
});
