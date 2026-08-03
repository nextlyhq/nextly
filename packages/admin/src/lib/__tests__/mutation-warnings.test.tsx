/**
 * A save whose follow-up failed must not look like a clean save.
 *
 * The row is durable either way, so the outcome is never an error: reporting
 * one would have the user repeat a write that already took effect. What changes
 * is that the toast says so, and says how many.
 */

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";

const { successSpy, warningSpy } = vi.hoisted(() => ({
  successSpy: vi.fn(),
  warningSpy: vi.fn(),
}));

vi.mock("@admin/components/ui", () => ({
  toast: { success: successSpy, warning: warningSpy, error: vi.fn() },
}));

import { toastMutationResult, type HookWarning } from "../mutation-warnings";

function warning(overrides: Partial<HookWarning> = {}): HookWarning {
  return {
    phase: "afterUpdate",
    collection: "posts",
    code: "INTERNAL_ERROR",
    message: "The search index could not be updated.",
    ...overrides,
  };
}

beforeEach(() => vi.clearAllMocks());

describe("toastMutationResult", () => {
  it("reports a clean save as a success", () => {
    toastMutationResult("Entry updated successfully", undefined);

    expect(successSpy).toHaveBeenCalledWith("Entry updated successfully");
    expect(warningSpy).not.toHaveBeenCalled();
  });

  it("treats an empty array as clean", () => {
    // The server omits `warnings` when there are none, but a caller normalising
    // the envelope may hand over `[]`. Those are the same outcome and must not
    // read as "0 follow-up actions failed".
    toastMutationResult("Entry updated successfully", []);

    expect(successSpy).toHaveBeenCalledOnce();
    expect(warningSpy).not.toHaveBeenCalled();
  });

  it("still reports the write as succeeded when a follow-up failed", () => {
    toastMutationResult("Entry updated successfully", [warning()]);

    // Not an error toast. The row IS saved, and saying otherwise invites the
    // user to save again.
    expect(successSpy).not.toHaveBeenCalled();
    expect(warningSpy).toHaveBeenCalledOnce();
    expect(warningSpy.mock.calls[0]?.[0]).toBe(
      "Entry updated successfully, but 1 follow-up action failed"
    );
  });

  it("counts the failures and pluralises", () => {
    toastMutationResult("Entry updated successfully", [
      warning(),
      warning({ code: "EXTERNAL_SERVICE_ERROR" }),
      warning({ phase: "afterCreate" }),
    ]);

    expect(warningSpy.mock.calls[0]?.[0]).toBe(
      "Entry updated successfully, but 3 follow-up actions failed"
    );
  });

  it("names the single failure without asking for a click", () => {
    // A disclosure hiding one line costs an interaction and reveals nothing
    // the headline could not have carried.
    toastMutationResult("Entry created successfully", [
      warning({ message: "The webhook could not be delivered." }),
    ]);

    const { description } = warningSpy.mock.calls[0]?.[1] as {
      description: React.ReactElement;
    };
    render(description);

    expect(
      screen.getByText("The webhook could not be delivered.")
    ).toBeInTheDocument();
    expect(screen.queryByText("View details")).not.toBeInTheDocument();
  });

  it("lists every failure behind the disclosure", () => {
    toastMutationResult("Entry updated successfully", [
      warning({ message: "The search index could not be updated." }),
      warning({ message: "The webhook could not be delivered." }),
    ]);

    const { description } = warningSpy.mock.calls[0]?.[1] as {
      description: React.ReactElement;
    };
    render(description);

    expect(screen.getByText("View details")).toBeInTheDocument();
    // Present in the DOM even while collapsed, which is what makes the content
    // reachable by find-in-page and announced on expand rather than fetched.
    expect(
      screen.getByText("The search index could not be updated.")
    ).toBeInTheDocument();
    expect(
      screen.getByText("The webhook could not be delivered.")
    ).toBeInTheDocument();
  });

  it("stays on screen long enough to be read", () => {
    // This is the only place the failure is reported: it is not on the row, and
    // the write has already committed. A default-duration toast that vanishes
    // before the detail is open is the same as no warning at all.
    toastMutationResult("Entry updated successfully", [warning(), warning()]);

    const options = warningSpy.mock.calls[0]?.[1] as { duration: number };
    expect(options.duration).toBeGreaterThanOrEqual(10_000);
  });
});
