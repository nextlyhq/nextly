"use client";

import { Alert, AlertDescription, Button, Skeleton } from "@revnixhq/ui";
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
      <PageContainer>
        <SettingsLayout>
          <Alert variant="destructive">
            <AlertDescription>
              Invalid image size ID. Please go back and try again.
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

  // Loading state
  if (isLoading) {
    return (
      <PageContainer>
        <SettingsLayout>
          <div className="space-y-6">
            <div className="flex items-center gap-4">
              <Skeleton className="w-9 rounded-none" />
              <div className="space-y-2">
                <Skeleton className="h-6 w-48" />
                <Skeleton className="h-4 w-72" />
              </div>
            </div>
            <Skeleton className="h-[500px] w-full rounded-none" />
          </div>
        </SettingsLayout>
      </PageContainer>
    );
  }

  // Error state
  if (fetchError) {
    return (
      <PageContainer>
        <SettingsLayout>
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
      <PageContainer>
        <SettingsLayout>
          <Alert variant="destructive">
            <AlertDescription>
              Image size not found. It may have been deleted.
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

  return (
    <QueryErrorBoundary fallback={<PageErrorFallback />}>
      <PageContainer>
        <SettingsLayout>
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
