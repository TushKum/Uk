"""Run the local macOS demo with persistent app and database storage."""
from pathlib import Path
import hashlib
import os
import re
import shutil
import subprocess
import sys

source = Path(__file__).resolve().parents[1]
base = Path.home() / 'Library/Application Support/LeakLoop'
runtime, data = base / 'runtime', base / 'postgres'
base.mkdir(parents=True, exist_ok=True)
base.chmod(0o700)
runtime.mkdir(exist_ok=True)

def run(args, **kwargs):
    subprocess.run(args, check=True, **kwargs)

# Copy file contents only: avoid cloud-folder metadata and never overwrite the
# runtime's account file or database with an older workspace snapshot.
if source != runtime:
    for parent, dirs, names in os.walk(source):
        dirs[:] = [d for d in dirs if d not in {'node_modules', '.next', '.postgres', '.git', '__pycache__'}]
        for name in names:
            if name.endswith(('.log', '.tsbuildinfo')):
                continue
            original = Path(parent) / name
            target = runtime / original.relative_to(source)
            if name in {'.env.local', '.local-accounts.json'} and target.exists():
                continue
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(original.read_bytes())
            if name in {'.env.local', '.local-accounts.json'}:
                target.chmod(0o600)

# This command intentionally uses an isolated local database. For an externally
# managed database, use the ordinary setup/build/local commands instead.
pg_config = shutil.which('pg_config')
if not pg_config:
    sys.exit('PostgreSQL is required. Install it with Homebrew and put pg_config on PATH.')
bin_dir = Path(subprocess.check_output([pg_config, '--bindir'], text=True).strip())
pg_ctl = str(bin_dir / 'pg_ctl')
if not (data / 'PG_VERSION').exists():
    if data.exists() and any(data.iterdir()):
        sys.exit('Database directory is incomplete; inspect it before initializing.')
    run([str(bin_dir / 'initdb'), '-D', str(data), '-U', 'leakloop', '-A', 'trust'])
version = subprocess.check_output([str(bin_dir / 'postgres'), '--version'], text=True)
major = int(re.search(r'(\d+)\.', version).group(1))
options = '-p 55433 -h 127.0.0.1 -k /tmp' + (' -c io_method=sync' if major >= 18 else '')
if subprocess.run([pg_ctl, '-D', str(data), 'status'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode:
    run([pg_ctl, '-D', str(data), '-l', str(base / 'postgres.log'), '-o', options, '-w', '-t', '120', 'start'])
env = dict(os.environ, DATABASE_URL='postgresql://leakloop@127.0.0.1:55433/postgres')
lock_hash = hashlib.sha256((runtime / 'package-lock.json').read_bytes()).hexdigest()
marker = runtime / '.installed-lock'
if not (runtime / 'node_modules').is_dir() or not marker.exists() or marker.read_text() != lock_hash:
    run(['npm', 'ci'], cwd=runtime, env=env)
    marker.write_text(lock_hash)
run(['npm', 'run', 'setup'], cwd=runtime, env=env)
# Keep the workspace account file aligned on first setup without printing secrets.
accounts = runtime / '.local-accounts.json'
if source != runtime and not (source / '.local-accounts.json').exists():
    (source / '.local-accounts.json').write_bytes(accounts.read_bytes())
    (source / '.local-accounts.json').chmod(0o600)
run(['npm', 'run', 'build'], cwd=runtime, env=env)
print('LeakLoop: http://127.0.0.1:3001 — persistent data in ' + str(base), flush=True)
os.chdir(runtime)
os.environ.update(env)
os.execvp('npm', ['npm', 'run', 'local'])
