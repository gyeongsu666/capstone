"""Shared PostgreSQL connection for tracklet storage and search."""
import os
from pathlib import Path
import psycopg
from pgvector.psycopg import register_vector

ROOT = Path(__file__).resolve().parents[1]


def connect():
    if os.environ.get('DATABASE_URL'):
        conn = psycopg.connect(os.environ['DATABASE_URL'], connect_timeout=5)
    else:
        values = {}
        env = ROOT / '.env'
        if env.exists():
            for line in env.read_text().splitlines():
                if line and not line.startswith('#') and '=' in line:
                    key, value = line.split('=', 1)
                    values[key] = value
        password = os.environ.get('POSTGRES_PASSWORD', values.get('POSTGRES_PASSWORD'))
        if not password:
            raise ValueError('Run python scripts/init_db_env.py first or set DATABASE_URL')
        conn = psycopg.connect(host='127.0.0.1',
            port=os.environ.get('POSTGRES_PORT', values.get('POSTGRES_PORT', '5432')),
            dbname='capstone', user='capstone', password=password, connect_timeout=5)
    try:
        register_vector(conn)
    except BaseException:
        conn.close()
        raise
    return conn
