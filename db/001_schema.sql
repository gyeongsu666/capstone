\set ON_ERROR_STOP on
BEGIN;
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS vector;
CREATE TABLE nodes (
 id serial PRIMARY KEY, kind varchar(10) NOT NULL CHECK(kind IN ('camera','waypoint')),
 name varchar(100) NOT NULL, location geography(Point,4326) NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX nodes_location_idx ON nodes USING gist(location);
CREATE TABLE cameras (
 node_id int PRIMARY KEY REFERENCES nodes(id) ON DELETE CASCADE,
 heading_deg real NOT NULL CHECK(heading_deg >= 0 AND heading_deg < 360),
 fov_deg real NOT NULL CHECK(fov_deg > 0 AND fov_deg <= 360),
 edge_node_map jsonb NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(edge_node_map)='object'),
 stream_url text
);
CREATE TABLE route_edges (
 id serial PRIMARY KEY, from_node_id int NOT NULL REFERENCES nodes(id),
 to_node_id int NOT NULL REFERENCES nodes(id), distance_m real CHECK(distance_m >= 0),
 duration_s real CHECK(duration_s >= 0), path geography(LineString,4326),
 source varchar(10) NOT NULL CHECK(source IN ('api','manual')),
 status varchar(15) NOT NULL CHECK(status IN ('ok','needs_manual')),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(from_node_id,to_node_id), CHECK(from_node_id < to_node_id),
 CHECK(status <> 'ok' OR (distance_m IS NOT NULL AND duration_s IS NOT NULL AND path IS NOT NULL))
);
CREATE TABLE hazard_zones (
 id serial PRIMARY KEY, name varchar(100) NOT NULL,
 kind varchar(20) NOT NULL CHECK(kind IN ('construction','road','river','etc')),
 area geography(Polygon,4326) NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX hazard_zones_area_idx ON hazard_zones USING gist(area);
CREATE TABLE videos (
 id serial PRIMARY KEY, camera_id int NOT NULL REFERENCES cameras(node_id),
 file_path text NOT NULL, playback_path text, recorded_start_at timestamptz NOT NULL,
 duration_s real NOT NULL CHECK(duration_s > 0), fps real NOT NULL CHECK(fps > 0),
 status varchar(10) NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','running','done','failed')),
 progress smallint NOT NULL DEFAULT 0 CHECK(progress BETWEEN 0 AND 100),
 error_message text, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(id,camera_id)
);
CREATE INDEX videos_camera_time_idx ON videos(camera_id,recorded_start_at);
CREATE TABLE tracklets (
 id bigserial PRIMARY KEY, video_id int NOT NULL,
 camera_id int NOT NULL REFERENCES cameras(node_id), track_no int NOT NULL,
 start_at timestamptz NOT NULL, end_at timestamptz NOT NULL,
 entry_node_id int REFERENCES nodes(id), exit_node_id int REFERENCES nodes(id),
 trajectory jsonb NOT NULL DEFAULT '[]', thumbnail_path text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), CHECK(end_at >= start_at),
 UNIQUE(video_id,track_no),
 FOREIGN KEY(video_id,camera_id) REFERENCES videos(id,camera_id) ON DELETE CASCADE
);
CREATE INDEX tracklets_camera_time_idx ON tracklets(camera_id,start_at);
CREATE TABLE tracklet_embeddings (
 tracklet_id bigint NOT NULL REFERENCES tracklets(id) ON DELETE CASCADE,
 model_name varchar(50) NOT NULL, embedding vector NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(tracklet_id,model_name),
 CHECK(vector_norm(embedding) > 0),
 CHECK(model_name NOT LIKE 'person-reidentification-retail-%' OR vector_dims(embedding)=256)
);
CREATE TABLE users (
 id serial PRIMARY KEY, username varchar(50) NOT NULL UNIQUE,
 password_hash varchar(255) NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE cases (
 id serial PRIMARY KEY, created_by int NOT NULL REFERENCES users(id),
 person_type varchar(10) NOT NULL CHECK(person_type IN ('child','elderly','adult')),
 description text, last_seen_at timestamptz NOT NULL,
 last_seen_location geography(Point,4326) NOT NULL,
 anchor_node_id int NOT NULL REFERENCES nodes(id),
 query_source varchar(10) NOT NULL CHECK(query_source IN ('photo','tracklet')),
 query_tracklet_id bigint REFERENCES tracklets(id), query_photo_path text,
 query_embedding vector, query_model_name varchar(50) NOT NULL,
 threshold real NOT NULL CHECK(threshold BETWEEN -1 AND 1),
 watch_enabled boolean NOT NULL DEFAULT false,
 status varchar(15) NOT NULL DEFAULT 'open' CHECK(status IN ('open','found','unresolved','closed')),
 found_at timestamptz, closing_note text, created_at timestamptz NOT NULL DEFAULT now(),
 CHECK((query_source='photo' AND query_photo_path IS NOT NULL AND query_tracklet_id IS NULL)
 OR (query_source='tracklet' AND query_tracklet_id IS NOT NULL AND query_photo_path IS NULL)),
 CHECK(query_embedding IS NULL OR vector_norm(query_embedding)>0),
 CHECK(query_embedding IS NULL OR query_model_name NOT LIKE 'person-reidentification-retail-%'
 OR vector_dims(query_embedding)=256), CHECK(status='open' OR NOT watch_enabled)
);
CREATE TABLE watch_alerts (
 id bigserial PRIMARY KEY, case_id int NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
 camera_id int NOT NULL REFERENCES cameras(node_id), detected_at timestamptz NOT NULL,
 score real NOT NULL CHECK(score BETWEEN -1 AND 1),
 level varchar(5) NOT NULL CHECK(level IN ('high','mid')), snapshot_path text NOT NULL,
 status varchar(10) NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','confirmed','rejected')),
 reviewed_by int REFERENCES users(id), reviewed_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(id,case_id)
);
CREATE INDEX watch_alerts_case_time_idx ON watch_alerts(case_id,detected_at);
CREATE TABLE decisions (
 id bigserial PRIMARY KEY, case_id int NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
 kind varchar(10) NOT NULL CHECK(kind IN ('confirmed','absent')),
 tracklet_id bigint REFERENCES tracklets(id), alert_id bigint,
 camera_id int REFERENCES cameras(node_id), window_start timestamptz, window_end timestamptz,
 decided_by int NOT NULL REFERENCES users(id), decided_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(alert_id,case_id) REFERENCES watch_alerts(id,case_id),
 CHECK((kind='confirmed' AND num_nonnulls(tracklet_id,alert_id)=1
 AND camera_id IS NULL AND window_start IS NULL AND window_end IS NULL)
 OR (kind='absent' AND tracklet_id IS NULL AND alert_id IS NULL AND camera_id IS NOT NULL
 AND window_start IS NOT NULL AND window_end IS NOT NULL AND window_end>window_start))
);
CREATE INDEX decisions_case_idx ON decisions(case_id,decided_at);
-- Confirmed tracklets are protected from deletion by FK RESTRICT.
-- Reanalysis must explicitly reconcile existing decisions before deleting tracklets.
COMMIT;
