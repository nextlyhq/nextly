-- PostgreSQL Extensions for Nextly
-- These extensions are created automatically when the database first initializes
-- This file is executed by docker-entrypoint-initdb.d on first container startup

-- ═══════════════════════════════════════════════
-- UUID Generation
-- ═══════════════════════════════════════════════
-- Provides UUID generation functions (uuid_generate_v4, etc.)
-- Used for primary keys and unique identifiers
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ═══════════════════════════════════════════════
-- Full-Text Search
-- ═══════════════════════════════════════════════
-- Trigram matching for similarity searches and fuzzy text search
-- Used for content search, autocomplete, typo-tolerant search
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- ═══════════════════════════════════════════════
-- JSON Indexing
-- ═══════════════════════════════════════════════
-- GIN indexes for JSONB columns
-- Improves performance of JSON queries
CREATE EXTENSION IF NOT EXISTS "btree_gin";

-- ═══════════════════════════════════════════════
-- Text Search Normalization
-- ═══════════════════════════════════════════════
-- Removes accents from text for better search
-- Example: "café" → "cafe"
CREATE EXTENSION IF NOT EXISTS "unaccent";

-- ═══════════════════════════════════════════════
-- Verification
-- ═══════════════════════════════════════════════
-- Log installed extensions
DO $$
DECLARE
    ext RECORD;
BEGIN
    RAISE NOTICE '════════════════════════════════════════';
    RAISE NOTICE 'Nextly - PostgreSQL Extensions';
    RAISE NOTICE '════════════════════════════════════════';
    FOR ext IN SELECT extname, extversion FROM pg_extension WHERE extname IN ('uuid-ossp', 'pg_trgm', 'btree_gin', 'unaccent') ORDER BY extname
    LOOP
        RAISE NOTICE '✓ % (version %)', ext.extname, ext.extversion;
    END LOOP;
    RAISE NOTICE '════════════════════════════════════════';
END $$;
