/**
 * Details lists, in order, the ID (shortened, copied whole), the API address
 * "View API response" reads (copied whole), and when the document was made
 * and last changed, each with who did it where that is recorded, and the date
 * alone where it is not.
 */
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { render, screen } from "@admin/__tests__/utils";
import { documentApiAddress } from "@admin/hooks/useEntryJSON";

import { DetailsSection } from "../DetailsSection";

const ID = "548e813c-8266-40c3-bd9c-ca1816f8";
const ENTRY = {
  id: ID,
  createdAt: "2026-11-15T09:00:00.000Z",
  updatedAt: "2026-11-16T10:30:00.000Z",
};
const API = documentApiAddress({ collectionSlug: "pages", entryId: ID });

function clipboard(writeText: (text: string) => Promise<void>) {
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    writable: true,
    value: { writeText },
  });
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("DetailsSection", () => {
  it("lists ID, API, Created and Updated, in that order", () => {
    render(
      <DetailsSection
        entry={ENTRY}
        apiAddress={API}
        createdBy={{ kind: "person", name: "Ana Ruiz" }}
        updatedBy={{ kind: "apiKey", name: null }}
      />
    );
    const terms = screen.getAllByRole("term").map(term => term.textContent);
    expect(terms).toEqual(["ID", "API", "Created", "Updated"]);
  });

  it('shows the API address "View API response" reads, with the id shortened', () => {
    render(<DetailsSection entry={ENTRY} apiAddress={API} />);
    expect(API).toBe(`/admin/api/collections/pages/entries/${ID}`);
    expect(
      screen.getByText("/admin/api/collections/pages/entries/548e8…6f8")
    ).toBeInTheDocument();
  });

  it("copies the whole ID", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    clipboard(writeText);
    render(<DetailsSection entry={ENTRY} apiAddress={API} />);
    await userEvent.click(
      screen.getByRole("button", { name: "Copy ID to clipboard" })
    );
    expect(writeText).toHaveBeenCalledWith(ID);
  });

  it("copies the whole API address, as a URL on this site", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    clipboard(writeText);
    render(<DetailsSection entry={ENTRY} apiAddress={API} />);
    await userEvent.click(
      screen.getByRole("button", { name: "Copy API address" })
    );
    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}${API}`);
  });

  it("names who made and changed it beside each date", () => {
    render(
      <DetailsSection
        entry={ENTRY}
        createdBy={{ kind: "person", name: "Ana Ruiz" }}
        updatedBy={{ kind: "person", name: null, gone: true }}
      />
    );
    expect(screen.getByText(/· Ana Ruiz$/)).toBeInTheDocument();
    expect(screen.getByText(/· a former user$/)).toBeInTheDocument();
  });

  it("dates Updated by the change its who made, where that is known", () => {
    render(
      <DetailsSection
        entry={ENTRY}
        updatedBy={{ kind: "person", name: "Ben" }}
        changedAt="2026-11-17T08:00:00.000Z"
      />
    );
    const updated = screen.getByText(/· Ben$/);
    expect(updated.textContent).toContain("2026");
    expect(updated.textContent).toContain("17");
    expect(updated.textContent).not.toContain("16,");
  });

  it("shows the date alone where who did it isn't recorded", () => {
    render(<DetailsSection entry={ENTRY} createdBy={null} />);
    for (const value of screen.getAllByRole("definition")) {
      expect(value.textContent).not.toContain("·");
    }
  });

  it("draws no API line where no address is given, as on a Single", () => {
    render(<DetailsSection entry={ENTRY} />);
    expect(screen.queryByRole("term", { name: "API" })).not.toBeInTheDocument();
    expect(screen.queryByText("API")).not.toBeInTheDocument();
  });
});
