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

describe("VersionRow — names", () => {
  it("shows the editor's name for a version, keeping the number visible", () => {
    // Two versions can share a name, so the number stays as the thing that
    // actually identifies one.
    render(
      <VersionRow
        version={version({ label: "before redesign" })}
        onSelect={vi.fn()}
      />
    );

    expect(screen.getByText("before redesign")).toBeInTheDocument();
    expect(screen.getByText("Version 3")).toBeInTheDocument();
  });

  it("falls back to the number when a version has no name", () => {
    render(<VersionRow version={version()} onSelect={vi.fn()} />);

    expect(screen.getByText("Version 3")).toBeInTheDocument();
  });

  it("leads the accessible label with the name an editor chose", () => {
    render(
      <VersionRow
        version={version({ label: "before redesign" })}
        onSelect={vi.fn()}
      />
    );

    expect(
      screen.getByRole("button", { name: /^before redesign,/ })
    ).toBeInTheDocument();
  });

  it("offers renaming only when the caller can rename", () => {
    const { rerender } = render(
      <VersionRow version={version()} onSelect={vi.fn()} />
    );
    expect(
      screen.queryByRole("button", { name: /name version/i })
    ).not.toBeInTheDocument();

    rerender(
      <VersionRow version={version()} onSelect={vi.fn()} onRename={vi.fn()} />
    );
    expect(
      screen.getByRole("button", { name: /name version 3/i })
    ).toBeInTheDocument();
  });

  it("renames without opening the version", async () => {
    // The two controls sit side by side; clicking one must not trigger the
    // other, which is what nesting them would have caused.
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const onRename = vi.fn();
    render(
      <VersionRow version={version()} onSelect={onSelect} onRename={onRename} />
    );

    await user.click(screen.getByRole("button", { name: /name version 3/i }));

    expect(onRename).toHaveBeenCalledWith(3);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("does not offer to name an autosave", () => {
    // An autosave has no version number, so there is nothing to address.
    render(
      <VersionRow
        version={version({ versionNo: null, isAutosave: true })}
        onSelect={vi.fn()}
        onRename={vi.fn()}
      />
    );

    expect(
      screen.queryByRole("button", { name: /name version/i })
    ).not.toBeInTheDocument();
  });
});
