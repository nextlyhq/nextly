-- Migration: Make media.uploaded_by nullable
-- CLI seeds, data imports, and other system-context uploads may not have a
-- user to attribute the upload to. Dropping NOT NULL lets these operations
-- record media without a synthetic "anonymous" user sentinel (which doesn't
-- exist as a row and broke the foreign-key constraint).

-- UP

ALTER TABLE "media" ALTER COLUMN "uploaded_by" DROP NOT NULL;

-- DOWN
-- Restore NOT NULL. Rows with NULL uploaded_by must be backfilled before
-- running DOWN; ALTER ... SET NOT NULL fails if any nulls exist.

ALTER TABLE "media" ALTER COLUMN "uploaded_by" SET NOT NULL;
