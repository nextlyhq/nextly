/**
 * The server-error tally the diagnostics report counts: errors within the last
 * 24 hours, each request once however many boundaries report it, and a bounded
 * count reported as a floor once it overflows.
 */

import { afterEach, describe, expect, it } from "vitest";

import {
  forgetServerErrors,
  recordServerError,
  SERVER_ERRORS_KEPT,
  serverErrorsInLastDay,
} from "../server-errors";

const HOUR = 60 * 60 * 1000;
const T0 = Date.parse("2026-11-10T12:00:00.000Z");

afterEach(() => forgetServerErrors());

describe("server errors in the last day", () => {
  it("counts the errors inside the window and drops those older", () => {
    recordServerError(undefined, T0);
    recordServerError(undefined, T0 + 2 * HOUR);
    recordServerError(undefined, T0 + 20 * HOUR);
    expect(serverErrorsInLastDay(T0 + 20 * HOUR)).toEqual({
      count: 3,
      capped: false,
    });
    // A day after the first, it has left the window.
    expect(serverErrorsInLastDay(T0 + 24 * HOUR + 1)).toEqual({
      count: 2,
      capped: false,
    });
    expect(serverErrorsInLastDay(T0 + 45 * HOUR)).toEqual({
      count: 0,
      capped: false,
    });
  });

  it("counts one request once, however many boundaries record it", () => {
    const request = new Request("http://localhost/api/collections/posts");
    recordServerError(request, T0);
    recordServerError(request, T0);
    recordServerError(new Request("http://localhost/api/media"), T0);
    expect(serverErrorsInLastDay(T0).count).toBe(2);
  });

  it("keeps a bounded number, and says the count is a floor past it", () => {
    for (let i = 0; i <= SERVER_ERRORS_KEPT; i += 1) {
      recordServerError(undefined, T0 + i);
    }
    expect(serverErrorsInLastDay(T0 + SERVER_ERRORS_KEPT)).toEqual({
      count: SERVER_ERRORS_KEPT,
      capped: true,
    });
    // Once the dropped errors are older than a day, the count is whole again.
    expect(serverErrorsInLastDay(T0 + 24 * HOUR + 2)).toEqual({
      count: SERVER_ERRORS_KEPT - 1,
      capped: false,
    });
  });
});
