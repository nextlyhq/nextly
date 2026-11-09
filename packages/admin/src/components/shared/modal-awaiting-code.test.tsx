import { act, fireEvent, render, screen } from "@testing-library/react";
import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ModalAwaitingCode, useHasOpened } from "./modal-awaiting-code";

describe("ModalAwaitingCode", () => {
  it("answers an opening at once, in the loading state", () => {
    render(
      <ModalAwaitingCode open onOpenChange={() => undefined} failure={null} />
    );
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByText("Loading…")).toBeTruthy();
  });

  it("says a failed fetch in the dialog and offers it again", () => {
    const onRetry = vi.fn();
    render(
      <ModalAwaitingCode
        open
        onOpenChange={() => undefined}
        failure={{ exhausted: false, onRetry }}
      />
    );
    expect(screen.getByRole("alert").textContent).toContain(
      "could not be loaded"
    );
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("offers a reload once a retry has failed too", () => {
    render(
      <ModalAwaitingCode
        open
        onOpenChange={() => undefined}
        failure={{ exhausted: true, onRetry: () => undefined }}
      />
    );
    expect(
      screen.getByRole("button", { name: "Reload the page" })
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
  });
});

describe("useHasOpened", () => {
  it("is false until first opened, and stays true after closing", () => {
    const { result, rerender } = renderHook(
      ({ open }: { open: boolean }) => useHasOpened(open),
      { initialProps: { open: false } }
    );
    expect(result.current).toBe(false);
    act(() => rerender({ open: true }));
    expect(result.current).toBe(true);
    act(() => rerender({ open: false }));
    expect(result.current).toBe(true);
  });
});
