"""비밀번호 해시, 임시 비밀번호, 세션·CSRF 토큰."""
import hashlib
import hmac
import secrets
import string

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError

from app.config import get_settings

_hasher = PasswordHasher()
PASSWORD_MIN, PASSWORD_MAX = 10, 128  # openapi PasswordChangeRequest 제안값
_ALPHABET = string.ascii_letters + string.digits
# 없는 아이디로 로그인할 때도 같은 시간이 걸리게 하는 더미 해시
_DUMMY_HASH = _hasher.hash(secrets.token_hex(16))


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(password_hash: str | None, password: str) -> bool:
    try:
        return _hasher.verify(password_hash or _DUMMY_HASH, password) and password_hash is not None
    except (VerificationError, InvalidHashError):
        return False


def needs_rehash(password_hash: str) -> bool:
    return _hasher.check_needs_rehash(password_hash)


def temporary_password(length: int = 16) -> str:
    """관리자 발급용 임시 비밀번호. 첫 로그인 때 바꾸게 한다(must_change_password)."""
    return "".join(secrets.choice(_ALPHABET) for _ in range(length))


def password_policy_error(password: str) -> str | None:
    """10~128자. 맞으면 None, 아니면 사용자에게 보여 줄 문장."""
    if not (PASSWORD_MIN <= len(password) <= PASSWORD_MAX):
        return f"비밀번호는 {PASSWORD_MIN}~{PASSWORD_MAX}자로 정해 주세요."
    if password.strip() != password:
        return "비밀번호 앞뒤에 공백을 둘 수 없어요."
    return None


def new_session_token() -> str:
    """쿠키에 넣는 원문 토큰. DB에는 session_token_hash()만 저장한다."""
    return secrets.token_urlsafe(32)


def session_token_hash(token: str) -> str:
    key = get_settings().session_secret.encode()
    return hmac.new(key, token.encode(), hashlib.sha256).hexdigest()


def new_csrf_token() -> str:
    return secrets.token_urlsafe(32)


def tokens_equal(a: str | None, b: str | None) -> bool:
    return bool(a) and bool(b) and hmac.compare_digest(a.encode(), b.encode())
