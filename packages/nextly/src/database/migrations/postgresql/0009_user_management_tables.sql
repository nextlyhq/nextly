-- Migration: Create Plan 12 system tables
-- This migration creates the user_field_definitions, email_providers, and email_templates
-- tables required by the User Management & Extendable User Schema feature (Plan 12).

-- ============================================================
-- user_field_definitions
-- Stores metadata for custom user fields that extend the base user model.
-- Fields can be sourced from defineConfig() (code) or admin Settings UI (ui).
-- ============================================================

CREATE TABLE IF NOT EXISTS "user_field_definitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"name" varchar(255) NOT NULL,
	"label" varchar(255) NOT NULL,
	"type" varchar(50) NOT NULL,
	"required" boolean NOT NULL DEFAULT false,
	"default_value" varchar(255),
	"options" jsonb,
	"placeholder" varchar(255),
	"description" text,
	"sort_order" integer NOT NULL DEFAULT 0,
	"source" varchar(10) NOT NULL DEFAULT 'ui',
	"is_active" boolean NOT NULL DEFAULT true,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "user_field_defs_name_unique_idx" ON "user_field_definitions" USING btree ("name");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_field_defs_source_idx" ON "user_field_definitions" USING btree ("source");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_field_defs_is_active_idx" ON "user_field_definitions" USING btree ("is_active");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_field_defs_sort_order_idx" ON "user_field_definitions" USING btree ("sort_order");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_field_defs_created_at_idx" ON "user_field_definitions" USING btree ("created_at");
--> statement-breakpoint

-- ============================================================
-- email_providers
-- Stores email provider configurations (SMTP, Resend, SendLayer)
-- managed via the admin Settings UI.
-- ============================================================

CREATE TABLE IF NOT EXISTS "email_providers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"name" varchar(255) NOT NULL,
	"type" varchar(50) NOT NULL,
	"from_email" varchar(255) NOT NULL,
	"from_name" varchar(255),
	"configuration" jsonb NOT NULL,
	"is_default" boolean NOT NULL DEFAULT false,
	"is_active" boolean NOT NULL DEFAULT true,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "email_providers_type_idx" ON "email_providers" USING btree ("type");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "email_providers_default_unique_idx" ON "email_providers" ("is_default") WHERE "is_default" = true;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "email_providers_is_active_idx" ON "email_providers" USING btree ("is_active");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "email_providers_created_at_idx" ON "email_providers" USING btree ("created_at");
--> statement-breakpoint

-- ============================================================
-- email_templates
-- Stores email templates with {{variable}} interpolation support,
-- managed via the admin Settings UI.
-- ============================================================

CREATE TABLE IF NOT EXISTS "email_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"name" varchar(255) NOT NULL,
	"slug" varchar(255) NOT NULL UNIQUE,
	"subject" text NOT NULL,
	"html_content" text NOT NULL,
	"plain_text_content" text,
	"variables" jsonb,
	"use_layout" boolean NOT NULL DEFAULT true,
	"is_active" boolean NOT NULL DEFAULT true,
	"provider_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "email_templates_is_active_idx" ON "email_templates" USING btree ("is_active");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "email_templates_provider_id_idx" ON "email_templates" USING btree ("provider_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "email_templates_created_at_idx" ON "email_templates" USING btree ("created_at");
