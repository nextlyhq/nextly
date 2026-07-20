/**
 * A history row has to answer "which version, by whom, when" at a glance, and
 * must not offer to open something that cannot be opened.
 */
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";

import { render, screen } from "@admin/__tests__/utils";
import type { VersionMeta } from "@admin/services/versionApi";

import { VersionRow } from "../VersionRow";

function version(overrides: Partial<VersionMeta> = {}): VersionMeta {
  return {
    id: "v1",
    versionNo: 3,
    status: "published",
    isAutosave: false,
    label: null,
    locale: null,
    sourceVersionNo: null,
    createdBy: "u1",
    author: { id: "u1", name: "Ada Lovelace" },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("VersionRow", () => {
  it("shows the version number, status, and author", () => {
    render(<VersionRow version={version()} onSelect={vi.fn()} />);

    expect(screen.getByText("Version 3")).toBeInTheDocument();
    expect(screen.getByText("published")).toBeInTheDocument();
    expect(screen.getByText("Ada Lovelace")).toBeInTheDocument();
  });

  it("reports an unattributed version rather than leaving it blank", () => {
    // A system write records no author. Blank space would read as a failed
    // lookup rather than as nobody having signed the change.
    render(
      <VersionRow version={version({ author: null })} onSelect={vi.fn()} />
    );

    expect(screen.getByText("Unknown author")).toBeInTheDocument();
  });

  it("names the version in its accessible label", () => {
    render(<VersionRow version={version()} onSelect={vi.fn()} />);

    expect(
      screen.getByRole("button", { name: /Version 3, published, by Ada/ })
    ).toBeInTheDocument();
  });

  it("selects the version it displays", async () => {
    const onSelect = vi.fn();

    render(<VersionRow version={version()} onSelect={onSelect} />);
    await userEvent.click(screen.getByRole("button"));

    expect(onSelect).toHaveBeenCalledWith(3);
  });

  it("does not offer to open an autosave", () => {
    // An autosave carries no version number, so there is no address to fetch.
    render(
      <VersionRow
        version={version({ versionNo: null, isAutosave: true })}
        onSelect={vi.fn()}
      />
    );

    expect(screen.getByRole("button")).toBeDisabled();
    expect(screen.getByText("Autosave")).toBeInTheDocument();
  });

  it("carries the exact time as a title for the relative label", () => {
    // The relative label is scannable; the exact time is what distinguishes
    // two versions saved minutes apart.
    render(<VersionRow version={version()} onSelect={vi.fn()} />);

    const relative = screen.getByTitle(/\d/);
    expect(relative).toBeInTheDocument();
  });
});
