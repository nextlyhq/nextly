/**
 * Naming a version. The cases worth pinning are the ones where the dialog has
 * to tell "clear the name" apart from "changed nothing" — they look identical
 * in an empty field and mean opposite things.
 */
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { render, screen } from "@admin/__tests__/utils";

import { VersionLabelDialog } from "../VersionLabelDialog";

const base = {
  open: true,
  onOpenChange: vi.fn(),
  versionNo: 3,
  currentLabel: null as string | null,
  onSubmit: vi.fn(),
};

describe("VersionLabelDialog", () => {
  it("offers to name a version that has no name", () => {
    render(<VersionLabelDialog {...base} onSubmit={vi.fn()} />);

    expect(
      screen.getByRole("heading", { name: /name version 3/i })
    ).toBeInTheDocument();
  });

  it("offers to rename one that already has a name", () => {
    render(
      <VersionLabelDialog
        {...base}
        currentLabel="before redesign"
        onSubmit={vi.fn()}
      />
    );

    expect(
      screen.getByRole("heading", { name: /rename version 3/i })
    ).toBeInTheDocument();
    expect(screen.getByRole("textbox")).toHaveValue("before redesign");
  });

  it("submits a trimmed name", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<VersionLabelDialog {...base} onSubmit={onSubmit} />);

    await user.type(screen.getByRole("textbox"), "  launch copy  ");
    await user.click(screen.getByRole("button", { name: /^save$/i }));

    expect(onSubmit).toHaveBeenCalledWith("launch copy");
  });

  it("submits null to clear an existing name", async () => {
    // The same empty field means "remove it" here and "nothing to do" below;
    // what separates them is whether there was a name to begin with.
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(
      <VersionLabelDialog {...base} currentLabel="old" onSubmit={onSubmit} />
    );

    await user.clear(screen.getByRole("textbox"));
    await user.click(screen.getByRole("button", { name: /remove name/i }));

    expect(onSubmit).toHaveBeenCalledWith(null);
  });

  it("cannot submit when nothing changed", () => {
    render(
      <VersionLabelDialog {...base} currentLabel="same" onSubmit={vi.fn()} />
    );

    expect(screen.getByRole("button", { name: /^save$/i })).toBeDisabled();
  });

  it("cannot submit an empty field on a version that has no name", () => {
    render(<VersionLabelDialog {...base} onSubmit={vi.fn()} />);

    expect(screen.getByRole("button", { name: /remove name/i })).toBeDisabled();
  });

  it("says what an empty field will do, before it is submitted", async () => {
    const user = userEvent.setup();
    render(
      <VersionLabelDialog {...base} currentLabel="old" onSubmit={vi.fn()} />
    );

    await user.clear(screen.getByRole("textbox"));

    expect(screen.getByText(/will remove the current name/i)).toBeVisible();
  });

  it("blocks a second submit while one is in flight", () => {
    render(
      <VersionLabelDialog
        {...base}
        currentLabel="old"
        saving
        onSubmit={vi.fn()}
      />
    );

    expect(screen.getByRole("button", { name: /saving/i })).toBeDisabled();
  });

  it("keeps what the user typed when the list refetches underneath", async () => {
    // Renaming invalidates the history list, so `currentLabel` can change while
    // the dialog is open. Resyncing from it would wipe a draft mid-edit, or
    // swap in someone else's rename and let this user submit that instead.
    const user = userEvent.setup();
    const { rerender } = render(
      <VersionLabelDialog {...base} currentLabel="first" onSubmit={vi.fn()} />
    );

    await user.clear(screen.getByRole("textbox"));
    await user.type(screen.getByRole("textbox"), "my draft");

    rerender(
      <VersionLabelDialog
        {...base}
        currentLabel="changed elsewhere"
        onSubmit={vi.fn()}
      />
    );

    expect(screen.getByRole("textbox")).toHaveValue("my draft");
  });

  it("seeds from the version it was mounted for", () => {
    // Opening a different version mounts a fresh dialog rather than resyncing
    // this one, so there is no stale draft to carry across.
    const { unmount } = render(
      <VersionLabelDialog {...base} currentLabel="first" onSubmit={vi.fn()} />
    );
    expect(screen.getByRole("textbox")).toHaveValue("first");
    unmount();

    render(
      <VersionLabelDialog
        {...base}
        versionNo={4}
        currentLabel="second"
        onSubmit={vi.fn()}
      />
    );

    expect(screen.getByRole("textbox")).toHaveValue("second");
  });
});

describe("VersionLabelDialog — a rename landing underneath", () => {
  it("does not turn an untouched field into a submittable change", async () => {
    // A refetch can report someone else's rename while this dialog is open.
    // Comparing against the live prop would enable Save on a value this user
    // never typed, and submitting it would overwrite the newer name.
    const { rerender } = render(
      <VersionLabelDialog {...base} currentLabel="mine" onSubmit={vi.fn()} />
    );
    expect(screen.getByRole("button", { name: /^save$/i })).toBeDisabled();

    rerender(
      <VersionLabelDialog
        {...base}
        currentLabel="someone else's"
        onSubmit={vi.fn()}
      />
    );

    expect(screen.getByRole("button", { name: /^save$/i })).toBeDisabled();
  });

  it("still judges an edit against the name it was opened with", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(
      <VersionLabelDialog {...base} currentLabel="mine" onSubmit={onSubmit} />
    );

    await user.clear(screen.getByRole("textbox"));
    await user.type(screen.getByRole("textbox"), "my new name");
    await user.click(screen.getByRole("button", { name: /^save$/i }));

    expect(onSubmit).toHaveBeenCalledWith("my new name");
  });
});
