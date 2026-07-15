/**
 * Turning a failed request into something worth reading.
 *
 * A validation failure's top-level message is "Validation failed." — true, and
 * useless. The reasons are per-field in `data.errors`, so showing the message
 * alone tells someone their form was rejected without saying by what.
 */
import { describe, expect, it } from "vitest";

import { apiErrorMessage, parseApiError } from "./parseApiError";

const validationBody = (
  errors: Array<{ path?: string; code?: string; message?: string }>
) => ({
  error: {
    code: "VALIDATION_ERROR",
    message: "Validation failed.",
    requestId: "req_x",
    data: { errors },
  },
});

describe("parseApiError", () => {
  it("reads the canonical shape", () => {
    const err = parseApiError(
      { error: { code: "NOT_FOUND", message: "Not found.", requestId: "r1" } },
      404
    );

    expect(err.message).toBe("Not found.");
    expect(err.code).toBe("NOT_FOUND");
    expect(err.status).toBe(404);
    expect(err.requestId).toBe("r1");
  });

  it("keeps the validation payload", () => {
    const err = parseApiError(
      validationBody([{ path: "name", code: "REQUIRED", message: "Need it." }]),
      400
    );

    expect(err.data?.errors).toHaveLength(1);
  });

  it("falls through when the shape is not canonical", () => {
    const err = parseApiError({ oops: true }, 500);

    expect(err.code).toBe("UNKNOWN");
  });
});

describe("apiErrorMessage", () => {
  it("says why, not that", () => {
    const err = parseApiError(
      validationBody([
        {
          path: "permissionIds",
          code: "REQUIRED",
          message: "At least one permission is required to create a role.",
        },
      ]),
      400
    );

    expect(apiErrorMessage(err)).toBe(
      "At least one permission is required to create a role."
    );
    expect(apiErrorMessage(err)).not.toBe("Validation failed.");
  });

  it("gives every reason when a form fails more than one", () => {
    const err = parseApiError(
      validationBody([
        { path: "name", code: "REQUIRED", message: "A role needs a name." },
        { path: "slug", code: "REQUIRED", message: "A role needs a slug." },
      ]),
      400
    );

    expect(apiErrorMessage(err)).toBe(
      "A role needs a name. A role needs a slug."
    );
  });

  it("uses the top-level message when there are no field errors", () => {
    const err = parseApiError(
      { error: { code: "FORBIDDEN", message: "Not allowed.", requestId: "r" } },
      403
    );

    expect(apiErrorMessage(err)).toBe("Not allowed.");
  });

  // A malformed payload should not produce "undefined" on screen.
  it("ignores field errors that carry no message", () => {
    const err = parseApiError(validationBody([{ path: "name" }]), 400);

    expect(apiErrorMessage(err)).toBe("Validation failed.");
  });

  it("survives being handed something that is not an error", () => {
    expect(apiErrorMessage("boom")).toBe("An error occurred");
    expect(apiErrorMessage(undefined)).toBe("An error occurred");
  });
});
