import { act, renderHook } from "@testing-library/react";
import { useForm } from "react-hook-form";
import { describe, it, expect } from "vitest";

import { useFormRestore } from "@admin/components/features/versions/useEditorRestoreSurface";

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
  frozen?: boolean;
}

function useDriver({
  defaultValues,
  titleFieldName,
  slugFieldName,
  enabled,
  frozen,
}: DriverOptions) {
  const form = useForm<FormShape>({ defaultValues });
  useAutoSlug({ form, titleFieldName, slugFieldName, enabled, frozen });
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

  it("leaves a frozen slug alone when the title changes", () => {
    // A published entry's slug is a public address. Re-deriving it from an edited title retires a
    // URL the author never chose to change, and every inbound link to it 404s.
    const { result } = renderHook(() =>
      useDriver({
        defaultValues: {
          title: "How to build a blog with Nextly",
          slug: "how-to-build-a-blog-with-nextly",
        },
        titleFieldName: "title",
        slugFieldName: "slug",
        frozen: true,
      })
    );

    act(() => {
      result.current.setValue(
        "title",
        "How to build a blog with Nextly ISR check"
      );
    });

    expect(result.current.getValues("slug")).toBe(
      "how-to-build-a-blog-with-nextly"
    );
  });

  it("still lets a frozen slug be edited directly", () => {
    // Freezing stops the automatic rewrite, not the author. Changing the URL stays available; it
    // just becomes something done on purpose rather than as a side effect of retitling.
    const { result } = renderHook(() =>
      useDriver({
        defaultValues: { title: "Original title", slug: "original-title" },
        titleFieldName: "title",
        slugFieldName: "slug",
        frozen: true,
      })
    );

    act(() => {
      result.current.setValue("slug", "a-deliberate-url");
    });
    act(() => {
      result.current.setValue("title", "Retitled again");
    });

    expect(result.current.getValues("slug")).toBe("a-deliberate-url");
  });

  it("keeps following the title while the entry is not frozen", () => {
    // The draft case, which must not regress: an author refining a title before publishing expects
    // the URL to keep up.
    const { result } = renderHook(() =>
      useDriver({
        defaultValues: { title: "First draft", slug: "first-draft" },
        titleFieldName: "title",
        slugFieldName: "slug",
        frozen: false,
      })
    );

    act(() => {
      result.current.setValue("title", "Second draft");
    });

    expect(result.current.getValues("slug")).toBe("second-draft");
  });
});

describe("useAutoSlug, while a restore holds the title", () => {
  function useRestoringDriver() {
    const form = useForm<FormShape>({
      defaultValues: { title: "Now", slug: "now" },
    });
    const restore = useFormRestore(form);
    useAutoSlug({
      form,
      titleFieldName: "title",
      slugFieldName: "slug",
      restore,
    });
    return { form, restore };
  }

  it("leaves the slug as it is when a restore puts back only the title", () => {
    const { result } = renderHook(() => useRestoringDriver());

    act(() => {
      result.current.restore.apply({ title: "Then" }, 3);
    });

    expect(result.current.form.getValues("title")).toBe("Then");
    expect(result.current.form.getValues("slug")).toBe("now");
  });

  it("follows the title again once the person edits it", () => {
    const { result } = renderHook(() => useRestoringDriver());

    act(() => {
      result.current.restore.apply({ title: "Then" }, 3);
    });
    act(() => {
      result.current.form.setValue("title", "Typed title");
    });

    expect(result.current.form.getValues("slug")).toBe("typed-title");
  });
});
