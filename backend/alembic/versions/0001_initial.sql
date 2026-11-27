-- LEFT 초기 스키마(openapi 1.1.0 기준, 20개 테이블). tools/dump_schema_sql.py로 생성.
-- 이후 변경은 이 파일을 고치지 말고 새 Alembic 리비전으로 추가한다.
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pgcrypto;


CREATE TABLE hazard_zones (
  id SERIAL NOT NULL, 
  name VARCHAR(100) NOT NULL, 
  kind VARCHAR(20) NOT NULL, 
  severity VARCHAR(10) NOT NULL, 
  description TEXT DEFAULT '' NOT NULL, 
  area geography(POLYGON,4326) NOT NULL, 
  version INTEGER DEFAULT 1 NOT NULL, 
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
  PRIMARY KEY (id), 
  CONSTRAINT hazard_zones_kind_check CHECK (kind IN ('water','steep_slope','road','construction','other')), 
  CONSTRAINT hazard_zones_severity_check CHECK (severity IN ('low','medium','high'))
);

CREATE INDEX hazard_zones_area_idx ON hazard_zones USING gist (area);

CREATE TABLE nodes (
  id SERIAL NOT NULL, 
  kind VARCHAR(10) NOT NULL, 
  name VARCHAR(100) NOT NULL, 
  location geography(POINT,4326) NOT NULL, 
  scope VARCHAR(10) DEFAULT 'global' NOT NULL, 
  case_id INTEGER, 
  version INTEGER DEFAULT 1 NOT NULL, 
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
  PRIMARY KEY (id), 
  CONSTRAINT nodes_kind_check CHECK (kind IN ('camera','waypoint')), 
  CONSTRAINT nodes_scope_check CHECK (scope IN ('global','case')), 
  CONSTRAINT nodes_scope_case_check CHECK ((scope='case') = (case_id IS NOT NULL)), 
  CONSTRAINT nodes_case_camera_check CHECK (scope='global' OR kind='camera')
);

CREATE INDEX nodes_location_idx ON nodes USING gist (location);

CREATE TABLE users (
  id SERIAL NOT NULL, 
  username VARCHAR(50) NOT NULL, 
  display_name VARCHAR(50) NOT NULL, 
  password_hash VARCHAR(255) NOT NULL, 
  role VARCHAR(10) DEFAULT 'user' NOT NULL, 
  active BOOLEAN DEFAULT true NOT NULL, 
  must_change_password BOOLEAN DEFAULT true NOT NULL, 
  deactivated_at TIMESTAMP WITH TIME ZONE, 
  deactivation_reason TEXT, 
  version INTEGER DEFAULT 1 NOT NULL, 
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
  PRIMARY KEY (id), 
  CONSTRAINT users_role_check CHECK (role IN ('user','admin')), 
  CONSTRAINT users_deactivated_check CHECK (active OR deactivated_at IS NOT NULL), 
  UNIQUE (username)
);

CREATE TABLE audit_logs (
  id BIGSERIAL NOT NULL, 
  occurred_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
  actor_user_id INTEGER, 
  actor_name VARCHAR(50), 
  case_id INTEGER, 
  action VARCHAR(50) NOT NULL, 
  resource_type VARCHAR(30) NOT NULL, 
  resource_id VARCHAR(64), 
  request_id VARCHAR(128) NOT NULL, 
  result VARCHAR(10) NOT NULL, 
  changed_fields VARCHAR(50)[] DEFAULT '{}' NOT NULL, 
  PRIMARY KEY (id), 
  CONSTRAINT audit_logs_result_check CHECK (result IN ('success','failure')), 
  FOREIGN KEY(actor_user_id) REFERENCES users (id)
);

CREATE INDEX audit_logs_actor_idx ON audit_logs (actor_user_id);

CREATE INDEX audit_logs_case_idx ON audit_logs (case_id);

CREATE INDEX audit_logs_time_idx ON audit_logs (occurred_at DESC, id DESC);

CREATE TABLE cameras (
  node_id INTEGER NOT NULL, 
  heading_deg FLOAT(24) NOT NULL, 
  fov_deg FLOAT(24) NOT NULL, 
  edge_node_map JSONB DEFAULT '{}'::jsonb NOT NULL, 
  stream_url TEXT, 
  PRIMARY KEY (node_id), 
  CONSTRAINT cameras_heading_check CHECK (heading_deg >= 0 AND heading_deg < 360), 
  CONSTRAINT cameras_fov_check CHECK (fov_deg > 0 AND fov_deg <= 360), 
  CONSTRAINT cameras_edge_map_check CHECK (jsonb_typeof(edge_node_map)='object'), 
  FOREIGN KEY(node_id) REFERENCES nodes (id) ON DELETE CASCADE
);

CREATE TABLE idempotency_keys (
  user_id INTEGER NOT NULL, 
  operation VARCHAR(80) NOT NULL, 
  key VARCHAR(128) NOT NULL, 
  request_hash VARCHAR(64) NOT NULL, 
  state VARCHAR(12) DEFAULT 'in_progress' NOT NULL, 
  response_status SMALLINT, 
  response_body JSONB, 
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL, 
  PRIMARY KEY (user_id, operation, key), 
  CONSTRAINT idempotency_keys_state_check CHECK (state IN ('in_progress','completed')), 
  FOREIGN KEY(user_id) REFERENCES users (id) ON DELETE CASCADE
);

CREATE INDEX idempotency_keys_expires_idx ON idempotency_keys (expires_at);

CREATE TABLE retention_policy (
  id SMALLINT DEFAULT 1 NOT NULL, 
  video_retention_days INTEGER, 
  closed_case_retention_days INTEGER, 
  alert_retention_days INTEGER, 
  audit_retention_days INTEGER, 
  version INTEGER DEFAULT 1 NOT NULL, 
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
  updated_by INTEGER, 
  PRIMARY KEY (id), 
  CONSTRAINT retention_policy_single_row_check CHECK (id = 1), 
  FOREIGN KEY(updated_by) REFERENCES users (id)
);

CREATE TABLE route_edges (
  id SERIAL NOT NULL, 
  from_node_id INTEGER NOT NULL, 
  to_node_id INTEGER NOT NULL, 
  distance_m FLOAT(24), 
  duration_s FLOAT(24), 
  path geography(LINESTRING,4326), 
  source VARCHAR(10) NOT NULL, 
  status VARCHAR(15) NOT NULL, 
  straight_distance_m FLOAT(24), 
  suspected_detour BOOLEAN DEFAULT false NOT NULL, 
  correction_factor FLOAT(24) DEFAULT 1 NOT NULL, 
  error_code VARCHAR(50), 
  version INTEGER DEFAULT 1 NOT NULL, 
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
  PRIMARY KEY (id), 
  CONSTRAINT route_edges_pair_key UNIQUE (from_node_id, to_node_id), 
  CONSTRAINT route_edges_order_check CHECK (from_node_id < to_node_id), 
  CONSTRAINT route_edges_source_check CHECK (source IN ('api','manual')), 
  CONSTRAINT route_edges_status_check CHECK (status IN ('ok','needs_manual')), 
  CONSTRAINT route_edges_distance_check CHECK (distance_m IS NULL OR distance_m >= 0), 
  CONSTRAINT route_edges_duration_check CHECK (duration_s IS NULL OR duration_s >= 0), 
  CONSTRAINT route_edges_factor_check CHECK (correction_factor > 0), 
  CONSTRAINT route_edges_ok_check CHECK (status <> 'ok' OR (distance_m IS NOT NULL AND duration_s IS NOT NULL AND path IS NOT NULL)), 
  FOREIGN KEY(from_node_id) REFERENCES nodes (id) ON DELETE CASCADE, 
  FOREIGN KEY(to_node_id) REFERENCES nodes (id) ON DELETE CASCADE
);

CREATE TABLE sessions (
  token_hash VARCHAR(64) NOT NULL, 
  user_id INTEGER NOT NULL, 
  csrf_token VARCHAR(64) NOT NULL, 
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
  last_seen_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL, 
  absolute_expires_at TIMESTAMP WITH TIME ZONE NOT NULL, 
  revoked_at TIMESTAMP WITH TIME ZONE, 
  revoked_reason VARCHAR(30), 
  PRIMARY KEY (token_hash), 
  FOREIGN KEY(user_id) REFERENCES users (id) ON DELETE CASCADE
);

CREATE INDEX sessions_user_idx ON sessions (user_id);

CREATE TABLE system_settings (
  id SMALLINT DEFAULT 1 NOT NULL, 
  walking_speed_presets JSONB DEFAULT '[]'::jsonb NOT NULL, 
  default_similarity_threshold FLOAT(24), 
  alert_high_threshold FLOAT(24), 
  out_of_filter_threshold FLOAT(24), 
  area_level_ratios JSONB DEFAULT '[]'::jsonb NOT NULL, 
  area_buffer_m FLOAT(24), 
  max_upload_bytes BIGINT, 
  version INTEGER DEFAULT 1 NOT NULL, 
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
  updated_by INTEGER, 
  PRIMARY KEY (id), 
  CONSTRAINT system_settings_single_row_check CHECK (id = 1), 
  CONSTRAINT system_settings_default_check CHECK (default_similarity_threshold IS NULL OR default_similarity_threshold BETWEEN 0 AND 1), 
  CONSTRAINT system_settings_high_check CHECK (alert_high_threshold IS NULL OR alert_high_threshold BETWEEN 0 AND 1), 
  CONSTRAINT system_settings_oof_check CHECK (out_of_filter_threshold IS NULL OR out_of_filter_threshold BETWEEN 0 AND 1), 
  CONSTRAINT system_settings_order_check CHECK (default_similarity_threshold IS NULL OR alert_high_threshold IS NULL OR default_similarity_threshold < alert_high_threshold), 
  CONSTRAINT system_settings_buffer_check CHECK (area_buffer_m IS NULL OR area_buffer_m > 0), 
  FOREIGN KEY(updated_by) REFERENCES users (id)
);

CREATE TABLE videos (
  id SERIAL NOT NULL, 
  camera_id INTEGER NOT NULL, 
  case_id INTEGER, 
  uploaded_by INTEGER, 
  file_path TEXT NOT NULL, 
  playback_path TEXT, 
  file_sha256 VARCHAR(64), 
  size_bytes BIGINT, 
  recorded_start_at TIMESTAMP WITH TIME ZONE NOT NULL, 
  duration_s FLOAT(24), 
  fps FLOAT(24), 
  width_px INTEGER, 
  height_px INTEGER, 
  status VARCHAR(10) DEFAULT 'queued' NOT NULL, 
  stage VARCHAR(12) DEFAULT 'queued' NOT NULL, 
  progress SMALLINT DEFAULT 0 NOT NULL, 
  task_id UUID, 
  attempt_seq INTEGER DEFAULT 0 NOT NULL, 
  processed_samples INTEGER DEFAULT 0 NOT NULL, 
  total_samples INTEGER, 
  skipped_samples INTEGER DEFAULT 0 NOT NULL, 
  sample_interval_s FLOAT(24), 
  model_name VARCHAR(50), 
  error_code VARCHAR(50), 
  error_message TEXT, 
  heartbeat_at TIMESTAMP WITH TIME ZONE, 
  analysis_key TEXT, 
  analysis_metadata JSONB DEFAULT '{}'::jsonb NOT NULL, 
  warnings JSONB DEFAULT '[]'::jsonb NOT NULL, 
  lifecycle VARCHAR(15) DEFAULT 'active' NOT NULL, 
  retain_until TIMESTAMP WITH TIME ZONE, 
  hold BOOLEAN DEFAULT false NOT NULL, 
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
  PRIMARY KEY (id), 
  CONSTRAINT videos_id_camera_id_key UNIQUE (id, camera_id), 
  CONSTRAINT videos_status_check CHECK (status IN ('queued','running','done','failed')), 
  CONSTRAINT videos_stage_check CHECK (stage IN ('queued','preparing','converting','analyzing','saving','done','failed')), 
  CONSTRAINT videos_progress_check CHECK (progress BETWEEN 0 AND 100), 
  CONSTRAINT videos_duration_check CHECK (duration_s IS NULL OR duration_s > 0), 
  CONSTRAINT videos_fps_check CHECK (fps IS NULL OR fps > 0), 
  CONSTRAINT videos_lifecycle_check CHECK (lifecycle IN ('active','delete_pending')), 
  FOREIGN KEY(camera_id) REFERENCES cameras (node_id), 
  FOREIGN KEY(uploaded_by) REFERENCES users (id), 
  UNIQUE (analysis_key)
);

CREATE INDEX videos_camera_time_idx ON videos (camera_id, recorded_start_at);

CREATE INDEX videos_case_idx ON videos (case_id);

CREATE TABLE tracklets (
  id BIGSERIAL NOT NULL, 
  video_id INTEGER NOT NULL, 
  camera_id INTEGER NOT NULL, 
  track_no INTEGER NOT NULL, 
  start_at TIMESTAMP WITH TIME ZONE NOT NULL, 
  end_at TIMESTAMP WITH TIME ZONE NOT NULL, 
  entry_node_id INTEGER, 
  exit_node_id INTEGER, 
  trajectory JSONB DEFAULT '[]'::jsonb NOT NULL, 
  thumbnail_path TEXT NOT NULL, 
  thumbnail_samples JSONB DEFAULT '[]'::jsonb NOT NULL, 
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
  PRIMARY KEY (id), 
  CONSTRAINT tracklets_video_id_track_no_key UNIQUE (video_id, track_no), 
  CONSTRAINT tracklets_video_fkey FOREIGN KEY(video_id, camera_id) REFERENCES videos (id, camera_id) ON DELETE CASCADE, 
  CONSTRAINT tracklets_time_check CHECK (end_at >= start_at), 
  CONSTRAINT tracklets_samples_check CHECK (jsonb_typeof(thumbnail_samples)='array'), 
  FOREIGN KEY(camera_id) REFERENCES cameras (node_id), 
  FOREIGN KEY(entry_node_id) REFERENCES nodes (id), 
  FOREIGN KEY(exit_node_id) REFERENCES nodes (id)
);

CREATE INDEX tracklets_camera_time_idx ON tracklets (camera_id, start_at);

CREATE TABLE cases (
  id SERIAL NOT NULL, 
  title VARCHAR(150) NOT NULL, 
  person_type VARCHAR(10) NOT NULL, 
  person_name VARCHAR(50) NOT NULL, 
  person_age SMALLINT, 
  description TEXT DEFAULT '' NOT NULL, 
  appearance TEXT DEFAULT '' NOT NULL, 
  last_seen_at TIMESTAMP WITH TIME ZONE NOT NULL, 
  last_seen_location geography(POINT,4326) NOT NULL, 
  last_seen_place_name VARCHAR(200), 
  origin_node_id INTEGER, 
  owner_id INTEGER NOT NULL, 
  status VARCHAR(10) DEFAULT 'open' NOT NULL, 
  close_outcome VARCHAR(12), 
  close_reason TEXT, 
  closed_at TIMESTAMP WITH TIME ZONE, 
  closed_by INTEGER, 
  found_at TIMESTAMP WITH TIME ZONE, 
  query_status VARCHAR(10) DEFAULT 'not_set' NOT NULL, 
  query_source VARCHAR(10), 
  query_version INTEGER DEFAULT 1 NOT NULL, 
  query_tracklet_id BIGINT, 
  query_photo_path TEXT, 
  query_person_bbox JSONB, 
  query_embedding VECTOR, 
  query_model_name VARCHAR(50), 
  query_task_id UUID, 
  query_error_code VARCHAR(50), 
  query_updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
  similarity_threshold FLOAT(24) NOT NULL, 
  conditions_version INTEGER DEFAULT 1 NOT NULL, 
  conditions_updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
  watch_enabled BOOLEAN DEFAULT false NOT NULL, 
  retain_until TIMESTAMP WITH TIME ZONE, 
  version INTEGER DEFAULT 1 NOT NULL, 
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
  PRIMARY KEY (id), 
  CONSTRAINT cases_person_type_check CHECK (person_type IN ('adult','child','elderly','other')), 
  CONSTRAINT cases_person_age_check CHECK (person_age IS NULL OR person_age BETWEEN 0 AND 150), 
  CONSTRAINT cases_status_check CHECK (status IN ('open','closed')), 
  CONSTRAINT cases_close_check CHECK ((status='open' AND close_outcome IS NULL AND closed_at IS NULL) OR (status='closed' AND close_outcome IN ('found','unresolved','other') AND closed_at IS NOT NULL)), 
  CONSTRAINT cases_found_check CHECK (close_outcome IS DISTINCT FROM 'found' OR found_at IS NOT NULL), 
  CONSTRAINT cases_watch_check CHECK (status='open' OR NOT watch_enabled), 
  CONSTRAINT cases_query_status_check CHECK (query_status IN ('not_set','queued','running','ready','failed')), 
  CONSTRAINT cases_query_source_check CHECK (query_source IS NULL OR query_source IN ('photo','tracklet')), 
  CONSTRAINT cases_query_ready_check CHECK (query_status <> 'ready' OR (query_embedding IS NOT NULL AND query_model_name IS NOT NULL)), 
  CONSTRAINT cases_query_norm_check CHECK (query_embedding IS NULL OR vector_norm(query_embedding) > 0), 
  CONSTRAINT cases_threshold_check CHECK (similarity_threshold BETWEEN 0 AND 1), 
  FOREIGN KEY(origin_node_id) REFERENCES nodes (id) ON DELETE SET NULL, 
  FOREIGN KEY(owner_id) REFERENCES users (id), 
  FOREIGN KEY(closed_by) REFERENCES users (id), 
  FOREIGN KEY(query_tracklet_id) REFERENCES tracklets (id) ON DELETE SET NULL
);

CREATE INDEX cases_owner_idx ON cases (owner_id);

CREATE TABLE tracklet_embeddings (
  tracklet_id BIGINT NOT NULL, 
  model_name VARCHAR(50) NOT NULL, 
  embedding VECTOR NOT NULL, 
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
  PRIMARY KEY (tracklet_id, model_name), 
  CONSTRAINT tracklet_embeddings_norm_check CHECK (vector_norm(embedding) > 0), 
  CONSTRAINT tracklet_embeddings_dims_check CHECK (model_name NOT LIKE 'person-reidentification-retail-%' OR vector_dims(embedding)=256), 
  FOREIGN KEY(tracklet_id) REFERENCES tracklets (id) ON DELETE CASCADE
);

CREATE TABLE case_assignees (
  case_id INTEGER NOT NULL, 
  user_id INTEGER NOT NULL, 
  is_owner BOOLEAN DEFAULT false NOT NULL, 
  assigned_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
  assigned_by INTEGER NOT NULL, 
  PRIMARY KEY (case_id, user_id), 
  FOREIGN KEY(case_id) REFERENCES cases (id) ON DELETE CASCADE, 
  FOREIGN KEY(user_id) REFERENCES users (id), 
  FOREIGN KEY(assigned_by) REFERENCES users (id)
);

CREATE UNIQUE INDEX case_assignees_owner_key ON case_assignees (case_id) WHERE is_owner;

CREATE INDEX case_assignees_user_idx ON case_assignees (user_id);

CREATE TABLE search_runs (
  id UUID DEFAULT gen_random_uuid() NOT NULL, 
  case_id INTEGER NOT NULL, 
  task_id UUID, 
  status VARCHAR(10) DEFAULT 'queued' NOT NULL, 
  direction VARCHAR(10) DEFAULT 'forward' NOT NULL, 
  anchor_decision_id BIGINT, 
  recorded_from TIMESTAMP WITH TIME ZONE, 
  recorded_to TIMESTAMP WITH TIME ZONE, 
  camera_ids INTEGER[], 
  max_candidates INTEGER DEFAULT 100 NOT NULL, 
  query_version INTEGER NOT NULL, 
  conditions_version INTEGER NOT NULL, 
  case_version INTEGER NOT NULL, 
  similarity_threshold FLOAT(24) NOT NULL, 
  out_of_filter_threshold FLOAT(24), 
  candidate_count INTEGER DEFAULT 0 NOT NULL, 
  invalidated_at TIMESTAMP WITH TIME ZONE, 
  error_code VARCHAR(50), 
  created_by INTEGER NOT NULL, 
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
  completed_at TIMESTAMP WITH TIME ZONE, 
  PRIMARY KEY (id), 
  CONSTRAINT search_runs_status_check CHECK (status IN ('queued','running','done','failed')), 
  CONSTRAINT search_runs_direction_check CHECK (direction IN ('forward','backward')), 
  CONSTRAINT search_runs_max_check CHECK (max_candidates BETWEEN 1 AND 500), 
  CONSTRAINT search_runs_range_check CHECK (recorded_from IS NULL OR recorded_to IS NULL OR recorded_from < recorded_to), 
  FOREIGN KEY(case_id) REFERENCES cases (id) ON DELETE CASCADE, 
  FOREIGN KEY(created_by) REFERENCES users (id)
);

CREATE INDEX search_runs_case_latest_idx ON search_runs (case_id, created_at DESC, id DESC);

CREATE TABLE tasks (
  id UUID DEFAULT gen_random_uuid() NOT NULL, 
  kind VARCHAR(30) NOT NULL, 
  case_id INTEGER, 
  video_id INTEGER, 
  status VARCHAR(10) DEFAULT 'queued' NOT NULL, 
  stage VARCHAR(12) DEFAULT 'queued' NOT NULL, 
  progress SMALLINT DEFAULT 0 NOT NULL, 
  seq INTEGER DEFAULT 1 NOT NULL, 
  processed_samples INTEGER DEFAULT 0 NOT NULL, 
  total_samples INTEGER, 
  skipped_samples INTEGER DEFAULT 0 NOT NULL, 
  heartbeat_at TIMESTAMP WITH TIME ZONE, 
  error JSONB, 
  result JSONB, 
  created_by INTEGER, 
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
  PRIMARY KEY (id), 
  CONSTRAINT tasks_kind_check CHECK (kind IN ('video_analysis','query_embedding','candidate_search','walk_graph_recalculation')), 
  CONSTRAINT tasks_status_check CHECK (status IN ('queued','running','done','failed')), 
  CONSTRAINT tasks_stage_check CHECK (stage IN ('queued','preparing','converting','analyzing','saving','done','failed')), 
  CONSTRAINT tasks_progress_check CHECK (progress BETWEEN 0 AND 100), 
  FOREIGN KEY(case_id) REFERENCES cases (id) ON DELETE CASCADE, 
  FOREIGN KEY(video_id) REFERENCES videos (id) ON DELETE CASCADE, 
  FOREIGN KEY(created_by) REFERENCES users (id)
);

CREATE INDEX tasks_case_idx ON tasks (case_id);

CREATE INDEX tasks_video_idx ON tasks (video_id);

CREATE TABLE watch_alerts (
  id BIGSERIAL NOT NULL, 
  case_id INTEGER NOT NULL, 
  camera_id INTEGER NOT NULL, 
  detected_at TIMESTAMP WITH TIME ZONE NOT NULL, 
  score FLOAT(24) NOT NULL, 
  level VARCHAR(5) NOT NULL, 
  snapshot_path TEXT NOT NULL, 
  status VARCHAR(10) DEFAULT 'pending' NOT NULL, 
  reason JSONB DEFAULT '{}'::jsonb NOT NULL, 
  stream_session_id UUID, 
  stream_track_no INTEGER, 
  source_video_id INTEGER, 
  source_offset_s FLOAT(24), 
  reviewed_by INTEGER, 
  reviewed_at TIMESTAMP WITH TIME ZONE, 
  version INTEGER DEFAULT 1 NOT NULL, 
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
  PRIMARY KEY (id), 
  CONSTRAINT watch_alerts_id_case_id_key UNIQUE (id, case_id), 
  CONSTRAINT watch_alerts_track_key UNIQUE (case_id, stream_session_id, stream_track_no), 
  CONSTRAINT watch_alerts_score_check CHECK (score BETWEEN -1 AND 1), 
  CONSTRAINT watch_alerts_level_check CHECK (level IN ('high','mid')), 
  CONSTRAINT watch_alerts_status_check CHECK (status IN ('pending','confirmed','rejected')), 
  FOREIGN KEY(case_id) REFERENCES cases (id) ON DELETE CASCADE, 
  FOREIGN KEY(camera_id) REFERENCES cameras (node_id), 
  FOREIGN KEY(source_video_id) REFERENCES videos (id) ON DELETE SET NULL, 
  FOREIGN KEY(reviewed_by) REFERENCES users (id)
);

CREATE INDEX watch_alerts_case_time_idx ON watch_alerts (case_id, detected_at);

CREATE INDEX watch_alerts_pending_idx ON watch_alerts (case_id) WHERE status='pending';

CREATE TABLE decisions (
  id BIGSERIAL NOT NULL, 
  case_id INTEGER NOT NULL, 
  source_type VARCHAR(10) NOT NULL, 
  tracklet_id BIGINT, 
  alert_id BIGINT, 
  search_id UUID, 
  verdict VARCHAR(10) NOT NULL, 
  status VARCHAR(10) DEFAULT 'active' NOT NULL, 
  note TEXT DEFAULT '' NOT NULL, 
  camera_id INTEGER NOT NULL, 
  observed_at TIMESTAMP WITH TIME ZONE NOT NULL, 
  observed_end_at TIMESTAMP WITH TIME ZONE NOT NULL, 
  decided_by INTEGER NOT NULL, 
  decided_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
  reversed_at TIMESTAMP WITH TIME ZONE, 
  reversed_by INTEGER, 
  reversal_reason VARCHAR(500), 
  needs_reconfirmation BOOLEAN DEFAULT false NOT NULL, 
  depends_on_decision_id BIGINT, 
  version INTEGER DEFAULT 1 NOT NULL, 
  PRIMARY KEY (id), 
  CONSTRAINT decisions_alert_fkey FOREIGN KEY(alert_id, case_id) REFERENCES watch_alerts (id, case_id), 
  CONSTRAINT decisions_source_check CHECK (source_type IN ('tracklet','alert')), 
  CONSTRAINT decisions_source_ref_check CHECK ((source_type='tracklet' AND tracklet_id IS NOT NULL AND alert_id IS NULL) OR (source_type='alert' AND alert_id IS NOT NULL AND tracklet_id IS NULL AND search_id IS NULL)), 
  CONSTRAINT decisions_verdict_check CHECK (verdict IN ('confirmed','rejected','deferred')), 
  CONSTRAINT decisions_alert_verdict_check CHECK (source_type='tracklet' OR verdict <> 'deferred'), 
  CONSTRAINT decisions_status_check CHECK (status IN ('active','reversed')), 
  CONSTRAINT decisions_reversed_check CHECK ((status='reversed') = (reversed_at IS NOT NULL)), 
  CONSTRAINT decisions_observed_check CHECK (observed_end_at >= observed_at), 
  FOREIGN KEY(case_id) REFERENCES cases (id) ON DELETE CASCADE, 
  FOREIGN KEY(tracklet_id) REFERENCES tracklets (id), 
  FOREIGN KEY(search_id) REFERENCES search_runs (id) ON DELETE SET NULL, 
  FOREIGN KEY(camera_id) REFERENCES cameras (node_id), 
  FOREIGN KEY(decided_by) REFERENCES users (id), 
  FOREIGN KEY(reversed_by) REFERENCES users (id), 
  FOREIGN KEY(depends_on_decision_id) REFERENCES decisions (id)
);

CREATE UNIQUE INDEX decisions_active_alert_key ON decisions (case_id, alert_id) WHERE status='active' AND alert_id IS NOT NULL;

CREATE UNIQUE INDEX decisions_active_tracklet_key ON decisions (case_id, tracklet_id) WHERE status='active' AND tracklet_id IS NOT NULL;

CREATE INDEX decisions_case_idx ON decisions (case_id, decided_at);

CREATE INDEX decisions_route_idx ON decisions (case_id, observed_at) WHERE status='active' AND verdict='confirmed';

CREATE TABLE search_candidates (
  search_id UUID NOT NULL, 
  tracklet_id BIGINT NOT NULL, 
  rank INTEGER NOT NULL, 
  similarity FLOAT(24) NOT NULL, 
  time_feasible BOOLEAN, 
  minimum_travel_time_s FLOAT(24), 
  available_time_s FLOAT(24), 
  route_consistent BOOLEAN, 
  reason_codes VARCHAR(30)[] DEFAULT '{}' NOT NULL, 
  summary TEXT DEFAULT '' NOT NULL, 
  clip_start_s FLOAT(24) NOT NULL, 
  clip_end_s FLOAT(24) NOT NULL, 
  PRIMARY KEY (search_id, tracklet_id), 
  CONSTRAINT search_candidates_similarity_check CHECK (similarity BETWEEN -1 AND 1), 
  CONSTRAINT search_candidates_clip_check CHECK (clip_start_s >= 0 AND clip_end_s > clip_start_s), 
  FOREIGN KEY(search_id) REFERENCES search_runs (id) ON DELETE CASCADE, 
  FOREIGN KEY(tracklet_id) REFERENCES tracklets (id) ON DELETE CASCADE
);

CREATE INDEX search_candidates_rank_idx ON search_candidates (search_id, rank);

ALTER TABLE nodes ADD CONSTRAINT nodes_case_id_fkey FOREIGN KEY(case_id) REFERENCES cases (id) ON DELETE CASCADE;

ALTER TABLE videos ADD CONSTRAINT videos_case_id_fkey FOREIGN KEY(case_id) REFERENCES cases (id) ON DELETE CASCADE;

ALTER TABLE search_runs ADD CONSTRAINT search_runs_anchor_decision_fkey FOREIGN KEY(anchor_decision_id) REFERENCES decisions (id);


-- 설정 두 테이블은 한 줄짜리. 값은 미정(null)으로 시작하고 관리자가 정한다.
INSERT INTO system_settings (id) VALUES (1);
INSERT INTO retention_policy (id) VALUES (1);

