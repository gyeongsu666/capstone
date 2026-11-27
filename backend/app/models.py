"""DB 테이블 정의(openapi 1.1.0 기준). 마이그레이션은 alembic/versions에 손으로 쓴다.

모델 브랜치 db/001_schema.sql(11개 테이블)을 바탕으로 API에 필요한 칸과 테이블을 더했다.
- 기존 11개: nodes, cameras, route_edges, hazard_zones, videos, tracklets, tracklet_embeddings,
  users, cases, decisions, watch_alerts
- 추가 9개: sessions, case_assignees, search_runs, search_candidates, tasks, idempotency_keys,
  audit_logs, system_settings, retention_policy
좌표는 geography(4326), 시각은 timestamptz(UTC 저장), 파일 경로는 MEDIA_ROOT 기준 상대 경로.
"""
from datetime import datetime
from typing import Any
from uuid import UUID

from geoalchemy2 import Geography
from pgvector.sqlalchemy import Vector
from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    DateTime,
    Float,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    Integer,
    SmallInteger,
    String,
    Text,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import ARRAY, JSONB
from sqlalchemy.dialects.postgresql import UUID as PgUUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

NOW = func.now()


class Base(DeclarativeBase):
    pass


def ts(nullable: bool = False, default: bool = False) -> Any:
    return mapped_column(DateTime(timezone=True), nullable=nullable, server_default=NOW if default else None)


def version_col() -> Any:
    """낙관적 잠금용 버전. 수정할 때마다 1 올린다(expected_version과 비교)."""
    return mapped_column(Integer, nullable=False, server_default=text("1"))


# ---------------------------------------------------------------- 계정·세션
class User(Base):
    __tablename__ = "users"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    username: Mapped[str] = mapped_column(String(50), nullable=False, unique=True)
    display_name: Mapped[str] = mapped_column(String(50), nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[str] = mapped_column(String(10), nullable=False, server_default="user")
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("true"))
    must_change_password: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("true"))
    deactivated_at: Mapped[datetime | None] = ts(nullable=True)
    deactivation_reason: Mapped[str | None] = mapped_column(Text)
    version: Mapped[int] = version_col()
    created_at: Mapped[datetime] = ts(default=True)
    updated_at: Mapped[datetime] = ts(default=True)
    __table_args__ = (
        CheckConstraint("role IN ('user','admin')", name="users_role_check"),
        CheckConstraint("active OR deactivated_at IS NOT NULL", name="users_deactivated_check"),
    )


class UserSession(Base):
    """로그인 세션. 쿠키에는 원문 토큰, DB에는 HMAC 해시만 둔다."""

    __tablename__ = "sessions"
    token_hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    csrf_token: Mapped[str] = mapped_column(String(64), nullable=False)
    created_at: Mapped[datetime] = ts(default=True)
    last_seen_at: Mapped[datetime] = ts(default=True)
    expires_at: Mapped[datetime] = ts()
    absolute_expires_at: Mapped[datetime] = ts()
    revoked_at: Mapped[datetime | None] = ts(nullable=True)
    revoked_reason: Mapped[str | None] = mapped_column(String(30))
    __table_args__ = (Index("sessions_user_idx", "user_id"),)


# ---------------------------------------------------------------- 지도: 노드·카메라·도보 경로·위험 지역
class Node(Base):
    """도보 그래프의 점. 카메라와 보조지점. scope=case는 사건 전용 카메라(그 사건에서만 사용)."""

    __tablename__ = "nodes"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    kind: Mapped[str] = mapped_column(String(10), nullable=False)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    location: Mapped[Any] = mapped_column(Geography("POINT", srid=4326, spatial_index=False), nullable=False)
    scope: Mapped[str] = mapped_column(String(10), nullable=False, server_default="global")
    case_id: Mapped[int | None] = mapped_column(ForeignKey("cases.id", ondelete="CASCADE", use_alter=True, name="nodes_case_id_fkey"))
    version: Mapped[int] = version_col()
    created_at: Mapped[datetime] = ts(default=True)
    updated_at: Mapped[datetime] = ts(default=True)
    __table_args__ = (
        CheckConstraint("kind IN ('camera','waypoint')", name="nodes_kind_check"),
        CheckConstraint("scope IN ('global','case')", name="nodes_scope_check"),
        CheckConstraint("(scope='case') = (case_id IS NOT NULL)", name="nodes_scope_case_check"),
        CheckConstraint("scope='global' OR kind='camera'", name="nodes_case_camera_check"),
        Index("nodes_location_idx", "location", postgresql_using="gist"),
    )


class Camera(Base):
    __tablename__ = "cameras"
    node_id: Mapped[int] = mapped_column(ForeignKey("nodes.id", ondelete="CASCADE"), primary_key=True)
    heading_deg: Mapped[float] = mapped_column(Float(24), nullable=False)
    fov_deg: Mapped[float] = mapped_column(Float(24), nullable=False)
    # 화면 가장자리(top/right/bottom/left) → 이어지는 인접 노드 ID. 진입·이탈 방향 판단에 쓴다
    edge_node_map: Mapped[dict] = mapped_column(JSONB, nullable=False, server_default=text("'{}'::jsonb"))
    stream_url: Mapped[str | None] = mapped_column(Text)
    __table_args__ = (
        CheckConstraint("heading_deg >= 0 AND heading_deg < 360", name="cameras_heading_check"),
        CheckConstraint("fov_deg > 0 AND fov_deg <= 360", name="cameras_fov_check"),
        CheckConstraint("jsonb_typeof(edge_node_map)='object'", name="cameras_edge_map_check"),
    )


class RouteEdge(Base):
    """노드 쌍의 도보 경로(무방향, from < to). 검색의 유효 거리 = distance_m × correction_factor."""

    __tablename__ = "route_edges"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    from_node_id: Mapped[int] = mapped_column(ForeignKey("nodes.id", ondelete="CASCADE"), nullable=False)
    to_node_id: Mapped[int] = mapped_column(ForeignKey("nodes.id", ondelete="CASCADE"), nullable=False)
    distance_m: Mapped[float | None] = mapped_column(Float(24))
    duration_s: Mapped[float | None] = mapped_column(Float(24))
    path: Mapped[Any | None] = mapped_column(Geography("LINESTRING", srid=4326, spatial_index=False))
    source: Mapped[str] = mapped_column(String(10), nullable=False)
    status: Mapped[str] = mapped_column(String(15), nullable=False)
    straight_distance_m: Mapped[float | None] = mapped_column(Float(24))
    suspected_detour: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("false"))
    correction_factor: Mapped[float] = mapped_column(Float(24), nullable=False, server_default=text("1"))
    error_code: Mapped[str | None] = mapped_column(String(50))
    version: Mapped[int] = version_col()
    updated_at: Mapped[datetime] = ts(default=True)
    __table_args__ = (
        UniqueConstraint("from_node_id", "to_node_id", name="route_edges_pair_key"),
        CheckConstraint("from_node_id < to_node_id", name="route_edges_order_check"),
        CheckConstraint("source IN ('api','manual')", name="route_edges_source_check"),
        CheckConstraint("status IN ('ok','needs_manual')", name="route_edges_status_check"),
        CheckConstraint("distance_m IS NULL OR distance_m >= 0", name="route_edges_distance_check"),
        CheckConstraint("duration_s IS NULL OR duration_s >= 0", name="route_edges_duration_check"),
        CheckConstraint("correction_factor > 0", name="route_edges_factor_check"),
        CheckConstraint(
            "status <> 'ok' OR (distance_m IS NOT NULL AND duration_s IS NOT NULL AND path IS NOT NULL)",
            name="route_edges_ok_check",
        ),
    )


class HazardZone(Base):
    __tablename__ = "hazard_zones"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    kind: Mapped[str] = mapped_column(String(20), nullable=False)
    severity: Mapped[str] = mapped_column(String(10), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False, server_default="")
    area: Mapped[Any] = mapped_column(Geography("POLYGON", srid=4326, spatial_index=False), nullable=False)
    version: Mapped[int] = version_col()
    created_at: Mapped[datetime] = ts(default=True)
    updated_at: Mapped[datetime] = ts(default=True)
    __table_args__ = (
        CheckConstraint("kind IN ('water','steep_slope','road','construction','other')", name="hazard_zones_kind_check"),
        CheckConstraint("severity IN ('low','medium','high')", name="hazard_zones_severity_check"),
        Index("hazard_zones_area_idx", "area", postgresql_using="gist"),
    )


# ---------------------------------------------------------------- 영상·트랙렛·벡터
class Video(Base):
    """녹화 영상과 분석 상태. case_id가 있으면 사건 전용 영상(카메라도 사건 전용 노드)."""

    __tablename__ = "videos"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    camera_id: Mapped[int] = mapped_column(ForeignKey("cameras.node_id"), nullable=False)
    # cases ↔ tracklets ↔ videos 순환 참조라서 이 외래 키는 테이블 생성 뒤에 붙인다
    case_id: Mapped[int | None] = mapped_column(
        ForeignKey("cases.id", ondelete="CASCADE", use_alter=True, name="videos_case_id_fkey")
    )
    uploaded_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    file_path: Mapped[str] = mapped_column(Text, nullable=False)
    playback_path: Mapped[str | None] = mapped_column(Text)
    file_sha256: Mapped[str | None] = mapped_column(String(64))
    size_bytes: Mapped[int | None] = mapped_column(BigInteger)
    recorded_start_at: Mapped[datetime] = ts()
    duration_s: Mapped[float | None] = mapped_column(Float(24))
    fps: Mapped[float | None] = mapped_column(Float(24))
    width_px: Mapped[int | None] = mapped_column(Integer)
    height_px: Mapped[int | None] = mapped_column(Integer)
    # 분석 상태(openapi VideoAnalysis)
    status: Mapped[str] = mapped_column(String(10), nullable=False, server_default="queued")
    stage: Mapped[str] = mapped_column(String(12), nullable=False, server_default="queued")
    progress: Mapped[int] = mapped_column(SmallInteger, nullable=False, server_default=text("0"))
    task_id: Mapped[UUID | None] = mapped_column(PgUUID(as_uuid=True))
    attempt_seq: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"))
    processed_samples: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"))
    total_samples: Mapped[int | None] = mapped_column(Integer)
    skipped_samples: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"))
    sample_interval_s: Mapped[float | None] = mapped_column(Float(24))
    model_name: Mapped[str | None] = mapped_column(String(50))
    error_code: Mapped[str | None] = mapped_column(String(50))
    error_message: Mapped[str | None] = mapped_column(Text)
    heartbeat_at: Mapped[datetime | None] = ts(nullable=True)
    analysis_key: Mapped[str | None] = mapped_column(Text, unique=True)
    analysis_metadata: Mapped[dict] = mapped_column(JSONB, nullable=False, server_default=text("'{}'::jsonb"))
    warnings: Mapped[list] = mapped_column(JSONB, nullable=False, server_default=text("'[]'::jsonb"))
    # 보관
    lifecycle: Mapped[str] = mapped_column(String(15), nullable=False, server_default="active")
    retain_until: Mapped[datetime | None] = ts(nullable=True)
    hold: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("false"))
    created_at: Mapped[datetime] = ts(default=True)
    updated_at: Mapped[datetime] = ts(default=True)
    __table_args__ = (
        UniqueConstraint("id", "camera_id", name="videos_id_camera_id_key"),
        CheckConstraint("status IN ('queued','running','done','failed')", name="videos_status_check"),
        CheckConstraint(
            "stage IN ('queued','preparing','converting','analyzing','saving','done','failed')", name="videos_stage_check"
        ),
        CheckConstraint("progress BETWEEN 0 AND 100", name="videos_progress_check"),
        CheckConstraint("duration_s IS NULL OR duration_s > 0", name="videos_duration_check"),
        CheckConstraint("fps IS NULL OR fps > 0", name="videos_fps_check"),
        CheckConstraint("lifecycle IN ('active','delete_pending')", name="videos_lifecycle_check"),
        Index("videos_camera_time_idx", "camera_id", "recorded_start_at"),
        Index("videos_case_idx", "case_id"),
    )


class Tracklet(Base):
    """카메라 하나 안에서 이어진 한 사람의 추적 구간. 사람의 전역 ID가 아니다."""

    __tablename__ = "tracklets"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    video_id: Mapped[int] = mapped_column(Integer, nullable=False)
    camera_id: Mapped[int] = mapped_column(ForeignKey("cameras.node_id"), nullable=False)
    track_no: Mapped[int] = mapped_column(Integer, nullable=False)
    start_at: Mapped[datetime] = ts()
    end_at: Mapped[datetime] = ts()
    entry_node_id: Mapped[int | None] = mapped_column(ForeignKey("nodes.id"))
    exit_node_id: Mapped[int | None] = mapped_column(ForeignKey("nodes.id"))
    # [[offset_s, x_px, y_px, width_px, height_px], ...] 원본 프레임 픽셀 bbox
    trajectory: Mapped[list] = mapped_column(JSONB, nullable=False, server_default=text("'[]'::jsonb"))
    thumbnail_path: Mapped[str] = mapped_column(Text, nullable=False)
    thumbnail_samples: Mapped[list] = mapped_column(JSONB, nullable=False, server_default=text("'[]'::jsonb"))
    created_at: Mapped[datetime] = ts(default=True)
    __table_args__ = (
        UniqueConstraint("video_id", "track_no", name="tracklets_video_id_track_no_key"),
        ForeignKeyConstraint(
            ["video_id", "camera_id"], ["videos.id", "videos.camera_id"], ondelete="CASCADE", name="tracklets_video_fkey"
        ),
        CheckConstraint("end_at >= start_at", name="tracklets_time_check"),
        CheckConstraint("jsonb_typeof(thumbnail_samples)='array'", name="tracklets_samples_check"),
        Index("tracklets_camera_time_idx", "camera_id", "start_at"),
    )


class TrackletEmbedding(Base):
    __tablename__ = "tracklet_embeddings"
    tracklet_id: Mapped[int] = mapped_column(ForeignKey("tracklets.id", ondelete="CASCADE"), primary_key=True)
    model_name: Mapped[str] = mapped_column(String(50), primary_key=True)
    embedding: Mapped[Any] = mapped_column(Vector(), nullable=False)
    created_at: Mapped[datetime] = ts(default=True)
    __table_args__ = (
        CheckConstraint("vector_norm(embedding) > 0", name="tracklet_embeddings_norm_check"),
        CheckConstraint(
            "model_name NOT LIKE 'person-reidentification-retail-%' OR vector_dims(embedding)=256",
            name="tracklet_embeddings_dims_check",
        ),
    )


# ---------------------------------------------------------------- 사건·담당·검색·판단
class Case(Base):
    __tablename__ = "cases"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    title: Mapped[str] = mapped_column(String(150), nullable=False)
    person_type: Mapped[str] = mapped_column(String(10), nullable=False)
    person_name: Mapped[str] = mapped_column(String(50), nullable=False)
    person_age: Mapped[int | None] = mapped_column(SmallInteger)
    description: Mapped[str] = mapped_column(Text, nullable=False, server_default="")
    appearance: Mapped[str] = mapped_column(Text, nullable=False, server_default="")
    last_seen_at: Mapped[datetime] = ts()
    last_seen_location: Mapped[Any] = mapped_column(Geography("POINT", srid=4326, spatial_index=False), nullable=False)
    last_seen_place_name: Mapped[str | None] = mapped_column(String(200))
    # 마지막 목격 위치에서 가장 가까운 노드(검색·범위 계산의 출발점)
    origin_node_id: Mapped[int | None] = mapped_column(ForeignKey("nodes.id", ondelete="SET NULL"))
    owner_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    status: Mapped[str] = mapped_column(String(10), nullable=False, server_default="open")
    close_outcome: Mapped[str | None] = mapped_column(String(12))
    close_reason: Mapped[str | None] = mapped_column(Text)
    closed_at: Mapped[datetime | None] = ts(nullable=True)
    closed_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    found_at: Mapped[datetime | None] = ts(nullable=True)
    # 기준 대상(질의): 사진 한 장 또는 트랙렛 하나
    query_status: Mapped[str] = mapped_column(String(10), nullable=False, server_default="not_set")
    query_source: Mapped[str | None] = mapped_column(String(10))
    query_version: Mapped[int] = version_col()
    query_tracklet_id: Mapped[int | None] = mapped_column(ForeignKey("tracklets.id", ondelete="SET NULL"))
    query_photo_path: Mapped[str | None] = mapped_column(Text)
    query_person_bbox: Mapped[list | None] = mapped_column(JSONB)
    query_embedding: Mapped[Any | None] = mapped_column(Vector())
    query_model_name: Mapped[str | None] = mapped_column(String(50))
    query_task_id: Mapped[UUID | None] = mapped_column(PgUUID(as_uuid=True))
    query_error_code: Mapped[str | None] = mapped_column(String(50))
    query_updated_at: Mapped[datetime] = ts(default=True)
    # 검색 조건(사건마다 하나). 생성 시 시스템 기본값을 복사한다
    similarity_threshold: Mapped[float] = mapped_column(Float(24), nullable=False)
    conditions_version: Mapped[int] = version_col()
    conditions_updated_at: Mapped[datetime] = ts(default=True)
    watch_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("false"))
    retain_until: Mapped[datetime | None] = ts(nullable=True)
    version: Mapped[int] = version_col()
    created_at: Mapped[datetime] = ts(default=True)
    updated_at: Mapped[datetime] = ts(default=True)
    __table_args__ = (
        CheckConstraint("person_type IN ('adult','child','elderly','other')", name="cases_person_type_check"),
        CheckConstraint("person_age IS NULL OR person_age BETWEEN 0 AND 150", name="cases_person_age_check"),
        CheckConstraint("status IN ('open','closed')", name="cases_status_check"),
        CheckConstraint(
            "(status='open' AND close_outcome IS NULL AND closed_at IS NULL) OR "
            "(status='closed' AND close_outcome IN ('found','unresolved','other') AND closed_at IS NOT NULL)",
            name="cases_close_check",
        ),
        CheckConstraint("close_outcome IS DISTINCT FROM 'found' OR found_at IS NOT NULL", name="cases_found_check"),
        CheckConstraint("status='open' OR NOT watch_enabled", name="cases_watch_check"),
        CheckConstraint("query_status IN ('not_set','queued','running','ready','failed')", name="cases_query_status_check"),
        CheckConstraint("query_source IS NULL OR query_source IN ('photo','tracklet')", name="cases_query_source_check"),
        CheckConstraint(
            "query_status <> 'ready' OR (query_embedding IS NOT NULL AND query_model_name IS NOT NULL)",
            name="cases_query_ready_check",
        ),
        CheckConstraint("query_embedding IS NULL OR vector_norm(query_embedding) > 0", name="cases_query_norm_check"),
        CheckConstraint("similarity_threshold BETWEEN 0 AND 1", name="cases_threshold_check"),
        Index("cases_owner_idx", "owner_id"),
    )


class CaseAssignee(Base):
    """사건 담당자. 주 담당자(is_owner)는 사건마다 정확히 한 명."""

    __tablename__ = "case_assignees"
    case_id: Mapped[int] = mapped_column(ForeignKey("cases.id", ondelete="CASCADE"), primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), primary_key=True)
    is_owner: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("false"))
    assigned_at: Mapped[datetime] = ts(default=True)
    assigned_by: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    __table_args__ = (
        Index("case_assignees_owner_key", "case_id", unique=True, postgresql_where=text("is_owner")),
        Index("case_assignees_user_idx", "user_id"),
    )


class SearchRun(Base):
    """후보 검색 한 번. 만들 때의 질의·조건·사건 버전을 기록하고, 달라지면 낡은(stale) 검색이다."""

    __tablename__ = "search_runs"
    id: Mapped[UUID] = mapped_column(PgUUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()"))
    case_id: Mapped[int] = mapped_column(ForeignKey("cases.id", ondelete="CASCADE"), nullable=False)
    task_id: Mapped[UUID | None] = mapped_column(PgUUID(as_uuid=True))
    status: Mapped[str] = mapped_column(String(10), nullable=False, server_default="queued")
    direction: Mapped[str] = mapped_column(String(10), nullable=False, server_default="forward")
    anchor_decision_id: Mapped[int | None] = mapped_column(
        ForeignKey("decisions.id", use_alter=True, name="search_runs_anchor_decision_fkey")
    )
    recorded_from: Mapped[datetime | None] = ts(nullable=True)
    recorded_to: Mapped[datetime | None] = ts(nullable=True)
    camera_ids: Mapped[list[int] | None] = mapped_column(ARRAY(Integer))
    max_candidates: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("100"))
    query_version: Mapped[int] = mapped_column(Integer, nullable=False)
    conditions_version: Mapped[int] = mapped_column(Integer, nullable=False)
    case_version: Mapped[int] = mapped_column(Integer, nullable=False)
    similarity_threshold: Mapped[float] = mapped_column(Float(24), nullable=False)
    out_of_filter_threshold: Mapped[float | None] = mapped_column(Float(24))
    candidate_count: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"))
    # 번복 등으로 명시적으로 무효화된 시각. stale = invalidated_at IS NOT NULL 또는 버전 불일치
    invalidated_at: Mapped[datetime | None] = ts(nullable=True)
    error_code: Mapped[str | None] = mapped_column(String(50))
    created_by: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    created_at: Mapped[datetime] = ts(default=True)
    completed_at: Mapped[datetime | None] = ts(nullable=True)
    __table_args__ = (
        CheckConstraint("status IN ('queued','running','done','failed')", name="search_runs_status_check"),
        CheckConstraint("direction IN ('forward','backward')", name="search_runs_direction_check"),
        CheckConstraint("max_candidates BETWEEN 1 AND 500", name="search_runs_max_check"),
        CheckConstraint("recorded_from IS NULL OR recorded_to IS NULL OR recorded_from < recorded_to", name="search_runs_range_check"),
        Index("search_runs_case_latest_idx", "case_id", text("created_at DESC"), text("id DESC")),
    )


class SearchCandidate(Base):
    """검색 결과 후보(검색 시점 스냅샷). 판단 상태는 decisions에서 따로 읽는다."""

    __tablename__ = "search_candidates"
    search_id: Mapped[UUID] = mapped_column(ForeignKey("search_runs.id", ondelete="CASCADE"), primary_key=True)
    tracklet_id: Mapped[int] = mapped_column(ForeignKey("tracklets.id", ondelete="CASCADE"), primary_key=True)
    rank: Mapped[int] = mapped_column(Integer, nullable=False)
    similarity: Mapped[float] = mapped_column(Float(24), nullable=False)
    time_feasible: Mapped[bool | None] = mapped_column(Boolean)
    minimum_travel_time_s: Mapped[float | None] = mapped_column(Float(24))
    available_time_s: Mapped[float | None] = mapped_column(Float(24))
    route_consistent: Mapped[bool | None] = mapped_column(Boolean)
    reason_codes: Mapped[list[str]] = mapped_column(ARRAY(String(30)), nullable=False, server_default=text("'{}'"))
    summary: Mapped[str] = mapped_column(Text, nullable=False, server_default="")
    clip_start_s: Mapped[float] = mapped_column(Float(24), nullable=False)
    clip_end_s: Mapped[float] = mapped_column(Float(24), nullable=False)
    __table_args__ = (
        CheckConstraint("similarity BETWEEN -1 AND 1", name="search_candidates_similarity_check"),
        CheckConstraint("clip_start_s >= 0 AND clip_end_s > clip_start_s", name="search_candidates_clip_check"),
        Index("search_candidates_rank_idx", "search_id", "rank"),
    )


class WatchAlert(Base):
    __tablename__ = "watch_alerts"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    case_id: Mapped[int] = mapped_column(ForeignKey("cases.id", ondelete="CASCADE"), nullable=False)
    camera_id: Mapped[int] = mapped_column(ForeignKey("cameras.node_id"), nullable=False)
    detected_at: Mapped[datetime] = ts()
    score: Mapped[float] = mapped_column(Float(24), nullable=False)
    level: Mapped[str] = mapped_column(String(5), nullable=False)
    snapshot_path: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(String(10), nullable=False, server_default="pending")
    # 판단 근거(CandidateReason과 같은 모양)
    reason: Mapped[dict] = mapped_column(JSONB, nullable=False, server_default=text("'{}'::jsonb"))
    # 같은 스트림 트랙은 한 번만 알린다
    stream_session_id: Mapped[UUID | None] = mapped_column(PgUUID(as_uuid=True))
    stream_track_no: Mapped[int | None] = mapped_column(Integer)
    source_video_id: Mapped[int | None] = mapped_column(ForeignKey("videos.id", ondelete="SET NULL"))
    source_offset_s: Mapped[float | None] = mapped_column(Float(24))
    reviewed_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    reviewed_at: Mapped[datetime | None] = ts(nullable=True)
    version: Mapped[int] = version_col()
    created_at: Mapped[datetime] = ts(default=True)
    __table_args__ = (
        UniqueConstraint("id", "case_id", name="watch_alerts_id_case_id_key"),
        UniqueConstraint("case_id", "stream_session_id", "stream_track_no", name="watch_alerts_track_key"),
        CheckConstraint("score BETWEEN -1 AND 1", name="watch_alerts_score_check"),
        CheckConstraint("level IN ('high','mid')", name="watch_alerts_level_check"),
        CheckConstraint("status IN ('pending','confirmed','rejected')", name="watch_alerts_status_check"),
        Index("watch_alerts_case_time_idx", "case_id", "detected_at"),
        Index("watch_alerts_pending_idx", "case_id", postgresql_where=text("status='pending'")),
    )


class Decision(Base):
    """판단 기록(예/아니오/보류). 지우지 않고, 번복은 status=reversed로 남긴다."""

    __tablename__ = "decisions"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    case_id: Mapped[int] = mapped_column(ForeignKey("cases.id", ondelete="CASCADE"), nullable=False)
    source_type: Mapped[str] = mapped_column(String(10), nullable=False)
    tracklet_id: Mapped[int | None] = mapped_column(ForeignKey("tracklets.id"))
    alert_id: Mapped[int | None] = mapped_column(BigInteger)
    search_id: Mapped[UUID | None] = mapped_column(ForeignKey("search_runs.id", ondelete="SET NULL"))
    verdict: Mapped[str] = mapped_column(String(10), nullable=False)
    status: Mapped[str] = mapped_column(String(10), nullable=False, server_default="active")
    note: Mapped[str] = mapped_column(Text, nullable=False, server_default="")
    camera_id: Mapped[int] = mapped_column(ForeignKey("cameras.node_id"), nullable=False)
    observed_at: Mapped[datetime] = ts()
    observed_end_at: Mapped[datetime] = ts()
    decided_by: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    decided_at: Mapped[datetime] = ts(default=True)
    reversed_at: Mapped[datetime | None] = ts(nullable=True)
    reversed_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    reversal_reason: Mapped[str | None] = mapped_column(String(500))
    needs_reconfirmation: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("false"))
    # 이 판단이 어떤 확정 판단을 기준으로 한 검색에서 나왔는지(번복 시 전이적으로 재확인 표시)
    depends_on_decision_id: Mapped[int | None] = mapped_column(ForeignKey("decisions.id"))
    version: Mapped[int] = version_col()
    __table_args__ = (
        ForeignKeyConstraint(["alert_id", "case_id"], ["watch_alerts.id", "watch_alerts.case_id"], name="decisions_alert_fkey"),
        CheckConstraint("source_type IN ('tracklet','alert')", name="decisions_source_check"),
        CheckConstraint(
            "(source_type='tracklet' AND tracklet_id IS NOT NULL AND alert_id IS NULL) OR "
            "(source_type='alert' AND alert_id IS NOT NULL AND tracklet_id IS NULL AND search_id IS NULL)",
            name="decisions_source_ref_check",
        ),
        CheckConstraint("verdict IN ('confirmed','rejected','deferred')", name="decisions_verdict_check"),
        CheckConstraint("source_type='tracklet' OR verdict <> 'deferred'", name="decisions_alert_verdict_check"),
        CheckConstraint("status IN ('active','reversed')", name="decisions_status_check"),
        CheckConstraint("(status='reversed') = (reversed_at IS NOT NULL)", name="decisions_reversed_check"),
        CheckConstraint("observed_end_at >= observed_at", name="decisions_observed_check"),
        # 한 트랙렛·알림에 유효한 판단은 하나
        Index(
            "decisions_active_tracklet_key", "case_id", "tracklet_id", unique=True,
            postgresql_where=text("status='active' AND tracklet_id IS NOT NULL"),
        ),
        Index(
            "decisions_active_alert_key", "case_id", "alert_id", unique=True,
            postgresql_where=text("status='active' AND alert_id IS NOT NULL"),
        ),
        Index("decisions_case_idx", "case_id", "decided_at"),
        Index("decisions_route_idx", "case_id", "observed_at", postgresql_where=text("status='active' AND verdict='confirmed'")),
    )


# ---------------------------------------------------------------- 작업·멱등·감사·설정
class Task(Base):
    """오래 걸리는 작업(202 + task_id). DB 상태가 기준이고 Redis는 큐 전달용."""

    __tablename__ = "tasks"
    id: Mapped[UUID] = mapped_column(PgUUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()"))
    kind: Mapped[str] = mapped_column(String(30), nullable=False)
    case_id: Mapped[int | None] = mapped_column(ForeignKey("cases.id", ondelete="CASCADE"))
    video_id: Mapped[int | None] = mapped_column(ForeignKey("videos.id", ondelete="CASCADE"))
    status: Mapped[str] = mapped_column(String(10), nullable=False, server_default="queued")
    stage: Mapped[str] = mapped_column(String(12), nullable=False, server_default="queued")
    progress: Mapped[int] = mapped_column(SmallInteger, nullable=False, server_default=text("0"))
    seq: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("1"))
    processed_samples: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"))
    total_samples: Mapped[int | None] = mapped_column(Integer)
    skipped_samples: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"))
    heartbeat_at: Mapped[datetime | None] = ts(nullable=True)
    error: Mapped[dict | None] = mapped_column(JSONB)
    result: Mapped[dict | None] = mapped_column(JSONB)
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = ts(default=True)
    updated_at: Mapped[datetime] = ts(default=True)
    __table_args__ = (
        CheckConstraint(
            "kind IN ('video_analysis','query_embedding','candidate_search','walk_graph_recalculation')",
            name="tasks_kind_check",
        ),
        CheckConstraint("status IN ('queued','running','done','failed')", name="tasks_status_check"),
        CheckConstraint(
            "stage IN ('queued','preparing','converting','analyzing','saving','done','failed')", name="tasks_stage_check"
        ),
        CheckConstraint("progress BETWEEN 0 AND 100", name="tasks_progress_check"),
        Index("tasks_case_idx", "case_id"),
        Index("tasks_video_idx", "video_id"),
    )


class IdempotencyKey(Base):
    """Idempotency-Key 재사용 판단. 같은 사용자·작업·키·본문 해시면 저장한 응답을 그대로 돌려준다."""

    __tablename__ = "idempotency_keys"
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    operation: Mapped[str] = mapped_column(String(80), primary_key=True)
    key: Mapped[str] = mapped_column(String(128), primary_key=True)
    request_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    state: Mapped[str] = mapped_column(String(12), nullable=False, server_default="in_progress")
    response_status: Mapped[int | None] = mapped_column(SmallInteger)
    response_body: Mapped[Any | None] = mapped_column(JSONB)
    created_at: Mapped[datetime] = ts(default=True)
    expires_at: Mapped[datetime] = ts()
    __table_args__ = (
        CheckConstraint("state IN ('in_progress','completed')", name="idempotency_keys_state_check"),
        Index("idempotency_keys_expires_idx", "expires_at"),
    )


class AuditLog(Base):
    """이용 기록. 비밀번호·세션·CSRF·스트림 자격정보·원본 파일 경로는 남기지 않는다."""

    __tablename__ = "audit_logs"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    occurred_at: Mapped[datetime] = ts(default=True)
    actor_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    actor_name: Mapped[str | None] = mapped_column(String(50))
    case_id: Mapped[int | None] = mapped_column(Integer)
    action: Mapped[str] = mapped_column(String(50), nullable=False)
    resource_type: Mapped[str] = mapped_column(String(30), nullable=False)
    resource_id: Mapped[str | None] = mapped_column(String(64))
    request_id: Mapped[str] = mapped_column(String(128), nullable=False)
    result: Mapped[str] = mapped_column(String(10), nullable=False)
    changed_fields: Mapped[list[str]] = mapped_column(ARRAY(String(50)), nullable=False, server_default=text("'{}'"))
    __table_args__ = (
        CheckConstraint("result IN ('success','failure')", name="audit_logs_result_check"),
        Index("audit_logs_time_idx", text("occurred_at DESC"), text("id DESC")),
        Index("audit_logs_actor_idx", "actor_user_id"),
        Index("audit_logs_case_idx", "case_id"),
    )


class SystemSettings(Base):
    """시스템 설정(한 줄). 미정 값은 null이고, 필요한 계산·감시는 SETTINGS_NOT_CONFIGURED로 막는다."""

    __tablename__ = "system_settings"
    id: Mapped[int] = mapped_column(SmallInteger, primary_key=True, server_default=text("1"))
    # [{person_type, speed_mps, max_speed_mps}] adult·child·elderly·other 4개
    walking_speed_presets: Mapped[list] = mapped_column(JSONB, nullable=False, server_default=text("'[]'::jsonb"))
    default_similarity_threshold: Mapped[float | None] = mapped_column(Float(24))
    alert_high_threshold: Mapped[float | None] = mapped_column(Float(24))
    out_of_filter_threshold: Mapped[float | None] = mapped_column(Float(24))
    # 누적 비율 [r1, r2, 1]
    area_level_ratios: Mapped[list] = mapped_column(JSONB, nullable=False, server_default=text("'[]'::jsonb"))
    area_buffer_m: Mapped[float | None] = mapped_column(Float(24))
    max_upload_bytes: Mapped[int | None] = mapped_column(BigInteger)
    version: Mapped[int] = version_col()
    updated_at: Mapped[datetime] = ts(default=True)
    updated_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    __table_args__ = (
        CheckConstraint("id = 1", name="system_settings_single_row_check"),
        CheckConstraint(
            "default_similarity_threshold IS NULL OR default_similarity_threshold BETWEEN 0 AND 1",
            name="system_settings_default_check",
        ),
        CheckConstraint("alert_high_threshold IS NULL OR alert_high_threshold BETWEEN 0 AND 1", name="system_settings_high_check"),
        CheckConstraint(
            "out_of_filter_threshold IS NULL OR out_of_filter_threshold BETWEEN 0 AND 1", name="system_settings_oof_check"
        ),
        CheckConstraint(
            "default_similarity_threshold IS NULL OR alert_high_threshold IS NULL "
            "OR default_similarity_threshold < alert_high_threshold",
            name="system_settings_order_check",
        ),
        CheckConstraint("area_buffer_m IS NULL OR area_buffer_m > 0", name="system_settings_buffer_check"),
    )


class RetentionPolicy(Base):
    """보관 기간(한 줄). 기간 설정·삭제 예정 조회만 하고 자동 삭제는 하지 않는다."""

    __tablename__ = "retention_policy"
    id: Mapped[int] = mapped_column(SmallInteger, primary_key=True, server_default=text("1"))
    video_retention_days: Mapped[int | None] = mapped_column(Integer)
    closed_case_retention_days: Mapped[int | None] = mapped_column(Integer)
    alert_retention_days: Mapped[int | None] = mapped_column(Integer)
    audit_retention_days: Mapped[int | None] = mapped_column(Integer)
    version: Mapped[int] = version_col()
    updated_at: Mapped[datetime] = ts(default=True)
    updated_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    __table_args__ = (CheckConstraint("id = 1", name="retention_policy_single_row_check"),)
