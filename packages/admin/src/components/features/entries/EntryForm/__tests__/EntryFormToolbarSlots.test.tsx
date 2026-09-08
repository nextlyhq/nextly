/**
 * The toolbar slot's write seam observes the held-write state.
 *
 * `EntryFormToolbarSlots` owns the react-hook-form access and hands each
 * plugin a plain `{ value, onChange }` pair. With the document's writes
 * withheld — a past version on screen, a colleague's claim — the callback must
 * decline, or the takeover mode switch silently edits a live form the author
 * cannot currently see. The callback stays a function (plugins already in the
 * wild call it without checking), so what is asserted is the VALUE, not the
 * callback's existence.
 */
import { FormProvider, useForm } from "react-hook-form";
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ReactNode } from "react";

import { render } from "@admin/__tests__/utils";

const { slotProps, useBranding } = vi.hoisted(() => ({
  slotProps: {
    current: null as {
      props: {
        onChange?: (next: unknown) => void;
        value?: unknown;
      };
    } | null,
  },
  useBranding: vi.fn(() => ({
    plugins: [{ name: "mode", entryFormToolbarSlot: "x/mode" }],
  })),
}));

vi.mock("@admin/context/providers/BrandingProvider", async importOriginal => ({
  ...(await importOriginal<
    typeof import("@admin/context/providers/BrandingProvider")
  >()),
  useBranding,
}));
vi.mock("@admin/components/shared/plugin-slot", () => ({
  PluginSlot: (props: { props: { onChange?: (next: unknown) => void } }) => {
    slotProps.current = props;
    return null;
  },
}));

import { EntryFormToolbarSlots } from "../EntryFormToolbarSlots";

/** The header reads the form through context, so the test gives it a real one. */
function WithForm({
  children,
  formRef,
}: {
  children: ReactNode;
  formRef: { current: { getValues: (name: string) => unknown } | null };
}) {
  const form = useForm({ defaultValues: { mode: "write" } });
  formRef.current = form;
  return <FormProvider {...form}>{children}</FormProvider>;
}

const formRef = {
  current: null as { getValues: (name: string) => unknown } | null,
};

beforeEach(() => {
  vi.clearAllMocks();
  formRef.current = null;
});

describe("EntryFormToolbarSlots — the plugin write seam", () => {
  it("writes the controller field while writes are offered", () => {
    render(
      <WithForm formRef={formRef}>
        <EntryFormToolbarSlots context="single" controllerField="mode" />
      </WithForm>
    );

    const onChange = slotProps.current?.props.onChange;
    expect(onChange, "the slot hands the plugin a write").toBeTypeOf(
      "function"
    );
    onChange?.("read");

    expect(formRef.current?.getValues("mode")).toBe("read");
  });

  it("declines the write while the document's writes are held", () => {
    render(
      <WithForm formRef={formRef}>
        <EntryFormToolbarSlots
          context="single"
          controllerField="mode"
          writesHeld
        />
      </WithForm>
    );

    // The callback remains a function — plugins in the wild call it without
    // checking — and the field it points at is untouched.
    const onChange = slotProps.current?.props.onChange;
    expect(onChange, "the callback the plugin received").toBeTypeOf("function");
    expect(() => onChange?.("read")).not.toThrow();

    expect(formRef.current?.getValues("mode")).toBe("write");
  });

  it("displays the override value instead of the hidden live form's", () => {
    // While a past version is on screen the editors pass the version's own
    // controller value; the watched live value would label the historical
    // body with today's mode.
    render(
      <WithForm formRef={formRef}>
        <EntryFormToolbarSlots
          context="single"
          controllerField="mode"
          value="read"
        />
      </WithForm>
    );

    expect(slotProps.current?.props.value).toBe("read");
  });
});
