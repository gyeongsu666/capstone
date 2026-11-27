"""알고리즘 B·C·D: 시공간 제약 필터, R5 포함 규칙, 경로 일관성 검사.

B 시공간 필터: 기준점(마지막 확정 장면 또는 최초 목격)에서 카메라까지 도보 최단 유효 거리 d,
  최소 이동 시간 = d / 유형별 최대 보행 속도. 앞으로 검색이면 기준 시각 이후, 뒤로 검색이면 이전 장면만.
  가용 시간(기준 시각과 장면 시각의 차) ≥ 최소 이동 시간이면 time_feasible=true.
C R5 포함 규칙(모든 후보는 사건 유사도 기준 이상):
  true → 포함 / false → out_of_filter_threshold가 있고 max(기준, 예외 기준) 이상일 때만(TIME_REVIEW_REQUIRED)
  / null(경로 정보 없음) → 포함(MANUAL_REVIEW_REQUIRED, ROUTE_UNKNOWN)
D 경로 일관성: 기준 장면의 이탈 노드·후보의 진입 노드(앞으로) 또는 후보의 이탈 노드·기준 장면의 진입 노드(뒤로)가
  최단 경로 위에 있는지. 어긋나면 순위만 낮춘다(전용 코드 없음, summary에 적음).
"""
from dataclasses import dataclass
from datetime import datetime

ROUTE_MISMATCH_PENALTY = 0.05
TIME_REVIEW_PENALTY = 0.02


@dataclass
class Anchor:
    node_id: int
    time: datetime  # 앞으로: 떠난 시각(장면 끝), 뒤로: 도착 시각(장면 시작)
    direction: str  # forward | backward
    extra_m: float = 0.0  # 최초 목격 위치 → 가장 가까운 노드까지(직선)
    exit_node_id: int | None = None
    entry_node_id: int | None = None
    tracklet_id: int | None = None


@dataclass
class CandidateRow:
    tracklet_id: int
    camera_id: int
    start_at: datetime
    end_at: datetime
    entry_node_id: int | None
    exit_node_id: int | None
    similarity: float


@dataclass
class Scored:
    row: CandidateRow
    time_feasible: bool | None
    minimum_travel_time_s: float | None
    available_time_s: float | None
    route_consistent: bool | None
    reason_codes: list[str]
    summary: str
    score: float


def minutes(seconds: float) -> str:
    """사람이 읽는 시간: 45초, 2.5분, 12분."""
    if seconds < 60:
        return f"{round(seconds)}초"
    m = seconds / 60
    if m >= 10:
        return f"{round(m)}분"
    text = f"{m:.1f}"
    return (text[:-2] if text.endswith(".0") else text) + "분"


def route_consistency(anchor: Anchor, path: list[int] | None, row: CandidateRow) -> bool | None:
    """최단 경로(기준 노드 → 후보 카메라) 위에 진입·이탈 노드가 있는지. 판단할 정보가 없으면 None."""
    if not path or len(path) < 2:
        return None
    on_path = set(path[:-1]) if anchor.direction == "forward" else set(path[1:])
    checks = []
    if anchor.direction == "forward":
        if anchor.exit_node_id is not None:
            checks.append(anchor.exit_node_id in set(path[1:]))  # 기준 장면에서 나간 쪽이 경로 첫 방향
        if row.entry_node_id is not None:
            checks.append(row.entry_node_id in on_path)  # 후보가 들어온 쪽이 경로 마지막 방향
    else:
        if row.exit_node_id is not None:
            checks.append(row.exit_node_id in set(path[:-1]))  # 후보가 나간 쪽이 기준 노드 방향
        if anchor.entry_node_id is not None:
            checks.append(anchor.entry_node_id in set(path[1:]))
    if not checks:
        return None
    return all(checks)


def evaluate(
    rows: list[CandidateRow],
    anchor: Anchor,
    dist: dict[int, float],
    paths: dict[int, list[int] | None],
    *,
    max_speed_mps: float,
    threshold: float,
    out_of_filter_threshold: float | None,
) -> list[Scored]:
    """후보를 판정·필터링하고 점수 순으로 정렬한다."""
    out: list[Scored] = []
    for row in rows:
        if row.similarity < threshold:
            continue
        if anchor.tracklet_id is not None and row.tracklet_id == anchor.tracklet_id:
            continue
        if anchor.direction == "forward":
            available = (row.start_at - anchor.time).total_seconds()
        else:
            available = (anchor.time - row.end_at).total_seconds()
        if available < 0:
            continue  # 반대 방향 시간대
        d = dist.get(row.camera_id)
        if d is None:
            feasible, min_travel = None, None
        else:
            min_travel = (d + anchor.extra_m) / max_speed_mps
            feasible = available >= min_travel
        if feasible is False:
            limit = None if out_of_filter_threshold is None else max(threshold, out_of_filter_threshold)
            if limit is None or row.similarity < limit:
                continue
        consistent = route_consistency(anchor, paths.get(row.camera_id), row)

        codes = ["APPEARANCE_MATCH"]
        if feasible is True:
            codes.append("TIME_FEASIBLE")
            text = f"도보 최소 {minutes(min_travel)}, {minutes(available)} 뒤 나타남"
        elif feasible is False:
            codes.append("TIME_REVIEW_REQUIRED")
            text = f"도보 최소 {minutes(min_travel)}인데 {minutes(available)} 만에 나타남(시간 확인 필요)"
        else:
            codes += ["ROUTE_UNKNOWN", "MANUAL_REVIEW_REQUIRED"]
            text = "도보 경로 정보가 없어 이동 시간을 판단할 수 없음(직접 확인)"
        if consistent is True:
            text += " · 이동 방향 맞음"
        elif consistent is False:
            text += " · 들어오고 나간 방향이 경로와 다름"

        score = row.similarity - (ROUTE_MISMATCH_PENALTY if consistent is False else 0) \
            - (TIME_REVIEW_PENALTY if feasible is False else 0)
        out.append(Scored(row, feasible, None if min_travel is None else round(min_travel, 1), round(available, 1),
                          consistent, codes, text, score))
    out.sort(key=lambda s: (-s.score, s.row.tracklet_id))
    return out
