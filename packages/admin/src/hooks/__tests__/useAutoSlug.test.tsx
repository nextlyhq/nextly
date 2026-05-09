import { act, renderHook } from "@testing-library/react";
import { useForm } from "react-hook-form";
import { describe, it, expect } from "vitest";

import { useAutoSlug } from "../useAutoSlug";

// ────────────────────────────────────────────────────────────────────────
// Test harness — driver hook that wires `useForm` + `useAutoSlug` so each
// test can read the form state out of the renderHook result and call
// setValue on the same instance.
// ────────────────────────────────────────────────────────────────────────

interface FormShape {
  title?: string;
  slug?: string;
  headline?: string;
  [key: string]: unknown;
}

interface DriverOptions {
  defaultValues: FormShape;
  titleFieldName: string;
  slugFieldName: string;
  enabled?: boolean;
}

function useDriver({
  defaultValues,
  titleFieldName,
  slugFieldName,
  enabled,
}: DriverOptions) {
  const form = useForm<FormShape>({ defaultValues });
  useAutoSlug({ form, titleFieldName, slugFieldName, enabled });
  return form;
}

// ────────────────────────────────────────────────────────────────────────
// Tests
// ────────────────────────────────────────────────────────────────────────

describe("useAutoSlug", () => {
  it("writes a slug when the title field changes and slug is empty", () => {
    const { result } = renderHook(() =>
      useDriver({
        defaultValues: { title: "", slug: "" },
        titleFieldName: "title",
        slugFieldName: "slug",
      })
    );

    act(() => {
      result.current.setValue("title", "Hello World");
    });

    expect(result.current.getValues("slug")).toBe("hello-world");
  });

  it("keeps the slug in step with the title until the user edits it", () => {
    const { result } = renderHook(() =>
      useDriver({
        defaultValues: { title: "", slug: "" },
        titleFieldName: "title",
        slugFieldName: "slug",
      })
    );

    act(() => {
      result.current.setValue("title", "First");
    });
    expect(result.current.getValues("slug")).toBe("first");

    act(() => {
      result.current.setValue("title", "First Two");
    });
    expect(result.current.getValues("slug")).toBe("first-two");
  });

  it("stops auto-generating once the user manually edits the slug", () => {
    const { result } = renderHook(() =>
      useDriver({
        defaultValues: { title: "", slug: "" },
        titleFieldName: "title",
        slugFieldName: "slug",
      })
    );

    // Auto-generated slug from "Hello World"
    act(() => {
      result.current.setValue("title", "Hello World");
    });
    expect(result.current.getValues("slug")).toBe("hello-world");

    // User overrides slug
    act(() => {
      result.current.setValue("slug", "custom-slug");
    });

    // Title changes again — slug should NOT be overwritten.
    act(() => {
      result.current.setValue("title", "New Title");
    });
    expect(result.current.getValues("slug")).toBe("custom-slug");
  });

  it("preserves an existing custom slug on mount (edit mode)", () => {
    const { result } = renderHook(() =>
      useDriver({
        defaultValues: { title: "Hello World", slug: "my-custom-slug" },
        titleFieldName: "title",
        slugFieldName: "slug",
      })
    );

    // Slug must NOT be replaced with "hello-world" just because the
    // title would have generated that — it was set by the user/seed.
    expect(result.current.getValues("slug")).toBe("my-custom-slug");
  });

  it("treats an existing slug that matches the generated value as auto", () => {
    const { result } = renderHook(() =>
      useDriver({
        defaultValues: { title: "Hello World", slug: "hello-world" },
        titleFieldName: "title",
        slugFieldName: "slug",
      })
    );

    // Sanity: initial state preserved.
    expect(result.current.getValues("slug")).toBe("hello-world");

    // Title changes — because the existing slug matched what the hook
    // would have written, follow-up edits keep auto-generating.
    act(() => {
      result.current.setValue("title", "New Title");
    });
    expect(result.current.getValues("slug")).toBe("new-title");
  });

  it("does nothing when the slug field doesn't exist on the form", () => {
    const { result } = renderHook(() =>
      useDriver({
        defaultValues: { title: "" },
        titleFieldName: "title",
        slugFieldName: "slug",
      })
    );

    act(() => {
      result.current.setValue("title", "Something");
    });

    expect(result.current.getValues("slug")).toBeUndefined();
  });

  it("respects a custom title field name (e.g. useAsTitle: 'headline')", () => {
    const { result } = renderHook(() =>
      useDriver({
        defaultValues: { headline: "", slug: "" },
        titleFieldName: "headline",
        slugFieldName: "slug",
      })
    );

    act(() => {
      result.current.setValue("headline", "Editorial Voice");
    });

    expect(result.current.getValues("slug")).toBe("editorial-voice");
  });

  it("short-circuits when enabled is false", () => {
    const { result } = renderHook(() =>
      useDriver({
        defaultValues: { title: "", slug: "" },
        titleFieldName: "title",
        slugFieldName: "slug",
        enabled: false,
      })
    );

    act(() => {
      result.current.setValue("title", "Hello World");
    });

    // No write happened — slug stays empty.
    expect(result.current.getValues("slug")).toBe("");
  });
});
