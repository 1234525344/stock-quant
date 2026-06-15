import os, sys, time

# Fix OpenBLAS memory issue on Windows
os.environ['OPENBLAS_NUM_THREADS'] = '1'
os.environ['OMP_NUM_THREADS'] = '1'
os.environ['MKL_NUM_THREADS'] = '1'
os.environ['NUMEXPR_NUM_THREADS'] = '1'

print(f'{time.strftime("%H:%M:%S")} Starting...', flush=True)

try:
    import numpy
    print(f'{time.strftime("%H:%M:%S")} numpy OK', flush=True)
except Exception as e:
    print(f'numpy error: {e}', flush=True)
    sys.exit(1)

try:
    import qlib
    print(f'{time.strftime("%H:%M:%S")} qlib {qlib.__version__} OK', flush=True)
except Exception as e:
    print(f'qlib error: {e}', flush=True)
    sys.exit(1)

try:
    from qlib.constant import REG_CN
    qlib.init(provider_uri='C:/Users/lb/.qlib/qlib_data/cn_data', region=REG_CN)
    print(f'{time.strftime("%H:%M:%S")} init OK!', flush=True)
except Exception as e:
    print(f'init error: {e}', flush=True)
    import traceback
    traceback.print_exc()
    sys.exit(1)
