import * as LabelPrimitive from "@radix-ui/react-label";
import { Slot } from "@radix-ui/react-slot";
import {
  Label,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@revnixhq/ui";
import { Info } from "lucide-react";
import * as React from "react";
import {
  ComponentProps,
  createContext,
  useContext,
  useId,
  useLayoutEffect,
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
  description: React.ReactNode;
  setDescription: (d: React.ReactNode) => void;
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

  const { id } = itemContext;

  return {
    id,
    name: fieldContext.name,
    formItemId: `${id}-form-item`,
    formDescriptionId: `${id}-form-item-description`,
    formMessageId: `${id}-form-item-message`,
    ...fieldState,
  };
};

const FormItemContext = createContext<FormItemContextValue>(
  {} as FormItemContextValue
);

function FormItem({ className, ...props }: ComponentProps<"div">) {
  const id = useId();
  const [description, setDescription] = useState<React.ReactNode>(null);

  return (
    <FormItemContext.Provider value={{ id, description, setDescription }}>
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
  const { description, id } = useContext(FormItemContext);
  const formDescriptionId = `${id}-form-item-description`;

  return (
    <div className="flex items-center gap-1.5">
      <Label
        data-slot="form-label"
        data-error={!!error}
        className={cn("text-foreground", className)}
        htmlFor={formItemId}
        {...props}
      />
      {description && (
        <TooltipProvider>
          <Tooltip delayDuration={200}>
            <TooltipTrigger
              type="button"
              tabIndex={-1}
              aria-describedby={formDescriptionId}
              className="shrink-0 text-muted-foreground hover:text-foreground focus:outline-none focus:text-foreground transition-colors cursor-help"
            >
              <Info className="h-3.5 w-3.5" />
              <span className="sr-only">Field description</span>
            </TooltipTrigger>
            <TooltipContent
              side="right"
              className="max-w-[250px] text-[12px] break-words relative z-[100] shadow-md border bg-black text-white dark:bg-zinc-800 dark:text-zinc-50 px-3 py-2 rounded-none"
            >
              {description}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}
    </div>
  );
}

function FormControl({ ...props }: React.ComponentProps<typeof Slot>) {
  const { error, formItemId, formDescriptionId, formMessageId } =
    useFormField();

  return (
    <Slot
      data-slot="form-control"
      id={formItemId}
      aria-describedby={
        !error
          ? `${formDescriptionId}`
          : `${formDescriptionId} ${formMessageId}`
      }
      aria-invalid={error ? "true" : "false"}
      data-invalid={error ? "true" : "false"}
      {...props}
    />
  );
}

function FormDescription({ children }: React.ComponentProps<"p">) {
  const { formDescriptionId } = useFormField();
  const { setDescription } = useContext(FormItemContext);

  useLayoutEffect(() => {
    setDescription(children ?? null);
    return () => setDescription(null);
  }, [children, setDescription]);

  if (!children) return null;

  // Visually hidden — kept for aria-describedby to resolve correctly
  return (
    <span
      id={formDescriptionId}
      data-slot="form-description"
      className="sr-only"
    >
      {children}
    </span>
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
      className={cn("text-red-500 text-sm font-medium", className)}
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
