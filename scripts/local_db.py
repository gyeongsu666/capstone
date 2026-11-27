"""Manage this project's isolated, socket-only verification PostgreSQL 18."""
import argparse
import os
from pathlib import Path
import subprocess
import sys

ROOT=Path(__file__).resolve().parents[1]
BASE=ROOT/'.runtime/pg-root'
BIN=BASE/'usr/lib/postgresql/18/bin'
DATA=ROOT/'.runtime/pgdata'
SOCKET=ROOT/'.runtime/pgsocket'
DSN=f'postgresql://capstone@/capstone?host={SOCKET}&port=55432'
ENV=dict(os.environ, LD_LIBRARY_PATH=str(BASE/'usr/lib/x86_64-linux-gnu'),
    PROJ_DATA=str(BASE/'usr/share/proj'))


def cmd(name,*args,check=True):
    return subprocess.run([str(BIN/name),*map(str,args)],env=ENV,check=check)


def start():
    if not (DATA/'PG_VERSION').exists():
        raise RuntimeError('Local DB packages/data are missing; see README_SERVER.md')
    SOCKET.mkdir(mode=0o700,exist_ok=True)
    if cmd('pg_ctl','-D',DATA,'status',check=False).returncode==0: return
    config=DATA/'project.conf'
    config.write_text(f"listen_addresses = '127.0.0.1'\nport = 55432\nunix_socket_directories = '{SOCKET}'\nunix_socket_permissions = 0700\nextension_control_path = '{BASE}/usr/share/postgresql/18'\ndynamic_library_path = '{BASE}/usr/lib/postgresql/18/lib'\njit = off\n")
    # Include an explicit project-owned configuration; no system service is touched.
    cmd('pg_ctl','-D',DATA,'-l',ROOT/'.runtime/postgres.log',
        '-o',f'-c config_file={config}','-w','start')


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('command',choices=['start','stop','status','run','init-schema','shell'])
    p.add_argument('args',nargs=argparse.REMAINDER)
    a=p.parse_args()
    if a.command=='start': start()
    elif a.command=='stop': cmd('pg_ctl','-D',DATA,'-m','fast','-w','stop')
    elif a.command=='status': cmd('pg_ctl','-D',DATA,'status')
    elif a.command=='shell':
        cmd('psql',DSN,*a.args)
    elif a.command=='run':
        if not a.args: p.error('run requires a command')
        result=subprocess.run(a.args,env=dict(os.environ,DATABASE_URL=DSN))
        sys.exit(result.returncode)
    else:
        start()
        # Run once on a fresh capstone DB. Existing schemas must use migrations.
        cmd('createdb','-h',SOCKET,'-p','55432','-U','capstone','capstone')
        for sql in sorted((ROOT/'db').glob('*.sql')):
            cmd('psql',DSN,'-v','ON_ERROR_STOP=1','-f',sql)

if __name__=='__main__': main()
