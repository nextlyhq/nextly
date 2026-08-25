"use client";

import { Alert, AlertDescription, Button, Skeleton } from "@nextlyhq/ui";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useState } from "react";

import { ImageSizeForm } from "@admin/components/features/settings/ImageSizeForm";
import { SettingsLayout } from "@admin/components/features/settings/SettingsLayout";
import { PageContainer } from "@admin/components/layout/page-container";
import { PageErrorFallback } from "@admin/components/shared/error-fallbacks";
import { QueryErrorBoundary } from "@admin/components/shared/query-error-boundary";
import { toast } from "@admin/components/ui";
import { Link } from "@admin/components/ui/link";
import { ROUTES } from "@admin/constants/routes";
import { useRouter } from "@admin/hooks/useRouter";
import { getErrorMessage } from "@admin/lib/errors/error-types";
import { navigateTo } from "@admin/lib/navigation";
import { validateUUID } from "@admin/lib/validation";
import {
  fetchImageSize,
  updateImageSize,
  type ImageSize,
} from "@admin/services/imageSizesApi";

/**
 * The page in its refused state: one message, and the way back.
 *
 * Both refusals — no id in the route, and an id that resolves to nothing —
 * render the identical page around a different sentence, so the page is
 * written once and the sentence is the argument.
 */
function ImageSizeErrorPage({ message }: { message: string }) {
  return (
    <PageContainer width="form">
      <SettingsLayout {...IMAGE_SIZES_PAGE}>
        <Alert variant="destructive">
          <AlertDescription>{message}</AlertDescription>
        </Alert>
        <div className="mt-4">
          <Link href={ROUTES.SETTINGS_IMAGE_SIZES}>
            <Button variant="outline">Back to Image Sizes</Button>
          </Link>
        </div>
      </SettingsLayout>
    </PageContainer>
  );
}

export default function EditImageSizePage() {
  const { route } = useRouter();
  const [isPending, setIsPending] = useState(false);

  // Extract and validate image-size id from route params
  const rawId =
    route?.params?.id && typeof route.params.id === "string"
      ? route.params.id
      : null;
  const imageSizeId = validateUUID(rawId);

  // Fetch image size data
  const {
    data: imageSize,
    isLoading,
    error: fetchError,
    refetch,
  } = useQuery<ImageSize | null, Error>({
    queryKey: ["imageSize", imageSizeId],
    queryFn: () =>
      imageSizeId ? fetchImageSize(imageSizeId) : Promise.resolve(null),
    enabled: !!imageSizeId,
  });

  const handleSubmit = useCallback(
    async (data: Partial<ImageSize>) => {
      if (!imageSizeId) return;

      // Name is immutable in edit mode (matches the previous dialog behaviour
      // and the "Used as the key in the API response" contract).
      const { name: _ignored, ...rest } = data;
      const dataToUpdate: Partial<ImageSize> = rest;

      setIsPending(true);
      try {
        await updateImageSize(imageSizeId, dataToUpdate);
        toast.success("Image size updated", {
          description: `${data.name ?? "Image size"} has been updated successfully.`,
        });
        navigateTo(ROUTES.SETTINGS_IMAGE_SIZES);
      } catch (error) {
        toast.error("Failed to update image size", {
          description: getErrorMessage(
            error,
            "An error occurred while updating the image size."
          ),
        });
      } finally {
        setIsPending(false);
      }
    },
    [imageSizeId]
  );

  // Invalid ID
  if (!imageSizeId) {
    return (
      <ImageSizeErrorPage message="Invalid image size ID. Please go back and try again." />
    );
  }

  // Loading state
  if (isLoading) {
    return (
      <PageContainer width="form">
        <SettingsLayout {...IMAGE_SIZES_PAGE}>
          <div className="space-y-6">
            <div className="flex items-center gap-4">
              <Skeleton className="w-9 rounded-md" />
              <div className="space-y-2">
                <Skeleton className="h-6 w-48" />
                <Skeleton className="h-4 w-72" />
              </div>
            </div>
            <Skeleton className="h-[500px] w-full rounded-lg" />
          </div>
        </SettingsLayout>
      </PageContainer>
    );
  }

  // Error state
  if (fetchError) {
    return (
      <PageContainer width="form">
        <SettingsLayout {...IMAGE_SIZES_PAGE}>
          <Alert variant="destructive">
            <AlertDescription className="flex items-center justify-between">
              <span>
                {getErrorMessage(
                  fetchError,
                  "Failed to load image size details."
                )}
              </span>
              <Button
                size="md"
                variant="outline"
                onClick={() => {
                  void refetch();
                }}
                className="ml-2"
              >
                Retry
              </Button>
            </AlertDescription>
          </Alert>
          <div className="mt-4">
            <Link href={ROUTES.SETTINGS_IMAGE_SIZES}>
              <Button variant="outline">Back to Image Sizes</Button>
            </Link>
          </div>
        </SettingsLayout>
      </PageContainer>
    );
  }

  // Not found
  if (!imageSize) {
    return (
      <ImageSizeErrorPage message="Image size not found. It may have been deleted." />
    );
  }

  return (
    <QueryErrorBoundary fallback={<PageErrorFallback />}>
      <PageContainer width="form">
        <SettingsLayout {...IMAGE_SIZES_PAGE}>
          <ImageSizeForm
            mode="edit"
            imageSize={imageSize}
            isPending={isPending}
            onSubmit={data => {
              void handleSubmit(data);
            }}
          />
        </SettingsLayout>
      </PageContainer>
    </QueryErrorBoundary>
  );
}

/**
 * This page renders the settings chrome in several branches — loading,
 * error and the resolved document — and its identity is the same in all of
 * them. Stated once here so the branches cannot drift apart.
 */
const IMAGE_SIZES_PAGE = {
  title: "Image Sizes",
  description: "Configure image sizes generated for uploaded images",
  crumb: "Image Sizes",
} as const;
