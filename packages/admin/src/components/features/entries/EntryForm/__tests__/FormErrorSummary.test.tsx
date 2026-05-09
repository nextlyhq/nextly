/**
 * FormErrorSummary submitCount gate test.
 *
 * Locks the contract that the top-level "Please fix the following errors"
 * toast only appears once the form has been submitted at least once
 * (`submitCount > 0`). Field-level inline errors are rendered next to
 * each input by FieldWrapper independently and aren't affected by this
 * gate.
 */
import { toast } from "@nextlyhq/ui";
import { describe, it, expect, vi, beforeEach } from "vitest";

import { render } from "@admin/__tests__/utils";

import { FormErrorSummary } from "../FormErrorSummary";

vi.mock("@nextlyhq/ui", async orig => {
  // Why: real `@nextlyhq/ui` exposes Sonner under the hood, which
  // mounts a portal we don't need for this test. We just want to
  // assert which toast.* methods were called.
  const actual = await orig<typeof import("@nextlyhq/ui")>();
  return {
    ...actual,
    toast: {
      error: vi.fn(),
      dismiss: vi.fn(),
    },
  };
});

describe("FormErrorSummary — submitCount gate", () => {
  beforeEach(() => {
    vi.mocked(toast.error).mockClear();
    vi.mocked(toast.dismiss).mockClear();
  });

  it("does NOT fire toast when there are errors but submitCount === 0", () => {
    render(
      <FormErrorSummary
        errors={{
          title: { type: "required", message: "Title is required" },
        }}
        submitCount={0}
      />
    );

    // The whole point: blur-time validation populates `errors`, but the
    // user hasn't tried to submit, so no aggregate toast.
    expect(toast.error).not.toHaveBeenCalled();
    // Effect's empty/no-submit branches both call dismiss to clear any
    // stale toast — that's fine and orthogonal to the user-facing rule.
    expect(toast.dismiss).toHaveBeenCalledWith("form-errors");
  });

  it("fires toast when errors exist AND submitCount > 0", () => {
    render(
      <FormErrorSummary
        errors={{
          title: { type: "required", message: "Title is required" },
        }}
        submitCount={1}
      />
    );

    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(toast.error).toHaveBeenCalledWith(
      "Please fix the following errors",
      expect.objectContaining({ id: "form-errors" })
    );
  });

  it("dismisses the toast when errors clear after a submit attempt", () => {
    // Errors gone but the form was submitted at least once. We still
    // dismiss to clear any pre-existing toast — never re-fire.
    render(<FormErrorSummary errors={{}} submitCount={1} />);

    expect(toast.error).not.toHaveBeenCalled();
    expect(toast.dismiss).toHaveBeenCalledWith("form-errors");
  });

  it("defaults submitCount to 0 (callers without the prop suppress toast)", () => {
    render(
      <FormErrorSummary
        errors={{
          title: { type: "required", message: "Title is required" },
        }}
      />
    );

    // The default keeps legacy callers (if any) on the new safe path.
    expect(toast.error).not.toHaveBeenCalled();
  });
});
