\set ON_ERROR_STOP on
BEGIN;
ALTER TABLE videos ADD COLUMN IF NOT EXISTS analysis_key text UNIQUE;
ALTER TABLE videos ADD COLUMN IF NOT EXISTS analysis_metadata jsonb NOT NULL DEFAULT '{}';
ALTER TABLE tracklets ADD COLUMN IF NOT EXISTS thumbnail_samples jsonb NOT NULL DEFAULT '[]'
 CHECK(jsonb_typeof(thumbnail_samples)='array');
COMMIT;
