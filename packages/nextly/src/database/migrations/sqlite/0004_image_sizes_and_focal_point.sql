-- Migration: Add image_sizes table and focal point / sizes columns to media (SQLite)

-- UP

CREATE TABLE IF NOT EXISTS "image_sizes" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"width" integer,
	"height" integer,
	"fit" text NOT NULL DEFAULT 'inside',
	"quality" integer NOT NULL DEFAULT 80,
	"format" text NOT NULL DEFAULT 'auto',
	"is_default" integer NOT NULL DEFAULT 1,
	"sort_order" integer NOT NULL DEFAULT 0,
	"created_at" integer NOT NULL,
	"updated_at" integer NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "image_sizes_name_unique" ON "image_sizes" ("name");

ALTER TABLE "media" ADD COLUMN "focal_x" integer;
ALTER TABLE "media" ADD COLUMN "focal_y" integer;
ALTER TABLE "media" ADD COLUMN "sizes" text;

-- DOWN

-- SQLite does not support DROP COLUMN before 3.35.0
-- For older versions, recreate the table without the columns
DROP TABLE IF EXISTS "image_sizes";
