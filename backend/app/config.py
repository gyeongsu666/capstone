"""환경 변수 설정. compose.yaml의 x-backend-env와 .env.example을 함께 고친다."""
from functools import lru_cache
from pathlib import Path
from typing import Annotated

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    database_url: str = "postgresql+psycopg://capstone:capstone@127.0.0.1:5432/capstone"
    redis_url: str = "redis://127.0.0.1:6379/0"
    media_root: Path = Path("./data/media")
    model_root: Path = Path("../모델벤치")

    # 세션 쿠키 서명·토큰 해시용 비밀값. scripts/init_env.py가 만든다.
    session_secret: str = Field(default="dev-only-change-me", min_length=16)
    session_cookie_name: str = "refind_session"
    session_idle_minutes: int = 60
    session_absolute_hours: int = 12
    cookie_secure: bool = False
    # 쉼표로 구분한 문자열로 받는다(JSON 아님)
    allowed_origins: Annotated[list[str], NoDecode] = ["http://localhost:5173"]

    idempotency_ttl_hours: int = 24

    # 도보 경로(app/walk_route.py). tmap: SK 보행자 경로 API, straight: 직선 × 우회 계수 추정
    walk_route_provider: str = "tmap"
    tmap_app_key: str = ""
    straight_detour_factor: float = 1.3
    straight_walk_speed_mps: float = 1.2
    detour_suspect_ratio: float = 1.8  # 직선 대비 이 이상이면 우회 의심(검증 현황의 기준)

    # Re-ID 모델(모델 브랜치 IntelEncoder와 같아야 한다)
    reid_model_name: str = "person-reidentification-retail-0287"
    reid_dimension: int = 256

    @field_validator("allowed_origins", mode="before")
    @classmethod
    def split_origins(cls, value):
        if isinstance(value, str):
            return [v.strip() for v in value.split(",") if v.strip()]
        return value


@lru_cache
def get_settings() -> Settings:
    return Settings()
