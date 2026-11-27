\set ON_ERROR_STOP on
BEGIN;
-- No CASCADE: unexpected dependencies abort removal and preserve other objects.
DROP TABLE IF EXISTS benchmark.detections;
DROP TABLE IF EXISTS benchmark.runs;
DROP SCHEMA IF EXISTS benchmark;
COMMIT;
