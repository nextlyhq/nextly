/**
 * What the test data holds as records are chosen and fields drawn: one
 * record's values at a time, the server's latest say on who may read records,
 * a record kept to the template it was asked for, and fields that show a value
 * as it is or say they can't.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import type React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { parseApiError } from "@admin/lib/api/parseApiError";

import { DataFields } from "../DataFields";
import { editedValues } from "../sample-data";
import { useRealRecords } from "../useRealRecords";
import { useSampleEdits } from "../useSampleEdits";

const listSampleRecords = vi.hoisted(() => vi.fn());
const loadSampleRecord = vi.hoisted(() => vi.fn());

vi.mock("@admin/services/emailTemplateApi", async importOriginal => {
  const actual =
    await importOriginal<typeof import("@admin/services/emailTemplateApi")>();
  return { ...actual, listSampleRecords, loadSampleRecord };
});

afterEach(() => {
  listSampleRecords.mockReset();
  loadSampleRecord.mockReset();
});

const refused = (status: number, code: string) =>
  parseApiError(
    { error: { code, message: "Refused.", requestId: "r" } },
    status
  );

function clientAndWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { client, wrapper };
}

const VARIABLES = [{ name: "orderNumber" }, { name: "note" }];

describe("a real record in the test data", () => {
  it("replaces the last record's values, so two records never mix", () => {
    const { result } = renderHook(() => useSampleEdits(VARIABLES));
    act(() => result.current.onRecord({ orderNumber: "A-1", note: "Fragile" }));
    act(() => result.current.onRecord({ orderNumber: "B-2" }));
    expect(editedValues(result.current.sampleEdits)).toEqual({
      orderNumber: "B-2",
    });
  });

  it("keeps a value the author typed after the last record", () => {
    const { result } = renderHook(() => useSampleEdits(VARIABLES));
    act(() => result.current.onRecord({ orderNumber: "A-1", note: "Fragile" }));
    act(() => result.current.onFieldChange("note", "Leave at the door"));
    act(() => result.current.onRecord({ orderNumber: "B-2" }));
    expect(editedValues(result.current.sampleEdits)).toEqual({
      orderNumber: "B-2",
      note: "Leave at the door",
    });
  });
});

describe("the records offered", () => {
  it("are withdrawn when the server refuses the person, though listed before", async () => {
    const { client, wrapper } = clientAndWrapper();
    listSampleRecords.mockResolvedValueOnce({
      label: "A real order",
      items: [{ id: "o-1", label: "Order A-1" }],
    });
    const { result } = renderHook(() => useRealRecords("t-1", () => {}), {
      wrapper,
    });
    await waitFor(() => expect(result.current.offer.kind).toBe("offered"));

    listSampleRecords.mockRejectedValueOnce(refused(403, "FORBIDDEN"));
    await act(() => client.refetchQueries());
    await waitFor(() =>
      expect(result.current.offer).toEqual({ kind: "not-readable" })
    );
  });

  it("drop a record that answers after the editor moved to another template", async () => {
    const { wrapper } = clientAndWrapper();
    listSampleRecords.mockResolvedValue({
      label: "A real order",
      items: [{ id: "o-1", label: "Order A-1" }],
    });
    let answer: (values: Record<string, unknown>) => void = () => {};
    loadSampleRecord.mockReturnValue(
      new Promise(resolve => {
        answer = resolve;
      })
    );
    const onLoaded = vi.fn();
    const { result, rerender } = renderHook(
      ({ id }: { id: string }) => useRealRecords(id, onLoaded),
      { wrapper, initialProps: { id: "t-1" } }
    );
    await waitFor(() => expect(result.current.offer.kind).toBe("offered"));
    act(() => result.current.choose("o-1"));
    rerender({ id: "t-2" });
    await act(async () => {
      answer({ orderNumber: "O-1" });
      await Promise.resolve();
    });
    expect(onLoaded).not.toHaveBeenCalled();
    expect(result.current.chosen).toBe("");
  });
});

describe("a field of the test data", () => {
  it("says a value isn't of its type, rather than showing another value", () => {
    render(
      <DataFields
        variables={[
          { name: "gift", presentation: { type: "boolean", label: "Gift" } },
          { name: "placed", presentation: { type: "date", label: "Placed" } },
        ]}
        data={{ gift: "false", placed: "next week" }}
        onChange={() => {}}
      />
    );
    expect(screen.getByTestId("misfit-gift").textContent).toContain(
      "isn't a yes or no"
    );
    expect(screen.getByTestId("misfit-placed").textContent).toContain(
      "isn't a date"
    );
    expect(screen.queryByRole("switch", { name: "Gift" })).toBeNull();
  });

  it("is drawn once for a name declared twice, as its first declaration", () => {
    render(
      <DataFields
        variables={[
          { name: "total", presentation: { type: "money", label: "Total" } },
          { name: "total", presentation: { type: "text", label: "Again" } },
        ]}
        data={{ total: 12.5 }}
        onChange={() => {}}
      />
    );
    expect(screen.getAllByLabelText("Total")).toHaveLength(1);
    expect(screen.queryByLabelText("Again")).toBeNull();
  });
});
