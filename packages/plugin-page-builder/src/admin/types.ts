/**
 * Props the Nextly admin passes to a custom collection Edit-view component
 * (verified: packages/admin/src/lib/plugins/component-registry.ts). There is no save
 * function — the view self-persists (see adminFetch).
 */
export interface CustomEditViewProps {
  collectionSlug: string;
  entryId?: string;
  isCreating: boolean;
  initialData?: Record<string, unknown>;
  onSuccess?: (entry?: Record<string, unknown>) => void;
  onDelete?: () => void;
  onCancel?: () => void;
  onDuplicate?: () => void;
}
