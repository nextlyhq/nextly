-- Migration: Add media folders support
-- Date: 2025-11-16
-- Description: Adds media_folders table and folder_id column to media table

-- Create media_folders table
CREATE TABLE "media_folders" (
	"id" text PRIMARY KEY NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"parent_id" text,
	"created_by" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);

-- Add foreign key constraints for media_folders
ALTER TABLE "media_folders" ADD CONSTRAINT "media_folders_parent_id_media_folders_id_fk"
  FOREIGN KEY ("parent_id") REFERENCES "public"."media_folders"("id") ON DELETE cascade ON UPDATE no action;

ALTER TABLE "media_folders" ADD CONSTRAINT "media_folders_created_by_users_id_fk"
  FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;

-- Create indexes for media_folders
CREATE INDEX "media_folders_parent_id_idx" ON "media_folders" USING btree ("parent_id");
CREATE INDEX "media_folders_created_by_idx" ON "media_folders" USING btree ("created_by");
CREATE INDEX "media_folders_created_at_idx" ON "media_folders" USING btree ("created_at");

-- Add folder_id column to media table
ALTER TABLE "media" ADD COLUMN "folder_id" text;

-- Add foreign key constraint for media.folder_id
ALTER TABLE "media" ADD CONSTRAINT "media_folder_id_media_folders_id_fk"
  FOREIGN KEY ("folder_id") REFERENCES "public"."media_folders"("id") ON DELETE set null ON UPDATE no action;

-- Create index for media.folder_id
CREATE INDEX "media_folder_id_idx" ON "media" USING btree ("folder_id");
