"""5단계 알고리즘 단위 테스트(DB 없음): A 도보 그래프, B·C·D 검색 판정, G 범위, H 알림 분류, 경로 제공자."""
from datetime import datetime, timedelta, timezone

import pytest

from app.search_algo import Anchor, CandidateRow, evaluate, minutes, route_consistency
from app.walkgraph import EdgeInfo, Graph, dijkstra, path_line, path_nodes, raw_distance

T0 = datetime(2026, 11, 20, 9, 0, tzinfo=timezone.utc)


def line_graph() -> Graph:
    """1 ─120m─ 2 ─80m─ 3, 그리고 1 ─300m─ 3(돌아가는 길). 경도 0.001 ≈ 91m(위도 34)."""
    g = Graph()
    g.nodes = {1: (126.0, 34.0), 2: (126.0013, 34.0), 3: (126.0022, 34.0), 4: (126.0, 34.002)}
    g.kinds = {1: "camera", 2: "waypoint", 3: "camera", 4: "camera"}
    g.add_edge(EdgeInfo(10, 1, 2, 120.0, 120.0, 100.0, [(126.0, 34.0), (126.0013, 34.0)]))
    g.add_edge(EdgeInfo(11, 2, 3, 80.0, 80.0, 66.0, [(126.0022, 34.0), (126.0013, 34.0)]))  # 반대 방향으로 저장된 선
    g.add_edge(EdgeInfo(12, 1, 3, 300.0, 300.0, 250.0, None))
    return g


# ---------------------------------------------------------------- A
def test_dijkstra_takes_shorter_two_hop_route_and_respects_correction():
    g = line_graph()
    dist, prev = dijkstra(g, 1)
    assert dist[3] == 200.0 and path_nodes(prev, 3) == [1, 2, 3]
    assert 4 not in dist and path_nodes(prev, 4) is None  # 이어지지 않은 노드
    g.edge(2, 3).effective_m = 500.0  # 관리자 보정 계수로 늘린 구간
    dist, prev = dijkstra(g, 1)
    assert dist[3] == 300.0 and path_nodes(prev, 3) == [1, 3]


def test_path_line_orients_and_joins_edges():
    g = line_graph()
    coords = path_line(g, [1, 2, 3])
    assert coords == [(126.0, 34.0), (126.0013, 34.0), (126.0022, 34.0)]  # 뒤집혀 저장된 선도 바르게
    assert raw_distance(g, [1, 2, 3]) == 200.0


# ---------------------------------------------------------------- B·C·D
def row(tid, cam, start_s, sim, entry=None, exit_=None):
    return CandidateRow(tid, cam, T0 + timedelta(seconds=start_s), T0 + timedelta(seconds=start_s + 5), entry, exit_, sim)


def run(rows, oof=None, **anchor_kw):
    g = line_graph()
    anchor = Anchor(node_id=1, time=T0, direction=anchor_kw.pop("direction", "forward"), **anchor_kw)
    dist, prev = dijkstra(g, 1)
    paths = {c: path_nodes(prev, c) for c in (1, 2, 3, 4)}
    return evaluate(rows, anchor, dist, paths, max_speed_mps=2.0, threshold=0.6, out_of_filter_threshold=oof)


def test_time_feasibility_uses_max_speed_minimum_travel_time():
    # 카메라 3까지 200m, 최대 2m/s → 최소 100초
    out = run([row(1, 3, 150, 0.7), row(2, 3, 50, 0.7)])
    assert [s.row.tracklet_id for s in out] == [1]  # 50초 만에 나타난 후보는 예외 기준이 없어 빠진다
    s = out[0]
    assert s.time_feasible is True and s.minimum_travel_time_s == 100.0 and s.available_time_s == 150.0
    assert s.reason_codes == ["APPEARANCE_MATCH", "TIME_FEASIBLE"]
    assert "도보 최소 1.7분" in s.summary and "2.5분 뒤" in s.summary


def test_r5_out_of_filter_exception_needs_both_thresholds():
    rows = [row(1, 3, 50, 0.84), row(2, 3, 50, 0.86)]
    assert [s.row.tracklet_id for s in run(rows, oof=0.85)] == [2]
    s = run(rows, oof=0.85)[0]
    assert s.time_feasible is False and "TIME_REVIEW_REQUIRED" in s.reason_codes
    assert run(rows, oof=None) == []  # null = 예외 허용 안 함


def test_unknown_route_is_included_for_manual_review():
    s = run([row(1, 4, 30, 0.65)])[0]
    assert s.time_feasible is None and s.minimum_travel_time_s is None
    assert s.reason_codes == ["APPEARANCE_MATCH", "ROUTE_UNKNOWN", "MANUAL_REVIEW_REQUIRED"]


def test_threshold_direction_and_anchor_self_are_filtered():
    rows = [row(1, 3, 150, 0.59), row(2, 3, -60, 0.9), row(3, 1, 10, 0.9)]
    assert [s.row.tracklet_id for s in run(rows, tracklet_id=3)] == []
    back = run([row(5, 3, -400, 0.8)], direction="backward")  # 기준보다 395초 전에 끝남
    assert back[0].time_feasible is True and back[0].available_time_s == 395.0


def test_route_consistency_lowers_rank_only():
    path = [1, 2, 3]
    a = Anchor(node_id=1, time=T0, direction="forward", exit_node_id=2)
    assert route_consistency(a, path, row(1, 3, 0, 0.7, entry=2)) is True
    assert route_consistency(a, path, row(1, 3, 0, 0.7, entry=4)) is False
    assert route_consistency(Anchor(1, T0, "forward"), path, row(1, 3, 0, 0.7)) is None
    assert route_consistency(a, [3], row(1, 3, 0, 0.7, entry=2)) is None  # 같은 카메라
    out = run([row(1, 3, 150, 0.72, entry=4), row(2, 3, 160, 0.70, entry=2)], exit_node_id=2)
    assert [s.row.tracklet_id for s in out] == [2, 1]  # 0.72지만 방향이 어긋난 후보가 뒤로
    assert out[1].route_consistent is False and "방향이 경로와 다름" in out[1].summary


def test_minutes_text():
    assert [minutes(45), minutes(90), minutes(120), minutes(900)] == ["45초", "1.5분", "2분", "15분"]


# ---------------------------------------------------------------- G
def test_area_follows_roads_and_levels_are_nested():
    from shapely.geometry import shape

    from app.area_algo import Hazard, compute_area, penalized_distances

    g = line_graph()
    dist, prev = dijkstra(g, 1)
    pond = {"type": "Polygon", "coordinates": [[[126.0015, 33.9998], [126.0018, 33.9998], [126.0018, 34.0002], [126.0015, 33.9998]]]}
    res = compute_area(g, 1, g.nodes[1], dist=penalized_distances(dist, prev, 1), reach_m=200.0, extra_m=0.0,
                       ratios=[0.5, 0.8, 1.0], buffer_m=10.0, elapsed_s=200.0,
                       hazards=[Hazard(7, "연못", "high", pond)])
    assert [l["label"] for l in res.levels] == ["높음", "중간", "낮음"]
    assert [l["max_travel_time_s"] for l in res.levels] == [100.0, 160.0, 200.0]
    shapes = [shape(l["geometry"]) for l in res.levels]
    assert shapes[0].area < shapes[1].area < shapes[2].area and shapes[2].buffer(1e-6).contains(shapes[0])  # 좌표 반올림(약 1cm) 여유
    # 길(동서 방향)을 따라 길게 퍼진다: 남북 폭은 버퍼(10m) 수준
    minx, miny, maxx, maxy = shapes[2].bounds
    assert (maxx - minx) * 92_000 > 150 and (maxy - miny) * 110_000 < 40
    assert res.hazard_overlaps[0]["zone_id"] == 7 and res.hazard_overlaps[0]["level"] == 2  # 길 따라 137~164m: 2단계(160m)부터 닿음
    assert res.priority_areas[0]["rank"] == 1 and res.priority_areas[1]["hazard_zone_ids"] == [7]


def test_penalties_for_exit_direction_and_absence():
    from app.area_algo import penalized_distances

    g = line_graph()
    g.add_edge(EdgeInfo(13, 1, 4, 100.0, 100.0, 80.0, None))
    dist, prev = dijkstra(g, 1)
    p = penalized_distances(dist, prev, 1, exit_node=2)
    assert p[2] == 120.0 and p[4] == 150.0  # 이탈 방향(2)이 아닌 4 쪽은 1.5배
    p = penalized_distances(dist, prev, 1, silent_cameras={2})
    assert p[3] == 300.0  # 나타나지 않은 2를 지나야 닿는 3은 1.5배


# ---------------------------------------------------------------- H·경로 제공자·쌍 고르기
def test_watch_alert_level_and_reason():
    from app.watch_worker import alert_reason, classify_level, cosine

    assert classify_level(0.55, 0.6, 0.8) is None
    assert classify_level(0.7, 0.6, 0.8) == "mid" and classify_level(0.85, 0.6, 0.8) == "high"
    r = alert_reason(0.85, 0.6, "m", min_travel_s=120, available_s=600)
    assert r["time_feasible"] is True and r["reason_codes"] == ["APPEARANCE_MATCH", "TIME_FEASIBLE"]
    assert alert_reason(0.85, 0.6, "m", min_travel_s=None, available_s=60)["time_feasible"] is None
    assert cosine([1, 0], [1, 0]) == pytest.approx(1.0) and cosine([1, 0], [0, 1]) == pytest.approx(0.0)


def test_tmap_parse_and_straight_estimate():
    from app.walk_route import parse_tmap, straight_route

    data = {"features": [
        {"geometry": {"type": "Point", "coordinates": [126.0, 34.0]}, "properties": {"totalDistance": 215, "totalTime": 180}},
        {"geometry": {"type": "LineString", "coordinates": [[126.0, 34.0], [126.001, 34.0]]}, "properties": {}},
        {"geometry": {"type": "LineString", "coordinates": [[126.001, 34.0], [126.002, 34.0005]]}, "properties": {}},
    ]}
    r = parse_tmap(data)
    assert r.ok and r.distance_m == 215 and r.duration_s == 180 and len(r.coords) == 3
    assert not parse_tmap({"features": []}).ok
    s = straight_route((126.0, 34.0), (126.001, 34.0))
    assert s.ok and s.error_code == "STRAIGHT_LINE_ESTIMATE" and 115 < s.distance_m < 125  # 92m × 1.3


def test_pairs_skip_case_to_case_links():
    from app.walk_worker import pairs_to_compute

    nodes = {1: ("global", None), 2: ("global", None), 5: ("case", 9), 6: ("case", 10)}
    assert pairs_to_compute(nodes, node_ids=None, edge_pairs=None) == [(1, 2), (1, 5), (1, 6), (2, 5), (2, 6)]
    assert pairs_to_compute(nodes, node_ids=[5], edge_pairs=None) == [(1, 5), (2, 5)]
    assert pairs_to_compute(nodes, node_ids=None, edge_pairs=[(2, 1)]) == [(1, 2)]
