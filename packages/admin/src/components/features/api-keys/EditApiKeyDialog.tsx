"use client";

/**
 * EditApiKeyDialog
 *
 * Inline dialog for updating a key's name and description.
 * Token type, role, and duration are immutable — the user must revoke and
 * recreate a key to change those properties.
 *
 * Uses react-hook-form + zod for validation.
 */

import { zodResolver } from "@hookform/resolvers/zod";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
} from "@revnixhq/ui";
import { useEffect } from "react";
import type React from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { Loader2 } from "@admin/components/icons";
import { toast } from "@admin/components/ui";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@admin/components/ui/form";
import { useUpdateApiKey } from "@admin/hooks/queries/useApiKeys";
import type { ApiKeyMeta } from "@admin/services/apiKeyApi";

// ============================================================
// Validation schema
// ============================================================

const editApiKeySchema = z.object({
  name: z.string().min(1, "Name is required").max(100, "Name is too long"),
  description: z.string().max(500, "Description is too long").optional(),
});

type EditApiKeyFormValues = z.infer<typeof editApiKeySchema>;

// ============================================================
// Props
// ============================================================

export interface EditApiKeyDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The key to edit, or null when the dialog is closed. */
  apiKey: ApiKeyMeta | null;
}

// ============================================================
// Component
// ============================================================

export const EditApiKeyDialog: React.FC<EditApiKeyDialogProps> = ({
  open,
  onOpenChange,
  apiKey,
}) => {
  const { mutate: doUpdate, isPending } = useUpdateApiKey();

  const form = useForm<EditApiKeyFormValues>({
    resolver: zodResolver(editApiKeySchema),
    defaultValues: { name: "", description: "" },
  });

  // Populate form whenever the dialog opens with a different key
  useEffect(() => {
    if (open && apiKey) {
      form.reset({
        name: apiKey.name,
        description: apiKey.description ?? "",
      });
    }
  }, [open, apiKey, form]);

  if (!apiKey) return null;

  const onSubmit = (values: EditApiKeyFormValues) => {
    doUpdate(
      {
        id: apiKey.id,
        data: {
          name: values.name,
          description: values.description || null,
        },
      },
      {
        onSuccess: () => {
          toast.success("API key updated", {
            description: `"${values.name}" has been saved.`,
          });
          onOpenChange(false);
        },
        onError: (err: Error) => {
          toast.error("Update failed", {
            description: err.message || "Failed to update the API key.",
          });
        },
      }
    );
  };

  return (
    <Dialog open={open} onOpenChange={isPending ? undefined : onOpenChange}>
      <DialogContent
        className="sm:max-w-md"
        aria-describedby="edit-key-description"
      >
        <DialogHeader>
          <DialogTitle>Edit API Key</DialogTitle>
          <DialogDescription id="edit-key-description">
            Update the name or description for this key.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={(e) => { void form.handleSubmit(onSubmit)(e); }} className="space-y-4">
            {/* Name */}
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Name</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="e.g. CI/CD pipeline key"
                      autoFocus
                      disabled={isPending}
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Description */}
            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    Description{" "}
                    <span className="text-muted-foreground font-normal">
                      (optional)
                    </span>
                  </FormLabel>
                  <FormControl>
                    <Input
                      placeholder="What is this key used for?"
                      disabled={isPending}
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <p className="text-xs text-muted-foreground">
              Only the name and description can be changed. To change token type
              or role, revoke this key and create a new one.
            </p>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={isPending}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={isPending}>
                {isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Saving…
                  </>
                ) : (
                  "Save changes"
                )}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
};
