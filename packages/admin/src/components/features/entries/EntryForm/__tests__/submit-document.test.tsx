/**
 * A save waits for a recovery point already on its way to the server.
 *
 * The save deletes the author's recovery point. A recording sent before it and
 * landing after it would leave an older snapshot behind, recorded as if made
 * from the saved document, which the editor would then offer as current work.
 *
 * @module components/features/entries/EntryForm/__tests__/submit-document.test
 */
import { act, renderHook } from "@testing-library/react";
import { useForm } from "react-hook-form";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useSnapshotAutosave } from "@admin/hooks/useSnapshotAutosave";

import { submitDocument } from "../submit-document";

const DEBOUNCE = 2000;
/** The document being saved, as `documentRecordingKey` spells it. */
const DOC = "collection:posts:e1";

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  vi.useRealTimers();
});

/** A recording sent and held open until `land` is called. */
function recordingInFlight() {
  let land: () => void = () => undefined;
  const save = vi.fn(
    () =>
      new Promise<{ updatedAt: string }>(resolve => {
        land = () => resolve({ updatedAt: "2026-11-04T00:00:00.000Z" });
      })
  );
  const recorder = renderHook(() =>
    useSnapshotAutosave({
      identity: `${DOC}:`,
      document: DOC,
      save,
      debounceMs: DEBOUNCE,
    })
  );
  act(() => recorder.result.current.schedule());
  act(() => void vi.advanceTimersByTime(DEBOUNCE));
  expect(save).toHaveBeenCalledTimes(1);
  return { land: () => act(async () => land()) };
}

function submitting() {
  const form = renderHook(() =>
    useForm<Record<string, unknown>>({ defaultValues: { title: "saved" } })
  ).result.current;
  const write = vi.fn(async (payload: Record<string, unknown>) => ({
    item: { id: "e1" },
    stored: payload,
  }));
  const outcome = submitDocument({
    form,
    toPayload: v => v,
    write,
    recordingsFor: DOC,
  });
  return { write, outcome };
}

describe("submitDocument and the recordings in flight", () => {
  it("writes only once the recording already sent has landed", async () => {
    const recording = recordingInFlight();
    const { write, outcome } = submitting();

    await act(async () => {
      await Promise.resolve();
    });
    expect(write).not.toHaveBeenCalled();

    await recording.land();
    await expect(outcome).resolves.toMatchObject({ ok: true });
    expect(write).toHaveBeenCalledTimes(1);
  });

  it("writes straight away with no recording in flight, which is the control", async () => {
    const { write, outcome } = submitting();

    await expect(outcome).resolves.toMatchObject({ ok: true });
    expect(write).toHaveBeenCalledTimes(1);
  });
});

describe("submitDocument and restored values", () => {
  /** A form holding "saved", with a restore that names a source for it. */
  function withRestore(write: (payload: Record<string, unknown>) => unknown) {
    const form = renderHook(() =>
      useForm<Record<string, unknown>>({ defaultValues: { title: "saved" } })
    ).result.current;
    const restore = {
      restoredFromForSave: vi.fn(() => ({ title: 3 })),
      saved: vi.fn(),
    };
    const outcome = submitDocument({
      form,
      toPayload: v => v,
      write: vi.fn(async (payload: Record<string, unknown>) => {
        await write(payload);
        return { item: { id: "e1" }, stored: payload };
      }),
      recordingsFor: null,
      restore,
    });
    return { restore, outcome };
  }

  it("names each restored field's version on the save, then forgets them", async () => {
    const sent: Record<string, unknown>[] = [];
    const { restore, outcome } = withRestore(payload => sent.push(payload));

    await expect(outcome).resolves.toMatchObject({ ok: true });
    expect(sent[0]).toMatchObject({
      title: "saved",
      _restoredFrom: { title: 3 },
    });
    expect(restore.saved).toHaveBeenCalledTimes(1);
  });

  it("keeps the sources for the next try when the save fails", async () => {
    const { restore, outcome } = withRestore(() => {
      throw new Error("refused");
    });

    await expect(outcome).resolves.toMatchObject({ ok: false });
    expect(restore.saved).not.toHaveBeenCalled();
  });
});
