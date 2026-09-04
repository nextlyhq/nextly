/**
 * A save whose follow-up failed must not look like a clean save.
 *
 * The row is durable either way, so the outcome is never an error: reporting
 * one would have the user repeat a write that already took effect. What changes
 * is that the toast says so, and says how many.
 */

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";

const { successSpy, warningSpy, infoSpy } = vi.hoisted(() => ({
  successSpy: vi.fn(),
  warningSpy: vi.fn(),
  infoSpy: vi.fn(),
}));

vi.mock("@admin/components/ui", () => ({
  toast: {
    success: successSpy,
    warning: warningSpy,
    info: infoSpy,
    error: vi.fn(),
  },
}));

import { toastMutationResult, type HookWarning } from "../mutation-warnings";

function warning(overrides: Partial<HookWarning> = {}): HookWarning {
  return {
    severity: "failure",
    phase: "afterUpdate",
    collection: "posts",
    code: "INTERNAL_ERROR",
    message: "The search index could not be updated.",
    ...overrides,
  };
}

/** An advisory: the write did exactly what was asked, and there is a caveat. */
function notice(overrides: Partial<HookWarning> = {}): HookWarning {
  return warning({
    severity: "notice",
    code: "COMPONENTS_NOT_PUBLISHED",
    message: "This page embeds 1 component that is not published.",
    ...overrides,
  });
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

describe("an advisory that is not a failure", () => {
  it("does not borrow the failure headline", () => {
    // The write did exactly what was asked. Phrasing it as "..., but 1
    // follow-up action failed" would send an author looking for a problem with
    // a save that had none.
    toastMutationResult("Entry updated successfully", [notice()]);

    expect(warningSpy).not.toHaveBeenCalled();
    expect(infoSpy).toHaveBeenCalledTimes(1);
    expect(infoSpy.mock.calls[0]?.[0]).toBe("Entry updated successfully");
  });

  it("is not reported as a plain clean save either", () => {
    // The other direction, and the one that loses the message entirely: a
    // success toast with no description is what this looked like before, which
    // is the state the notice exists to end.
    toastMutationResult("Entry updated successfully", [notice()]);

    expect(successSpy).not.toHaveBeenCalled();
    expect(infoSpy.mock.calls[0]?.[1]).toMatchObject({ duration: 10_000 });
  });

  it("shows the advisory text", () => {
    toastMutationResult("Entry updated successfully", [notice()]);

    const options = infoSpy.mock.calls[0]?.[1] as {
      description: React.ReactElement;
    };
    render(options.description);

    expect(
      screen.getByText("This page embeds 1 component that is not published.")
    ).toBeInTheDocument();
  });

  it("lets a real failure own the headline, keeping the advisory beside it", () => {
    // A failure is the thing that did NOT happen and is what the user has to
    // decide about, so it leads. Dropping the advisory instead would
    // misdescribe a write that produced both.
    toastMutationResult("Entry updated successfully", [notice(), warning()]);

    expect(infoSpy).not.toHaveBeenCalled();
    expect(warningSpy).toHaveBeenCalledTimes(1);
    expect(warningSpy.mock.calls[0]?.[0]).toContain("1 follow-up action");

    const options = warningSpy.mock.calls[0]?.[1] as {
      description: React.ReactElement;
    };
    render(options.description);
    expect(
      screen.getByText("This page embeds 1 component that is not published.")
    ).toBeInTheDocument();
  });

  it("counts only the failures in the headline", () => {
    // Two advisories and one failure is "1 failed", not "3". Counting the whole
    // array was the shape before severities existed.
    toastMutationResult("Entry updated successfully", [
      notice(),
      notice({ message: "Another advisory." }),
      warning(),
    ]);

    expect(warningSpy.mock.calls[0]?.[0]).toContain("1 follow-up action");
  });

  it("treats a warning WITHOUT an explicit severity as a failure", () => {
    // The safe default in the only direction that matters: a server that stops
    // sending the field must not have its failures quietly downgraded into
    // reassuring language.
    const legacy = { ...warning() } as Partial<HookWarning>;
    delete legacy.severity;

    toastMutationResult("Entry updated successfully", [legacy as HookWarning]);

    expect(warningSpy).toHaveBeenCalledTimes(1);
    expect(infoSpy).not.toHaveBeenCalled();
  });
});

describe("telling several notices apart", () => {
  it("names the row each warning is about", () => {
    // A bulk write produces one of these per entry. Several identically-worded
    // notices tell an author that something needs attention without telling
    // them WHICH page, which is the same as not telling them. The server sends
    // `entryId` for exactly this, and it discloses nothing new: the caller
    // either supplied the id or is being handed it back in the same response.
    toastMutationResult("Updated 2 entries", [
      notice({ entryId: "page-a" }),
      notice({ entryId: "page-b" }),
    ]);

    const options = infoSpy.mock.calls[0]?.[1] as {
      description: React.ReactElement;
    };
    render(options.description);

    expect(screen.getByText(/page-a/)).toBeInTheDocument();
    expect(screen.getByText(/page-b/)).toBeInTheDocument();
  });

  it("renders a warning that carries no row id without an empty marker", () => {
    // The control: not every phase knows an id, and a bare "()" beside the
    // message would read as a missing value rather than an absent question.
    toastMutationResult("Entry updated successfully", [
      notice(),
      notice({ message: "Another advisory." }),
    ]);

    const options = infoSpy.mock.calls[0]?.[1] as {
      description: React.ReactElement;
    };
    const { container } = render(options.description);

    expect(container.textContent).not.toContain("()");
  });
});
