"""운영 명령. 컨테이너 안에서 `python -m app.cli <명령>`으로 실행한다(scripts/left.sh가 감싼다).

  create-admin <아이디> <이름>   첫 관리자 계정 생성. 임시 비밀번호를 한 번만 출력한다
  seed-demo-settings             시연용 임시 설정값 입력(팀 확정값이 아님, 비어 있을 때만)
  check-workers                  CPU·GPU 워커 왕복 확인
"""
import argparse
import sys

from sqlalchemy import select, update

from app.db import session_scope
from app.models import RetentionPolicy, SystemSettings, User
from app.security import hash_password, temporary_password

# Front docs/mock-scenario.md의 임시값과 같다. 팀이 정하면 관리자 화면에서 바꾼다.
DEMO_SETTINGS = {
    "walking_speed_presets": [
        {"person_type": "adult", "speed_mps": 1.2, "max_speed_mps": 1.8},
        {"person_type": "child", "speed_mps": 1.0, "max_speed_mps": 1.6},
        {"person_type": "elderly", "speed_mps": 0.8, "max_speed_mps": 1.2},
        {"person_type": "other", "speed_mps": 1.0, "max_speed_mps": 1.6},
    ],
    "default_similarity_threshold": 0.6,
    "alert_high_threshold": 0.8,
    "out_of_filter_threshold": None,  # R5 초기값은 null(예외 허용 안 함)
    "area_level_ratios": [0.5, 0.8, 1],
    "area_buffer_m": 30,
    "max_upload_bytes": 2_000_000_000,
}
DEMO_RETENTION = {
    "video_retention_days": 90,
    "closed_case_retention_days": 30,
    "alert_retention_days": 90,
    "audit_retention_days": 365,
}


def create_admin(username: str, display_name: str) -> int:
    username = username.strip()
    if not (1 <= len(username) <= 100) or not (1 <= len(display_name.strip()) <= 100):
        print("아이디와 이름은 1~100자여야 합니다.", file=sys.stderr)
        return 2
    password = temporary_password()
    with session_scope() as db:
        if db.scalar(select(User.id).where(User.username == username)):
            print(f"이미 있는 아이디입니다: {username}", file=sys.stderr)
            return 1
        db.add(
            User(
                username=username,
                display_name=display_name.strip(),
                password_hash=hash_password(password),
                role="admin",
                must_change_password=True,
            )
        )
    print(f"관리자 계정을 만들었습니다: {username}")
    print(f"임시 비밀번호(지금만 표시): {password}")
    print("첫 로그인 때 새 비밀번호(10자 이상)로 바꿔야 합니다.")
    return 0


def seed_demo_settings() -> int:
    with session_scope() as db:
        current = db.get(SystemSettings, 1)
        if current is None:
            print("system_settings가 없습니다. 먼저 migrate를 실행하세요.", file=sys.stderr)
            return 1
        if current.default_similarity_threshold is not None or current.alert_high_threshold is not None:
            print("이미 설정값이 있어 바꾸지 않았습니다(관리자 화면에서 수정).")
            return 0
        db.execute(update(SystemSettings).where(SystemSettings.id == 1).values(**DEMO_SETTINGS))
        db.execute(update(RetentionPolicy).where(RetentionPolicy.id == 1).values(**DEMO_RETENTION))
    print("시연용 임시 설정값을 넣었습니다(팀 확정값 아님).")
    return 0


def check_workers(timeout: float) -> int:
    from app.tasks import ping

    failed = False
    for queue in ("default", "analysis"):
        try:
            result = ping.apply_async(queue=queue).get(timeout=timeout)
            print(f"[{queue}] OK {result}")
        except Exception as e:
            failed = True
            print(f"[{queue}] 응답 없음: {type(e).__name__} {e}", file=sys.stderr)
    return 1 if failed else 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m app.cli", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)
    a = sub.add_parser("create-admin")
    a.add_argument("username")
    a.add_argument("display_name")
    sub.add_parser("seed-demo-settings")
    w = sub.add_parser("check-workers")
    w.add_argument("--timeout", type=float, default=30)
    args = parser.parse_args(argv)
    if args.command == "create-admin":
        return create_admin(args.username, args.display_name)
    if args.command == "seed-demo-settings":
        return seed_demo_settings()
    return check_workers(args.timeout)


if __name__ == "__main__":
    sys.exit(main())
