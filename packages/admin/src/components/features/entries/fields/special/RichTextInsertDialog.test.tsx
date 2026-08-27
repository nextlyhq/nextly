import { render, screen, fireEvent } from "@testing-library/react";
import { renderHook, act } from "@testing-library/react";
import type React from "react";
import { describe, it, expect, vi } from "vitest";

import {
  useInsertDialogState,
  InsertDialogFooter,
  ButtonAlignmentControl,
  type ButtonAlignment,
} from "./RichTextInsertDialog";

describe("useInsertDialogState", () => {
  it("initializes closed and toggles open with state reset", () => {
    const resetState = vi.fn();
    const onSubmit = vi.fn();

    const { result } = renderHook(() =>
      useInsertDialogState({ resetState, onSubmit })
    );

    expect(result.current.isOpen).toBe(false);

    act(() => {
      result.current.openDialog();
    });

    expect(result.current.isOpen).toBe(true);
    expect(resetState).toHaveBeenCalledTimes(1);

    act(() => {
      result.current.handleOpenChange(false);
    });

    expect(result.current.isOpen).toBe(false);
    expect(resetState).toHaveBeenCalledTimes(2);
  });

  it("does not open when disabled", () => {
    const resetState = vi.fn();
    const onSubmit = vi.fn();

    const { result } = renderHook(() =>
      useInsertDialogState({ resetState, onSubmit, disabled: true })
    );

    act(() => {
      result.current.openDialog();
    });

    expect(result.current.isOpen).toBe(false);
    expect(resetState).not.toHaveBeenCalled();
  });

  it("submits on Enter from a text input, and ignores shift+Enter, other keys, and Enter from non-text controls", () => {
    const resetState = vi.fn();
    const onSubmit = vi.fn();

    const { result } = renderHook(() =>
      useInsertDialogState({ resetState, onSubmit })
    );

    const textInput = document.createElement("input");
    const button = document.createElement("button");

    // Regular Enter from a text input -> submits
    const preventDefault1 = vi.fn();
    act(() => {
      result.current.handleKeyDown({
        key: "Enter",
        shiftKey: false,
        target: textInput,
        preventDefault: preventDefault1,
      } as unknown as React.KeyboardEvent);
    });
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(preventDefault1).toHaveBeenCalledTimes(1);

    // Shift + Enter -> does not submit
    const preventDefault2 = vi.fn();
    act(() => {
      result.current.handleKeyDown({
        key: "Enter",
        shiftKey: true,
        target: textInput,
        preventDefault: preventDefault2,
      } as unknown as React.KeyboardEvent);
    });
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(preventDefault2).not.toHaveBeenCalled();

    // Escape -> does not submit
    const preventDefault3 = vi.fn();
    act(() => {
      result.current.handleKeyDown({
        key: "Escape",
        shiftKey: false,
        target: textInput,
        preventDefault: preventDefault3,
      } as unknown as React.KeyboardEvent);
    });
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(preventDefault3).not.toHaveBeenCalled();

    // Enter from a focused button (Cancel, alignment, Select option) must
    // activate that control, not submit the dialog
    const preventDefault4 = vi.fn();
    act(() => {
      result.current.handleKeyDown({
        key: "Enter",
        shiftKey: false,
        target: button,
        preventDefault: preventDefault4,
      } as unknown as React.KeyboardEvent);
    });
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(preventDefault4).not.toHaveBeenCalled();
  });
});

describe("InsertDialogFooter", () => {
  it("renders buttons and triggers callbacks", () => {
    const onCancel = vi.fn();
    const onConfirm = vi.fn();

    render(
      <InsertDialogFooter
        onCancel={onCancel}
        onConfirm={onConfirm}
        confirmLabel="Embed Video"
      />
    );

    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
    const confirmBtn = screen.getByRole("button", { name: "Embed Video" });
    expect(confirmBtn).toBeInTheDocument();
    expect(confirmBtn).toBeEnabled();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(1);

    fireEvent.click(confirmBtn);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("displays error message and supports disabled confirm button", () => {
    render(
      <InsertDialogFooter
        error="Invalid URL"
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
        confirmLabel="Insert Table"
        confirmDisabled={true}
        cancelLabel="Dismiss"
      />
    );

    expect(screen.getByText("Invalid URL")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Dismiss" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Insert Table" })).toBeDisabled();
  });
});

describe("ButtonAlignmentControl", () => {
  it("renders alignment options and switches selection", () => {
    const onChange = vi.fn();
    let alignment: ButtonAlignment = "center";

    const { rerender } = render(
      <ButtonAlignmentControl
        value={alignment}
        onChange={val => {
          alignment = val;
          onChange(val);
        }}
        label="Alignment"
      />
    );

    expect(screen.getByText("Alignment")).toBeInTheDocument();
    const leftBtn = screen.getByRole("button", { name: /left/i });
    const centerBtn = screen.getByRole("button", { name: /center/i });
    const rightBtn = screen.getByRole("button", { name: /right/i });

    expect(leftBtn).toBeInTheDocument();
    expect(centerBtn).toBeInTheDocument();
    expect(rightBtn).toBeInTheDocument();

    fireEvent.click(leftBtn);
    expect(onChange).toHaveBeenCalledWith("left");

    rerender(
      <ButtonAlignmentControl
        value="left"
        onChange={onChange}
        disabled={true}
      />
    );

    expect(screen.getByRole("button", { name: /left/i })).toBeDisabled();
  });
});
