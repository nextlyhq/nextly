"use client";

/**
 * ImageSizeForm
 *
 * Shared form component for the image-size create + edit pages.
 * Uses the SettingsSection / SettingsRow primitives so it visually
 * matches the rest of /admin/settings.
 */

import { zodResolver } from "@hookform/resolvers/zod";
import {
  Button,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@revnixhq/ui";
import { useEffect } from "react";
import { useForm, type Resolver } from "react-hook-form";
import { z } from "zod";

import { Loader2 } from "@admin/components/icons";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormMessage,
} from "@admin/components/ui/form";
import { Link } from "@admin/components/ui/link";
import { ROUTES } from "@admin/constants/routes";
import type { ImageSize } from "@admin/services/imageSizesApi";

import { SettingsRow } from "./SettingsRow";
import { SettingsSection } from "./SettingsSection";

// ============================================================
// Schema + Form Values
// ============================================================

const FIT_VALUES = ["inside", "cover", "contain", "fill"] as const;
const FORMAT_VALUES = ["auto", "webp", "jpeg", "png", "avif"] as const;

const imageSizeSchema = z
  .object({
    name: z
      .string()
      .min(1, "Name is required")
      .max(64, "Name must be 64 characters or less")
      .regex(
        /^[a-zA-Z0-9_-]+$/,
        "Only letters, numbers, hyphens and underscores are allowed"
      ),
    width: z
      .number()
      .int("Must be a whole number")
      .min(1, "Must be at least 1px")
      .max(10000, "Must be 10000px or less")
      .nullable(),
    height: z
      .number()
      .int("Must be a whole number")
      .min(1, "Must be at least 1px")
      .max(10000, "Must be 10000px or less")
      .nullable(),
    fit: z.enum(FIT_VALUES),
    format: z.enum(FORMAT_VALUES),
    quality: z
      .number()
      .int("Must be a whole number")
      .min(1, "Must be between 1 and 100")
      .max(100, "Must be between 1 and 100"),
  })
  .superRefine((data, ctx) => {
    if (data.width == null && data.height == null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Provide a width, height, or both",
        path: ["width"],
      });
    }
  });

export type ImageSizeFormValues = z.infer<typeof imageSizeSchema>;

const DEFAULT_VALUES: ImageSizeFormValues = {
  name: "",
  width: null,
  height: null,
  fit: "inside",
  format: "auto",
  quality: 80,
};

function imageSizeToFormValues(size: ImageSize): ImageSizeFormValues {
  return {
    name: size.name,
    width: size.width,
    height: size.height,
    fit: (FIT_VALUES.includes(size.fit as (typeof FIT_VALUES)[number])
      ? size.fit
      : "inside") as ImageSizeFormValues["fit"],
    format: (FORMAT_VALUES.includes(
      size.format as (typeof FORMAT_VALUES)[number]
    )
      ? size.format
      : "auto") as ImageSizeFormValues["format"],
    quality: size.quality,
  };
}

// ============================================================
// Component
// ============================================================

export interface ImageSizeFormProps {
  mode: "create" | "edit";
  imageSize?: ImageSize | null;
  isPending: boolean;
  onSubmit: (data: Partial<ImageSize>) => void;
}

export function ImageSizeForm({
  mode,
  imageSize,
  isPending,
  onSubmit,
}: ImageSizeFormProps) {
  const isEdit = mode === "edit";

  const form = useForm<ImageSizeFormValues>({
    resolver: zodResolver(
      imageSizeSchema
    ) as unknown as Resolver<ImageSizeFormValues>,
    defaultValues: imageSize
      ? imageSizeToFormValues(imageSize)
      : DEFAULT_VALUES,
  });

  // Repopulate form once data loads (edit mode)
  useEffect(() => {
    if (imageSize && isEdit) {
      form.reset(imageSizeToFormValues(imageSize));
    }
  }, [imageSize, isEdit, form]);

  const handleSubmit = (values: ImageSizeFormValues) => {
    const payload: Partial<ImageSize> = {
      name: values.name.trim(),
      width: values.width,
      height: values.height,
      fit: values.fit,
      format: values.format,
      quality: values.quality,
    };
    onSubmit(payload);
  };

  return (
    <Form {...form}>
      <form
        onSubmit={e => {
          void form.handleSubmit(handleSubmit)(e);
        }}
        className="space-y-6"
      >
        <SettingsSection label="Image Size">
          {/* Name */}
          <FormField
            control={form.control}
            name="name"
            render={({ field }) => (
              <FormItem>
                <SettingsRow
                  label="Name"
                  description="Used as the key in the API response. Cannot be changed after creation."
                >
                  <FormControl>
                    <Input
                      placeholder="e.g., thumbnail, medium, large"
                      disabled={isEdit || isPending}
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </SettingsRow>
              </FormItem>
            )}
          />

          {/* Width + Height — two columns inside one row */}
          <FormItem>
            <SettingsRow
              label="Dimensions"
              description="Leave one blank to keep aspect ratio. At least one dimension is required."
            >
              <div className="grid grid-cols-2 gap-3">
                <FormField
                  control={form.control}
                  name="width"
                  render={({ field }) => (
                    <FormItem>
                      <FormControl>
                        <Input
                          type="number"
                          placeholder="Width (px)"
                          min={1}
                          max={10000}
                          disabled={isPending}
                          value={field.value ?? ""}
                          onChange={e => {
                            const v = e.target.value;
                            field.onChange(v === "" ? null : Number(v));
                          }}
                          onBlur={field.onBlur}
                          name={field.name}
                          ref={field.ref}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="height"
                  render={({ field }) => (
                    <FormItem>
                      <FormControl>
                        <Input
                          type="number"
                          placeholder="Height (px)"
                          min={1}
                          max={10000}
                          disabled={isPending}
                          value={field.value ?? ""}
                          onChange={e => {
                            const v = e.target.value;
                            field.onChange(v === "" ? null : Number(v));
                          }}
                          onBlur={field.onBlur}
                          name={field.name}
                          ref={field.ref}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </SettingsRow>
          </FormItem>

          {/* Fit / Resize Mode */}
          <FormField
            control={form.control}
            name="fit"
            render={({ field }) => (
              <FormItem>
                <SettingsRow
                  label="Resize Mode"
                  description="How the image is resized to fit the target dimensions."
                >
                  <Select
                    value={field.value}
                    onValueChange={field.onChange}
                    disabled={isPending}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="inside">
                        Fit (shrink to fit, no cropping)
                      </SelectItem>
                      <SelectItem value="cover">
                        Cover (crop to fill exact size)
                      </SelectItem>
                      <SelectItem value="contain">
                        Contain (fit with padding)
                      </SelectItem>
                      <SelectItem value="fill">
                        Stretch (may distort)
                      </SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </SettingsRow>
              </FormItem>
            )}
          />

          {/* Format */}
          <FormField
            control={form.control}
            name="format"
            render={({ field }) => (
              <FormItem>
                <SettingsRow
                  label="Format"
                  description="Output format for the generated image."
                >
                  <Select
                    value={field.value}
                    onValueChange={field.onChange}
                    disabled={isPending}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="auto">
                        Auto (WebP when possible)
                      </SelectItem>
                      <SelectItem value="webp">WebP</SelectItem>
                      <SelectItem value="jpeg">JPEG</SelectItem>
                      <SelectItem value="png">PNG</SelectItem>
                      <SelectItem value="avif">AVIF</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </SettingsRow>
              </FormItem>
            )}
          />

          {/* Quality */}
          <FormField
            control={form.control}
            name="quality"
            render={({ field }) => (
              <FormItem>
                <SettingsRow
                  label="Quality"
                  description="Compression quality (1–100). Higher values produce larger but better-looking files."
                >
                  <FormControl>
                    <Input
                      type="number"
                      min={1}
                      max={100}
                      disabled={isPending}
                      value={field.value ?? ""}
                      onChange={e => {
                        const v = e.target.value;
                        field.onChange(v === "" ? 0 : Number(v));
                      }}
                      onBlur={field.onBlur}
                      name={field.name}
                      ref={field.ref}
                    />
                  </FormControl>
                  <FormMessage />
                </SettingsRow>
              </FormItem>
            )}
          />
        </SettingsSection>

        {/* Form Actions */}
        <div className="flex justify-end gap-3">
          <Link href={ROUTES.SETTINGS_IMAGE_SIZES}>
            <Button type="button" variant="outline" disabled={isPending}>
              Cancel
            </Button>
          </Link>
          <Button type="submit" disabled={isPending}>
            {isPending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                {isEdit ? "Updating..." : "Creating..."}
              </>
            ) : isEdit ? (
              "Update Image Size"
            ) : (
              "Create Image Size"
            )}
          </Button>
        </div>
      </form>
    </Form>
  );
}
