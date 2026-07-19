-- Update dynamic collection: dc_notes

CREATE TABLE "dc_notes_locales" (
  "_parent" TEXT NOT NULL,
  "_locale" VARCHAR(20) NOT NULL,
  "_status" VARCHAR(20) NOT NULL DEFAULT 'draft',
  "body" TEXT,
  PRIMARY KEY ("_parent", "_locale"),
  FOREIGN KEY ("_parent") REFERENCES "dc_notes" ("id") ON DELETE CASCADE
);