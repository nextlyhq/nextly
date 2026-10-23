/**
 * The email brand settings: read, saved, and previewed before they are saved.
 *
 * @module hooks/queries/useEmailBrand
 */

import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

import {
  getBrand,
  updateBrand,
  type BrandOverview,
  type BrandSettings,
  type BrandSettingsChange,
} from "@admin/services/emailBrandApi";
import {
  previewDraft,
  type DraftPreviewData,
  type DraftPreviewResult,
  type DraftPreviewTemplate,
} from "@admin/services/emailTemplateApi";

import { emailTemplateKeys } from "./useEmailTemplates";

export const emailBrandKeys = {
  all: () => ["emailBrand"] as const,
  overview: () => [...emailBrandKeys.all(), "overview"] as const,
  preview: (
    template: DraftPreviewTemplate,
    data: DraftPreviewData,
    brand: BrandSettingsChange | undefined
  ) => [...emailBrandKeys.all(), "preview", template, data, brand] as const,
};

/** The settings, where they started, the fonts, and which emails they reach. */
export function useEmailBrand() {
  return useQuery<BrandOverview, Error>({
    queryKey: emailBrandKeys.overview(),
    queryFn: getBrand,
  });
}

/**
 * Save a change to the settings. Every preview and the list of emails read
 * them, so both refetch.
 */
export function useUpdateEmailBrand() {
  const queryClient = useQueryClient();
  return useMutation<BrandSettings, Error, BrandSettingsChange>({
    mutationFn: updateBrand,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: emailBrandKeys.all() }),
        queryClient.invalidateQueries({ queryKey: emailTemplateKeys.all() }),
      ]);
    },
  });
}

/**
 * An email rendered with brand settings that may not be saved yet. The last
 * render stays on screen while the next one is made, so the preview doesn't
 * blank between changes.
 */
export function useBrandPreview(
  template: DraftPreviewTemplate | null,
  data: DraftPreviewData,
  brand: BrandSettingsChange | undefined
) {
  return useQuery<DraftPreviewResult, Error>({
    queryKey: template
      ? emailBrandKeys.preview(template, data, brand)
      : [...emailBrandKeys.all(), "preview", "none"],
    queryFn: () => previewDraft(template!, data, brand),
    enabled: template !== null,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
    retry: false,
  });
}
