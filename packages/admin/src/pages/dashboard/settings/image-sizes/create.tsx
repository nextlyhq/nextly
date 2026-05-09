"use client";

import { useCallback, useState } from "react";

import { ImageSizeForm } from "@admin/components/features/settings/ImageSizeForm";
import { SettingsLayout } from "@admin/components/features/settings/SettingsLayout";
import { PageContainer } from "@admin/components/layout/page-container";
import { PageErrorFallback } from "@admin/components/shared/error-fallbacks";
import { QueryErrorBoundary } from "@admin/components/shared/query-error-boundary";
import { toast } from "@admin/components/ui";
import { ROUTES } from "@admin/constants/routes";
import { getErrorMessage } from "@admin/lib/errors/error-types";
import { navigateTo } from "@admin/lib/navigation";
import { createImageSize, type ImageSize } from "@admin/services/imageSizesApi";

export default function CreateImageSizePage() {
  const [isPending, setIsPending] = useState(false);

  const handleSubmit = useCallback(async (data: Partial<ImageSize>) => {
    setIsPending(true);
    try {
      await createImageSize(data);
      toast.success("Image size created", {
        description: `${data.name ?? "Image size"} has been created successfully.`,
      });
      navigateTo(ROUTES.SETTINGS_IMAGE_SIZES);
    } catch (error) {
      toast.error("Failed to create image size", {
        description: getErrorMessage(
          error,
          "An error occurred while creating the image size."
        ),
      });
    } finally {
      setIsPending(false);
    }
  }, []);

  return (
    <QueryErrorBoundary fallback={<PageErrorFallback />}>
      <PageContainer>
        <SettingsLayout>
          <ImageSizeForm
            mode="create"
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
