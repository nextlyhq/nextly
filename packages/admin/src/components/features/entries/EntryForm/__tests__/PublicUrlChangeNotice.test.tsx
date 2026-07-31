// The notice has to track "differs from the URL that is actually published", not "was touched".
// A baseline captured once on mount gets the two cases after a save exactly backwards, and a
// warning that lies in either direction is worse than none.

import { act, render, screen } from "@testing-library/react";
import { FormProvider, useForm } from "react-hook-form";
import { describe, expect, it } from "vitest";

import { PublicUrlChangeNotice } from "../PublicUrlChangeNotice";

const NOTICE = /Changes the public URL/i;

function Harness({
  active,
  defaultSlug,
  onReady,
}: {
  active: boolean;
  defaultSlug: string;
  onReady: (form: ReturnType<typeof useForm>) => void;
}) {
  const form = useForm({ defaultValues: { slug: defaultSlug } });
  onReady(form);
  return (
    <FormProvider {...form}>
      <PublicUrlChangeNotice slugName="slug" active={active} />
    </FormProvider>
  );
}

function setup(active: boolean, defaultSlug = "original-post") {
  let form!: ReturnType<typeof useForm>;
  render(
    <Harness
      active={active}
      defaultSlug={defaultSlug}
      onReady={f => {
        form = f;
      }}
    />
  );
  return () => form;
}

describe("PublicUrlChangeNotice", () => {
  it("says nothing while the slug matches what is published", () => {
    setup(true);
    expect(screen.queryByText(NOTICE)).toBeNull();
  });

  it("warns once the slug is edited away from the published one", () => {
    const form = setup(true);

    act(() => {
      form().setValue("slug", "renamed-post");
    });

    expect(screen.getByText(NOTICE)).toBeTruthy();
  });

  it("clears once the edit is saved and becomes the published URL", () => {
    // The editor stays mounted while the entry is re-read, and the form is re-seeded from it. A
    // baseline captured on mount would still hold the old slug and keep warning about a change
    // that already landed.
    const form = setup(true);

    act(() => {
      form().setValue("slug", "renamed-post");
    });
    expect(screen.getByText(NOTICE)).toBeTruthy();

    act(() => {
      form().reset({ slug: "renamed-post" });
    });

    expect(screen.queryByText(NOTICE)).toBeNull();
  });

  it("warns again when the slug is pointed back at the old one after a save", () => {
    // Reverting is another change of address, not a return to safety. A mount-time baseline reads
    // this as "back to normal" and goes quiet on the edit that moves the URL a second time.
    const form = setup(true);

    act(() => {
      form().reset({ slug: "renamed-post" });
    });
    act(() => {
      form().setValue("slug", "original-post");
    });

    expect(screen.getByText(NOTICE)).toBeTruthy();
  });

  it("stays silent for an entry with no public address", () => {
    const form = setup(false);

    act(() => {
      form().setValue("slug", "still-a-draft");
    });

    expect(screen.queryByText(NOTICE)).toBeNull();
  });
});
