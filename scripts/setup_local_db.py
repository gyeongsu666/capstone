"""Ubuntu 26.04 only: unpack verification DB into .runtime without system installation."""
import os
from pathlib import Path
import subprocess
import sys

ROOT=Path(__file__).resolve().parents[1]
BASE=ROOT/'.runtime/pg-root'
PACKAGES=ROOT/'.runtime/pg-packages'
DATA=ROOT/'.runtime/pgdata'
if (DATA/'PG_VERSION').exists():
    print('Existing local DB preserved. Use scripts/local_db.py start.')
    sys.exit(0)
PACKAGES.mkdir(parents=True,exist_ok=True)
subprocess.run(['apt','download','postgresql-18','postgresql-client-18',
    'postgresql-18-postgis-3','postgresql-18-postgis-3-scripts','postgresql-18-pgvector',
    'libgeos-c1t64','libgeos3.14.1','libproj25','libprotobuf-c1','proj-data','libpq5'],cwd=PACKAGES,check=True)
for package in PACKAGES.glob('*.deb'):
    subprocess.run(['dpkg-deb','-x',str(package),str(BASE)],check=True)
# Ubuntu normally creates these alternatives in the system post-install hook.
# Here only project-local links are created; no package hooks run.
ext=BASE/'usr/share/postgresql/18/extension'
for source in list(ext.glob('postgis-3*')):
    target=ext/source.name.replace('postgis-3','postgis',1)
    if not target.exists(): target.symlink_to(source.name)
if (DATA/'PG_VERSION').exists():
    print('Existing local DB preserved. Use scripts/local_db.py start.')
else:
    env=dict(os.environ,LD_LIBRARY_PATH=str(BASE/'usr/lib/x86_64-linux-gnu'))
    subprocess.run([str(BASE/'usr/lib/postgresql/18/bin/initdb'),'-D',str(DATA),'-L',
        str(BASE/'usr/share/postgresql/18'),'-U','capstone','--auth-local=trust',
        '--auth-host=scram-sha-256','--no-locale','--encoding=UTF8'],env=env,check=True)
    subprocess.run([sys.executable,str(ROOT/'scripts/local_db.py'),'init-schema'],check=True)
