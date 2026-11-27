"""Run the five local benchmarks from the repository root on Windows or Linux."""
from pathlib import Path
import runpy
import sys


if __name__ == '__main__':
    folder = Path(__file__).resolve().parents[1] / '모델벤치'
    sys.path.insert(0, str(folder))
    runpy.run_path(str(folder / '00_run_all_benchmarks.py'), run_name='__main__')
