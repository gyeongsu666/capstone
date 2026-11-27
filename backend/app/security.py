"""비밀번호 해시와 임시 비밀번호. 세션·CSRF는 3단계에서 이 파일에 더한다."""
import secrets
import string

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError

_hasher = PasswordHasher()
PASSWORD_MIN, PASSWORD_MAX = 10, 128  # openapi PasswordChangeRequest 제안값
_ALPHABET = string.ascii_letters + string.digits


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(password_hash: str, password: str) -> bool:
    try:
        return _hasher.verify(password_hash, password)
    except (VerificationError, InvalidHashError):
        return False


def needs_rehash(password_hash: str) -> bool:
    return _hasher.check_needs_rehash(password_hash)


def temporary_password(length: int = 16) -> str:
    """관리자 발급용 임시 비밀번호. 첫 로그인 때 바꾸게 한다(must_change_password)."""
    return "".join(secrets.choice(_ALPHABET) for _ in range(length))
