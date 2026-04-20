import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";

import { render, screen } from "@admin/__tests__/utils";

import { AvatarUploader } from "./index";

// MediaPickerDialog is heavy (Tabs, queries, dropzone). Mock it so these are
// real unit tests of AvatarUploader's contract, not integration tests of the dialog.
vi.mock("@admin/components/features/media-library/MediaPickerDialog", () => ({
  MediaPickerDialog: ({
    open,
    onSelect,
    onOpenChange,
  }: {
    open: boolean;
    onSelect: (media: Array<{ id: string; url: string }>) => void;
    onOpenChange: (open: boolean) => void;
  }) =>
    open ? (
      <div data-testid="mock-media-picker">
        <button
          data-testid="mock-picker-confirm"
          onClick={() =>
            onSelect([{ id: "m1", url: "https://cdn.example.com/a.png" }])
          }
        >
          confirm
        </button>
        <button
          data-testid="mock-picker-close"
          onClick={() => onOpenChange(false)}
        >
          close
        </button>
      </div>
    ) : null,
}));

describe("AvatarUploader", () => {
  const user = userEvent.setup();

  it("shows the initial-letter fallback when value is empty", () => {
    render(<AvatarUploader value="" onChange={vi.fn()} fullName="Jane Doe" />);
    expect(screen.getByText("J")).toBeInTheDocument();
  });

  it("renders the pencil (change avatar) button", () => {
    render(<AvatarUploader value="" onChange={vi.fn()} fullName="Jane Doe" />);
    expect(
      screen.getByRole("button", { name: /change avatar/i })
    ).toBeInTheDocument();
  });

  it("does NOT render the remove button when value is empty", () => {
    render(<AvatarUploader value="" onChange={vi.fn()} fullName="Jane Doe" />);
    expect(
      screen.queryByRole("button", { name: /remove avatar/i })
    ).not.toBeInTheDocument();
  });

  it("renders the remove button when value is set", () => {
    render(
      <AvatarUploader
        value="https://cdn.example.com/x.png"
        onChange={vi.fn()}
        fullName="Jane Doe"
      />
    );
    expect(
      screen.getByRole("button", { name: /remove avatar/i })
    ).toBeInTheDocument();
  });

  it("opens the media picker when the pencil button is clicked", async () => {
    render(<AvatarUploader value="" onChange={vi.fn()} fullName="Jane Doe" />);
    expect(screen.queryByTestId("mock-media-picker")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /change avatar/i }));
    expect(screen.getByTestId("mock-media-picker")).toBeInTheDocument();
  });

  it("calls onChange with the picked media URL and closes the picker", async () => {
    const onChange = vi.fn();
    render(<AvatarUploader value="" onChange={onChange} fullName="Jane Doe" />);
    await user.click(screen.getByRole("button", { name: /change avatar/i }));
    await user.click(screen.getByTestId("mock-picker-confirm"));
    expect(onChange).toHaveBeenCalledWith("https://cdn.example.com/a.png");
    expect(screen.queryByTestId("mock-media-picker")).not.toBeInTheDocument();
  });

  it("calls onChange with an empty string when remove is clicked", async () => {
    const onChange = vi.fn();
    render(
      <AvatarUploader
        value="https://cdn.example.com/x.png"
        onChange={onChange}
        fullName="Jane Doe"
      />
    );
    await user.click(screen.getByRole("button", { name: /remove avatar/i }));
    expect(onChange).toHaveBeenCalledWith("");
  });

  it("disables both buttons when disabled prop is true", () => {
    render(
      <AvatarUploader
        value="https://cdn.example.com/x.png"
        onChange={vi.fn()}
        fullName="Jane Doe"
        disabled
      />
    );
    expect(
      screen.getByRole("button", { name: /change avatar/i })
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: /remove avatar/i })
    ).toBeDisabled();
  });
});
