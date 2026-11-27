"""서버에서 한 번 실행해 .env를 만든다. 비밀값은 화면에 출력하지 않는다.

이미 .env가 있으면 없는 키만 덧붙이고 기존 값은 그대로 둔다.
도보 경로 API 키는 직접 .env에 적는다(TMAP_APP_KEY=...). 키가 없으면 WALK_ROUTE_PROVIDER=straight.
"""
from pathlib import Path
import os
import secrets

ROOT = Path(__file__).resolve().parents[1]
PATH = ROOT / ".env"

DEFAULTS = {
    "POSTGRES_PASSWORD": lambda: secrets.token_hex(24),
    "SESSION_SECRET": lambda: secrets.token_hex(32),
    "POSTGRES_PORT": lambda: "5432",
    "API_BIND": lambda: "127.0.0.1",
    "API_PORT": lambda: "8000",
    "ALLOWED_ORIGINS": lambda: "http://localhost:5173",
    "COOKIE_SECURE": lambda: "false",
    "MEDIA_ROOT_HOST": lambda: "./data/media",
    "WALK_ROUTE_PROVIDER": lambda: "tmap",
    "TMAP_APP_KEY": lambda: "",
}


def read_keys(path: Path) -> set[str]:
    keys = set()
    for line in path.read_text(encoding="utf-8").splitlines():
        if line and not line.startswith("#") and "=" in line:
            keys.add(line.split("=", 1)[0].strip())
    return keys


def main() -> None:
    if PATH.exists():
        missing = [k for k in DEFAULTS if k not in read_keys(PATH)]
        if not missing:
            print(".env already has every key; kept unchanged")
            return
        with PATH.open("a", encoding="utf-8") as stream:
            stream.write("\n" + "".join(f"{k}={DEFAULTS[k]()}\n" for k in missing))
        print("Added to .env: " + ", ".join(missing))
        return
    fd = os.open(PATH, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as stream:
        stream.write("".join(f"{k}={make()}\n" for k, make in DEFAULTS.items()))
    print("Created .env with mode 0600 (secrets not printed)")


if __name__ == "__main__":
    main()
