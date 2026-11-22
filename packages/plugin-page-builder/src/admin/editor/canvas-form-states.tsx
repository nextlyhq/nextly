"use client";

/**
 * What the canvas says over a Form block, with the author's forms behind
 * it: each picked form's state and the forms "Pick another form" offers,
 * read as the person editing through the editor's own form routes.
 *
 * @module @nextlyhq/plugin-page-builder/admin/editor/canvas-form-states
 */
import { FormStates, type FormStatesProps } from "@nextlyhq/builder/shell";
import { useCurrentUserId } from "@nextlyhq/plugin-sdk/admin";
import { useMemo } from "react";

import { readEditorForm, readEditorForms } from "../editor-forms-client";

type Services = NonNullable<FormStatesProps["services"]>;

/** The canvas's Form notices, in the language being edited. */
export function CanvasFormStates({
  locale,
  ...props
}: Omit<FormStatesProps, "services"> & {
  readonly locale: string | undefined;
}): React.JSX.Element {
  const userId = useCurrentUserId();
  const services = useMemo(
    (): Services => ({
      pickedFormState: async form =>
        (await readEditorForm(form, locale, userId)).state,
      listForms: () => readEditorForms(userId),
    }),
    [locale, userId]
  );
  return <FormStates {...props} services={services} />;
}
