-- Migration: Add image_sizes table and focal point / sizes columns to media
-- Supports named image sizes (like Payload/WordPress) and crop point for smart cropping.
-- Image sizes can be configured via code (nextly.config.ts) or admin UI (Settings).

-- UP

CREATE TABLE IF NOT EXISTS "image_sizes" (
	"id" text PRIMARY KEY NOT NULL,
	"name" varchar(50) NOT NULL,
	"width" integer,
	"height" integer,
	"fit" varchar(20) NOT NULL DEFAULT 'inside',
	"quality" integer NOT NULL DEFAULT 80,
	"format" varchar(10) NOT NULL DEFAULT 'auto',
	"is_default" boolean NOT NULL DEFAULT true,
	"sort_order" integer NOT NULL DEFAULT 0,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "image_sizes_name_unique" ON "image_sizes" USING btree ("name");

ALTER TABLE "media" ADD COLUMN IF NOT EXISTS "focal_x" integer;
ALTER TABLE "media" ADD COLUMN IF NOT EXISTS "focal_y" integer;
ALTER TABLE "media" ADD COLUMN IF NOT EXISTS "sizes" jsonb;

-- DOWN

ALTER TABLE "media" DROP COLUMN IF EXISTS "sizes";
ALTER TABLE "media" DROP COLUMN IF EXISTS "focal_y";
ALTER TABLE "media" DROP COLUMN IF EXISTS "focal_x";
DROP INDEX IF EXISTS "image_sizes_name_unique";
DROP TABLE IF EXISTS "image_sizes";
