/**
 * Whether the setup form asks for the setup token, read from setup-status:
 * asked when the server says it is needed, and when the answer could not be
 * read, so the form never hides a field the server requires.
 */
import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useSetupTokenRequired } from "../useSetupTokenRequired";

// A plain implementation rather than a spy: a spy records each result it
// returns, and a rejected promise held there is reported as unhandled even
// once the hook has handled it.
const api = vi.hoisted(() => ({
  answer: (_path: string): Promise<unknown> => Promise.resolve(undefined),
  calls: [] as string[],
}));
vi.mock("@admin/lib/api/publicApi", () => ({
  publicApi: {
    get: (path: string) => {
      api.calls.push(path);
      return api.answer(path);
    },
  },
}));

beforeEach(() => {
  api.calls = [];
});

describe("the setup form's token field", () => {
  it("is asked for when the server says setup needs it", async () => {
    api.answer = () =>
      Promise.resolve({
        isSetup: false,
        requiresInitialUser: true,
        requiresSetupToken: true,
      });
    const { result } = renderHook(() => useSetupTokenRequired());
    await waitFor(() => expect(result.current).toBe(true));
    expect(api.calls).toEqual(["/auth/setup-status"]);
  });

  it("is not asked for when the server says setup does not need it", async () => {
    api.answer = () =>
      Promise.resolve({
        isSetup: false,
        requiresInitialUser: true,
        requiresSetupToken: false,
      });
    const { result } = renderHook(() => useSetupTokenRequired());
    await waitFor(() => expect(api.calls).toHaveLength(1));
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(result.current).toBe(false);
  });

  it("is asked for when setup-status cannot be read", async () => {
    api.answer = () => Promise.reject(new Error("network"));
    const { result } = renderHook(() => useSetupTokenRequired());
    await waitFor(() => expect(result.current).toBe(true));
  });
});
