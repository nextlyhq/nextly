"use client";

import { Label } from "@nextlyhq/ui";
import type * as LabelPrimitive from "@radix-ui/react-label";
import { Slot } from "@radix-ui/react-slot";
import type * as React from "react";
import type { ComponentProps } from "react";
import {
  createContext,
  useContext,
  useEffect,
  useId,
  useMemo,
  useState,
} from "react";
import {
  Controller,
  FormProvider,
  useFormContext,
  useFormState,
  type ControllerProps,
  type FieldPath,
  type FieldValues,
} from "react-hook-form";

import { cn } from "@admin/lib/utils";

type FormFieldContextValue<
  TFieldValues extends FieldValues = FieldValues,
  TName extends FieldPath<TFieldValues> = FieldPath<TFieldValues>,
> = {
  name: TName;
};

type FormItemContextValue = {
  id: string;
  /**
   * Whether a `FormDescription` with content is actually on the page.
   *
   * `FormControl` has to name the description in `aria-describedby`, but it is
   * a SIBLING of `FormDescription` and React offers no synchronous way for one
   * sibling to observe another during render. So the description registers
   * itself here on mount and `FormControl` reads the registration, rather than
   * assuming a description exists — which is what it used to do, pointing every
   * control without one at an element that never rendered.
   */
  hasDescription: boolean;
  setHasDescription: (present: boolean) => void;
};

const Form: typeof FormProvider = FormProvider;

const FormFieldContext = createContext<FormFieldContextValue>(
  {} as FormFieldContextValue
);

const FormField = <
  TFieldValues extends FieldValues = FieldValues,
  TName extends FieldPath<TFieldValues> = FieldPath<TFieldValues>,
>({
  ...props
}: ControllerProps<TFieldValues, TName>) => {
  return (
    <FormFieldContext.Provider value={{ name: props.name }}>
      <Controller {...props} />
    </FormFieldContext.Provider>
  );
};

const useFormField = () => {
  const fieldContext = useContext(FormFieldContext);
  const itemContext = useContext(FormItemContext);
  const { getFieldState } = useFormContext();
  const formState = useFormState({ name: fieldContext.name });
  const fieldState = getFieldState(fieldContext.name, formState);

  if (!fieldContext) {
    throw new Error("useFormField should be used within <FormField>");
  }

  const { id, hasDescription, setHasDescription } = itemContext;

  return {
    id,
    name: fieldContext.name,
    formItemId: `${id}-form-item`,
    formDescriptionId: `${id}-form-item-description`,
    formMessageId: `${id}-form-item-message`,
    hasDescription,
    setHasDescription,
    ...fieldState,
  };
};

const FormItemContext = createContext<FormItemContextValue>(
  {} as FormItemContextValue
);

function FormItem({ className, ...props }: ComponentProps<"div">) {
  const id = useId();
  const [hasDescription, setHasDescription] = useState(false);

  // Memoised so the context value is not a new object on every render, which
  // would re-render every consumer of this field on each keystroke.
  const context = useMemo(
    () => ({ id, hasDescription, setHasDescription }),
    [id, hasDescription]
  );

  return (
    <FormItemContext.Provider value={context}>
      <div
        data-slot="form-item"
        className={cn("space-y-1.5", className)}
        {...props}
      />
    </FormItemContext.Provider>
  );
}

function FormLabel({
  className,
  ...props
}: React.ComponentProps<typeof LabelPrimitive.Root>) {
  const { error, formItemId } = useFormField();

  return (
    <Label
      data-slot="form-label"
      data-error={!!error}
      className={cn("text-foreground", className)}
      htmlFor={formItemId}
      {...props}
    />
  );
}

function FormControl({ ...props }: React.ComponentProps<typeof Slot>) {
  const {
    error,
    formItemId,
    formDescriptionId,
    formMessageId,
    hasDescription,
  } = useFormField();

  // Name only the elements that actually render. Referencing an id that is not
  // on the page tells assistive technology a description exists and then gives
  // it nothing, which is why this composes the list from what is present rather
  // than always naming the description. `undefined` when neither exists, so no
  // empty attribute is emitted.
  const describedBy =
    [hasDescription ? formDescriptionId : null, error ? formMessageId : null]
      .filter(Boolean)
      .join(" ") || undefined;

  return (
    <Slot
      data-slot="form-control"
      id={formItemId}
      aria-describedby={describedBy}
      aria-invalid={error ? "true" : "false"}
      data-invalid={error ? "true" : "false"}
      {...props}
    />
  );
}

/**
 * A field's helper text, under the field.
 *
 * This used to render nothing and hand its text to the label, which showed it
 * in a tooltip behind an info icon. Help that has to be discovered by hovering
 * an icon is help most people never read, and it is unreachable by touch. The
 * text sits under the control it describes instead, where `aria-describedby`
 * has always claimed it was.
 */
function FormDescription({ className, ...props }: React.ComponentProps<"p">) {
  const { formDescriptionId, setHasDescription } = useFormField();
  const present = Boolean(props.children);

  // Publish presence so `FormControl` can decide whether to name this element.
  // The effect covers the whole lifecycle: mounting with content registers,
  // content becoming empty deregisters, and unmounting cleans up — so a
  // description that disappears does not leave a stale reference behind.
  useEffect(() => {
    setHasDescription(present);
    return () => setHasDescription(false);
  }, [present, setHasDescription]);

  if (!present) return null;

  return (
    <p
      id={formDescriptionId}
      data-slot="form-description"
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  );
}

function FormMessage({ className, ...props }: React.ComponentProps<"p">) {
  const { error, formMessageId } = useFormField();
  const body = error ? String(error?.message ?? "") : props.children;

  if (!body) {
    return null;
  }

  return (
    <p
      data-slot="form-message"
      id={formMessageId}
      className={cn("text-destructive-500 text-sm font-medium", className)}
      {...props}
    >
      {body}
    </p>
  );
}

export {
  useFormField,
  Form,
  FormItem,
  FormLabel,
  FormControl,
  FormDescription,
  FormMessage,
  FormField,
};
