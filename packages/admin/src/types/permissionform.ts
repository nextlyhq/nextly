import { z } from "zod";

export interface PermissionFormProps {
  isEdit?: boolean;
  initialData?: {
    name?: string;
    slug?: string;
    description?: string;
    systemPermission?: boolean;
  };
}

export function getPermissionFormSchema(isEdit: boolean) {
  return z.object({
    name: z.string().trim().min(1, "Name is required"),
    slug: z.string().trim().min(1, "Slug is required"),
  });
}

export const createPermissionFormSchema = getPermissionFormSchema(false);
export const editPermissionFormSchema = getPermissionFormSchema(true);

export type CreatePermissionFormValues = z.infer<
  typeof createPermissionFormSchema
>;
export type EditPermissionFormValues = z.infer<typeof editPermissionFormSchema>;
export type PermissionFormValues = {
  name: string;
  slug: string;
  description?: string;
  systemPermission?: boolean;
};
