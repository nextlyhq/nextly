/**
 * The address is checked by the server's own rule as it is typed: a pause in
 * typing asks once, an answer for an address no longer typed is dropped, and a
 * refusal is said in the server's words, the address already used in plain ones
 * that name no other entity.
 */
import { act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { renderHook } from "@admin/__tests__/utils";
import type { AddressCheckAnswer } from "@admin/services/addressCheckApi";

const check = vi.fn();
vi.mock("@admin/services/addressCheckApi", () => ({
  addressCheckApi: { check: (...args: unknown[]) => check(...args) },
}));

import type { BuilderKind } from "../../builder-config";
import { useAddressCheck } from "../useAddressCheck";

const answer = (
  address: string,
  refusal: AddressCheckAnswer["refusal"] = null
): AddressCheckAnswer => ({ kind: "collection", address, refusal });

function setup(kind: BuilderKind, address: string) {
  return renderHook(
    (props: { address: string }) => useAddressCheck(kind, props.address),
    { initialProps: { address } }
  );
}

/** Lets the pause in typing pass and the answer arrive. */
async function settle() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(500);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  check.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useAddressCheck", () => {
  it("is checking until the pause in typing passes and the server answers", async () => {
    check.mockResolvedValue(answer("posts"));
    const { result } = setup("collection", "posts");
    expect(result.current.status).toBe("checking");
    await settle();
    expect(result.current).toEqual({ status: "free" });
  });

  it("asks once after a pause, for the address last typed", async () => {
    check.mockImplementation(async (_kind: string, address: string) =>
      answer(address)
    );
    const { rerender } = setup("collection", "p");
    rerender({ address: "po" });
    rerender({ address: "posts" });
    await settle();
    expect(check).toHaveBeenCalledTimes(1);
    expect(check).toHaveBeenCalledWith("collection", "posts", []);
  });

  it("says the server's refusal for the address typed", async () => {
    check.mockResolvedValue(
      answer("1posts", {
        code: "SLUG_INVALID_FORMAT",
        message:
          "Collection address '1posts' must start with a lowercase letter",
      })
    );
    const { result } = setup("collection", "1posts");
    await settle();
    expect(result.current).toEqual({
      status: "refused",
      message: "Collection address '1posts' must start with a lowercase letter",
    });
  });

  it("says an address already used in plain words, naming no other entity", async () => {
    check.mockResolvedValue(
      answer("posts", {
        code: "DUPLICATE",
        message: "Resource already exists.",
      })
    );
    const { result } = setup("collection", "posts");
    await settle();
    expect(result.current).toEqual({
      status: "refused",
      message: "A collection or Single already uses this address.",
    });
  });

  it("asks a field group's address of the field-group check", async () => {
    check.mockResolvedValue(answer("seo"));
    setup("field-group", "seo");
    await settle();
    expect(check).toHaveBeenCalledWith("fieldGroup", "seo", []);
  });

  it("drops an answer for an address no longer typed", async () => {
    let answerOld: (value: AddressCheckAnswer) => void = () => {};
    check
      .mockImplementationOnce(
        () =>
          new Promise<AddressCheckAnswer>(resolve => {
            answerOld = resolve;
          })
      )
      .mockResolvedValueOnce(answer("articles"));
    const { result, rerender } = setup("collection", "posts");
    await settle();
    rerender({ address: "articles" });
    await settle();
    expect(result.current).toEqual({ status: "free" });

    // The slow answer about "posts" arrives last, and says nothing about "articles".
    await act(async () => {
      answerOld(
        answer("posts", {
          code: "DUPLICATE",
          message: "Resource already exists.",
        })
      );
    });
    expect(result.current).toEqual({ status: "free" });
  });

  it("leaves the address to the create when the check cannot be asked", async () => {
    check.mockRejectedValue(new Error("network down"));
    const { result } = setup("collection", "posts");
    await settle();
    expect(result.current).toEqual({
      status: "unknown",
      message: "This address could not be checked. Create checks it again.",
    });
  });

  it("is checking again on returning to an address, until its new answer arrives", async () => {
    check.mockImplementation(async (_kind: string, address: string) =>
      answer(address)
    );
    const { result, rerender } = setup("collection", "posts");
    await settle();
    expect(result.current).toEqual({ status: "free" });

    let answerB: (value: AddressCheckAnswer) => void = () => {};
    check.mockImplementationOnce(
      () =>
        new Promise<AddressCheckAnswer>(resolve => {
          answerB = resolve;
        })
    );
    rerender({ address: "articles" });
    await settle();
    let answerA: (value: AddressCheckAnswer) => void = () => {};
    check.mockImplementationOnce(
      () =>
        new Promise<AddressCheckAnswer>(resolve => {
          answerA = resolve;
        })
    );
    rerender({ address: "posts" });
    // The earlier "free" for "posts" says nothing about it now.
    expect(result.current.status).toBe("checking");
    await settle();
    expect(result.current.status).toBe("checking");
    await act(async () => {
      answerB(answer("articles"));
    });
    expect(result.current.status).toBe("checking");
    await act(async () => {
      answerA(
        answer("posts", {
          code: "DUPLICATE",
          message: "Resource already exists.",
        })
      );
    });
    expect(result.current).toEqual({
      status: "refused",
      message: "A collection or Single already uses this address.",
    });
  });

  it("leaves the address to the create when the check does not answer in time", async () => {
    check.mockImplementation(() => new Promise<AddressCheckAnswer>(() => {}));
    const { result } = setup("collection", "posts");
    await settle();
    expect(result.current.status).toBe("checking");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(result.current).toEqual({
      status: "unknown",
      message: "This address could not be checked. Create checks it again.",
    });
  });
});
