"""Shared PostgreSQL connection for tracklet storage and search."""
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def connection_options():
    """Resolve settings without loading a database driver or opening a connection."""
    values = {}
    env = ROOT / '.env'
    if env.exists():
        for line in env.read_text(encoding='utf-8').splitlines():
            if line and not line.startswith('#') and '=' in line:
                key, value = line.split('=', 1)
                values[key] = value

    def setting(key, default=None):
        return os.environ.get(key, values.get(key, default))

    if setting('DATABASE_URL'):
        return setting('DATABASE_URL')
    else:
        password = setting('POSTGRES_PASSWORD')
        if not password:
            raise ValueError('Run python scripts/init_db_env.py first or set DATABASE_URL')
        return dict(host=setting('POSTGRES_HOST', '127.0.0.1'),
            port=setting('POSTGRES_PORT', '5432'),
            dbname=setting('POSTGRES_DB', 'capstone'),
            user=setting('POSTGRES_USER', 'capstone'), password=password)


def connect():
    options = connection_options()
    import psycopg
    from pgvector.psycopg import register_vector

    if isinstance(options, str):
        conn = psycopg.connect(options, connect_timeout=5)
    else:
        conn = psycopg.connect(**options, connect_timeout=5)
    try:
        register_vector(conn)
    except BaseException:
        conn.close()
        raise
    return conn
