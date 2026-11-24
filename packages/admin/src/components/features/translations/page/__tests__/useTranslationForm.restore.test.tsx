/**
 * A past version's value put into the form is saved naming the version it came
 * from, and a save with none restored names nothing. And what a refused save
 * leaves: the form never goes back to a read older than its own save.
 */
import { QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { FieldConfig } from "nextly/config";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createTestQueryClient } from "@admin/__tests__/utils";
import { parseApiError } from "@admin/lib/api/parseApiError";

import { useTranslationForm } from "../useTranslationForm";

const update = vi.hoisted(() => vi.fn());
const reload = vi.hoisted(() =>
  vi.fn<() => Promise<Record<string, unknown> | undefined>>()
);

vi.mock("@admin/services/entryApi", async importOriginal => {
  const actual =
    await importOriginal<typeof import("@admin/services/entryApi")>();
  return { ...actual, entryApi: { ...actual.entryApi, update } };
});

const FIELD = {
  name: "bio",
  type: "textarea",
  label: "Biography",
} as unknown as FieldConfig;
const OPTIONS = {
  document: { kind: "collection", slug: "authors", id: "a1" },
  target: { code: "es", label: "Spanish" },
  fields: [FIELD],
  rows: [{ field: FIELD, name: "bio", label: "Biography" }],
  written: { id: "a1", bio: "Una pionera", _rev: "7.es:3" },
  sourceOf: () => "en",
  reload: () => reload(),
} satisfies Parameters<typeof useTranslationForm>[0];

function form() {
  const queryClient = createTestQueryClient();
  return renderHook(() => useTranslationForm(OPTIONS), {
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    ),
  });
}
const body = (call = 0) =>
  update.mock.calls[call]?.[2] as Record<string, unknown>;

const STALE = parseApiError(
  {
    error: {
      code: "STALE_VERSION",
      message: "The document changed.",
      data: { currentVersion: "8.es:3" },
    },
  },
  409
);

beforeEach(() => {
  reload.mockReset();
  reload.mockResolvedValue(undefined);
  update.mockReset();
  update.mockImplementation(
    (_slug: string, _id: string, payload: Record<string, unknown>) =>
      Promise.resolve({
        item: { id: "a1", bio: payload.bio, _rev: "7.es:4" },
      })
  );
});

describe("a save of the form", () => {
  it("names the version a restored value came from", async () => {
    const { result } = form();
    act(() => {
      result.current.restore.apply({ bio: "La primera" }, 3);
    });
    await act(async () => {
      expect(await result.current.save()).toBe(true);
    });
    expect(body()).toEqual({
      bio: "La primera",
      _restoredFrom: { bio: 3 },
      _rev: "7.es:3",
    });
  });

  it("names none once it has been saved", async () => {
    const { result } = form();
    act(() => {
      result.current.restore.apply({ bio: "La primera" }, 3);
    });
    await act(async () => {
      await result.current.save();
    });
    act(() => {
      result.current.form.setValue("bio", "Otra", { shouldDirty: true });
    });
    await act(async () => {
      await result.current.save();
    });
    expect(Object.keys(body(1))).not.toContain("_restoredFrom");
  });

  it("names none where nothing was restored, or it was written over", async () => {
    const { result } = form();
    act(() => {
      result.current.form.setValue("bio", "Otra", { shouldDirty: true });
    });
    await act(async () => {
      await result.current.save();
    });
    expect(Object.keys(body()).sort()).toEqual(["_rev", "bio"]);

    act(() => {
      result.current.restore.apply({ bio: "La primera" }, 3);
      result.current.form.setValue("bio", "Tercera", { shouldDirty: true });
    });
    await act(async () => {
      await result.current.save();
    });
    expect(Object.keys(body(1)).sort()).toEqual(["_rev", "bio"]);
  });

  it("still names it when the save is made over a newer version", async () => {
    update.mockRejectedValueOnce(STALE);
    const { result } = form();
    act(() => {
      result.current.restore.apply({ bio: "La primera" }, 3);
    });
    await act(async () => {
      expect(await result.current.save()).toBe(false);
    });
    await waitFor(() => expect(result.current.conflict).not.toBeNull());
    await act(async () => {
      await result.current.saveAnyway();
    });
    expect(body(1)).toMatchObject({
      bio: "La primera",
      _restoredFrom: { bio: 3 },
      _overwrite: true,
    });
    // What it stored stays on screen, at the version it stored.
    expect(result.current.form.getValues("bio")).toBe("La primera");
    expect(result.current.startedFrom()).toBe("7.es:4");
  });

  it("keeps the words on screen when the current version can't be loaded", async () => {
    update.mockRejectedValueOnce(STALE);
    const { result } = form();
    act(() => {
      result.current.form.setValue("bio", "Otra", { shouldDirty: true });
    });
    await act(async () => {
      await result.current.save();
    });
    await act(async () => {
      await expect(result.current.loadCurrent()).rejects.toThrow(
        "The current version couldn't be loaded."
      );
    });
    expect(result.current.form.getValues("bio")).toBe("Otra");
    expect(result.current.conflict?.failure).toMatch(/couldn't be loaded/);
  });

  it("lets go of a refused save whose words were put back, and reads again", async () => {
    update.mockRejectedValueOnce(STALE);
    const { result } = form();
    act(() => {
      result.current.form.setValue("bio", "Otra", { shouldDirty: true });
    });
    await act(async () => {
      await result.current.save();
    });
    expect(result.current.conflict).not.toBeNull();
    act(() => {
      result.current.form.setValue("bio", "Una pionera", { shouldDirty: true });
    });
    await waitFor(() => expect(result.current.conflict).toBeNull());
    expect(reload).toHaveBeenCalledOnce();
  });

  it("answers that work is left when more was typed while it was on its way", async () => {
    let answer: (value: unknown) => void = () => undefined;
    update.mockReturnValueOnce(
      new Promise(resolve => {
        answer = resolve;
      })
    );
    const { result } = form();
    act(() => {
      result.current.form.setValue("bio", "Otra", { shouldDirty: true });
    });
    let saved: Promise<boolean> = Promise.resolve(true);
    act(() => {
      saved = result.current.save();
    });
    await waitFor(() => expect(update).toHaveBeenCalledOnce());
    await act(async () => {
      result.current.form.setValue("bio", "Otra más", { shouldDirty: true });
      answer({ item: { id: "a1", bio: "Otra", _rev: "7.es:4" } });
      expect(await saved).toBe(false);
    });
    expect(result.current.form.getValues("bio")).toBe("Otra más");
  });
});
