/**
 * The header draws the actions its editor decided, so drawn without one it has
 * nothing true to offer. It says so, naming what is missing, rather than
 * drawing a header with no Save — which reads to an author as the save being
 * gone and to a developer as nothing at all.
 */
import type { ReactNode } from "react";
import { FormProvider, useForm } from "react-hook-form";
import { afterEach, describe, expect, it, vi } from "vitest";

import { render } from "@admin/__tests__/utils";

import { EntrySystemHeader } from "../EntrySystemHeader";

function Form({ children }: { children: ReactNode }) {
  const methods = useForm({ defaultValues: { title: "" } });
  return <FormProvider {...methods}>{children}</FormProvider>;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("EntrySystemHeader outside a document editor", () => {
  it("fails loudly, naming the missing host", () => {
    // React reports the thrown render error as well; it is the expected one.
    vi.spyOn(console, "error").mockImplementation(() => {});

    expect(() =>
      render(
        <Form>
          <EntrySystemHeader mode="edit" collectionSlug="posts" />
        </Form>
      )
    ).toThrow(/DocumentActionsHost/);
  });
});
