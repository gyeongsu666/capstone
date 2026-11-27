"""Create a local DB password once; never print the credential."""
from pathlib import Path
import os
import secrets

root = Path(__file__).resolve().parents[1]
path = root / '.env'
try:
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
except FileExistsError:
    print('.env already exists; kept unchanged')
else:
    with os.fdopen(fd, 'w') as stream:
        stream.write(f'POSTGRES_PASSWORD={secrets.token_hex(24)}\nPOSTGRES_PORT=5432\n')
    print('Created .env with mode 0600')
