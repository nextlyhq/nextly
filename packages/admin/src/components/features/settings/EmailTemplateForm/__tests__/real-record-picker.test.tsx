/**
 * Filling the test data from a real record: the Data panel offers the records
 * a template's owner offers, to a person who may read them, and a chosen
 * record's values fill the declared variables. Nothing is saved.
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

import { RealRecordPicker } from "../RealRecordPicker";
import { recordValues } from "../sample-data";
import { useRealRecords } from "../useRealRecords";

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

function wrapper({ children }: { children: React.ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

const refused = (status: number, code: string) =>
  parseApiError(
    { error: { code, message: "Refused.", requestId: "r" } },
    status
  );

const ORDERS = {
  label: "A real order",
  items: [
    { id: "o-1", label: "Order A-1" },
    { id: "o-2", label: "Order A-2" },
  ],
};

describe("the real-record picker", () => {
  it("offers the owner's records, named for what they are", async () => {
    listSampleRecords.mockResolvedValue(ORDERS);
    render(<RealRecordPicker templateId="t-1" onLoaded={() => {}} />, {
      wrapper,
    });
    expect(await screen.findByText("Fill from a real order")).toBeTruthy();
    expect(
      screen.getByRole("combobox", { name: "Fill from a real order" })
    ).toBeTruthy();
    expect(listSampleRecords).toHaveBeenCalledWith("t-1");
  });

  it("shows nothing where the owner offers no records", async () => {
    listSampleRecords.mockRejectedValue(refused(404, "NOT_FOUND"));
    const { container } = render(
      <RealRecordPicker templateId="t-1" onLoaded={() => {}} />,
      { wrapper }
    );
    await waitFor(() => expect(listSampleRecords).toHaveBeenCalled());
    await waitFor(() => expect(container.textContent).toBe(""));
    expect(screen.queryByTestId("real-record-picker")).toBeNull();
  });

  it("says records are for people who can read them, to a person who can't", async () => {
    listSampleRecords.mockRejectedValue(refused(403, "FORBIDDEN"));
    render(<RealRecordPicker templateId="t-1" onLoaded={() => {}} />, {
      wrapper,
    });
    expect(
      await screen.findByText(
        "Real records are offered to people who can read them."
      )
    ).toBeTruthy();
    expect(screen.queryByRole("combobox")).toBeNull();
  });

  it("asks nothing for a template not yet saved", () => {
    const { container } = render(
      <RealRecordPicker templateId={undefined} onLoaded={() => {}} />,
      { wrapper }
    );
    expect(container.textContent).toBe("");
    expect(listSampleRecords).not.toHaveBeenCalled();
  });
});

describe("loading a real record", () => {
  it("hands the chosen record's values to the test data", async () => {
    listSampleRecords.mockResolvedValue(ORDERS);
    loadSampleRecord.mockResolvedValue({ orderNumber: "O-1", customer: "Ada" });
    const onLoaded = vi.fn();
    const { result } = renderHook(() => useRealRecords("t-1", onLoaded), {
      wrapper,
    });
    await waitFor(() => expect(result.current.offer.kind).toBe("offered"));
    act(() => result.current.choose("o-1"));
    await waitFor(() =>
      expect(onLoaded).toHaveBeenCalledWith({
        orderNumber: "O-1",
        customer: "Ada",
      })
    );
    expect(loadSampleRecord).toHaveBeenCalledWith("t-1", "o-1");
    expect(result.current.chosen).toBe("o-1");
    expect(result.current.loadError).toBeNull();
  });

  it("says a record is gone, and changes nothing", async () => {
    listSampleRecords.mockResolvedValue(ORDERS);
    loadSampleRecord.mockRejectedValue(refused(404, "NOT_FOUND"));
    const onLoaded = vi.fn();
    const { result } = renderHook(() => useRealRecords("t-1", onLoaded), {
      wrapper,
    });
    await waitFor(() => expect(result.current.offer.kind).toBe("offered"));
    act(() => result.current.choose("o-2"));
    await waitFor(() =>
      expect(result.current.loadError).toBe("That record is no longer there.")
    );
    expect(onLoaded).not.toHaveBeenCalled();
  });
});

describe("a record's values in the test data", () => {
  it("are those of the declared variables", () => {
    expect(
      recordValues({ userName: "Ada", userEmail: "ada@example.com" }, [
        { name: "userName" },
        { name: "resetLink" },
      ])
    ).toEqual({ userName: "Ada" });
  });

  it("are all of them, where the template declares none", () => {
    expect(recordValues({ orderNumber: "O-1" }, [])).toEqual({
      orderNumber: "O-1",
    });
  });
});
