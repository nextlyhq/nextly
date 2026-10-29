/**
 * Entry Form Provider Component
 *
 * Wraps children with React Hook Form's FormProvider context,
 * enabling nested components to access form state via useFormContext.
 *
 * @module components/entries/EntryForm/EntryFormProvider
 * @since 1.0.0
 */

import type { JSX } from "react";
import { FormProvider, type UseFormReturn } from "react-hook-form";

// ============================================================================
// Types
// ============================================================================

export interface EntryFormProviderProps {
  /** React Hook Form instance from useEntryForm */
  form: UseFormReturn<Record<string, unknown>>;
  /** Child components that need form context */
  children: React.ReactNode;
  /** Form submit handler */
  onSubmit: (e?: React.BaseSyntheticEvent) => Promise<void>;
  /** Additional CSS classes for the form element */
  className?: string;
  /** Form ID for accessibility and submit button association */
  formId?: string;
  /**
   * Whether a refused publish's recovery is taking the live values: the form
   * is marked busy for assistive technology until it finishes. The recovery's
   * own toast says so to everyone.
   */
  recovering?: boolean;
}

// ============================================================================
// Component
// ============================================================================

/**
 * EntryFormProvider - Provides form context to child components
 *
 * Wraps the form with FormProvider so that nested field components
 * can access form state via useFormContext(). This enables the
 * FieldRenderer to work without explicit prop drilling.
 *
 * @example
 * ```tsx
 * const { form, handleSubmit } = useEntryForm({ collection, mode: "create" });
 *
 * return (
 *   <EntryFormProvider form={form} onSubmit={handleSubmit}>
 *     <EntryFormContent collection={collection} />
 *     <EntryFormActions />
 *   </EntryFormProvider>
 * );
 * ```
 */
export function EntryFormProvider({
  form,
  children,
  onSubmit,
  className,
  formId = "entry-form",
  recovering = false,
}: EntryFormProviderProps): JSX.Element {
  return (
    <FormProvider {...form}>
      <form
        id={formId}
        onSubmit={e => {
          void onSubmit(e);
        }}
        className={className}
        noValidate // Use Zod validation instead of browser validation
        aria-busy={recovering || undefined}
      >
        {children}
      </form>
    </FormProvider>
  );
}
