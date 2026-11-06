#!/usr/bin/env python3
"""Run the actual serve command with local dummy servers, then stop its process group."""
import os
from pathlib import Path
import shutil
import signal
import socket
import subprocess
import tempfile
import time

ROOT = Path(__file__).resolve().parents[1]
OFFSET = int(os.environ.get('T167_TEST_PORT_OFFSET', '0'))
PORTS = tuple(port + OFFSET for port in (3000, 8080, 8081, 9099))
STUB = '''#!/usr/bin/env python3
import os,socket,sys,time
offset=int(os.environ.get('T167_TEST_PORT_OFFSET','0'))
if sys.argv[0].endswith('firebase'):
    ports=[8080,9099]
elif sys.argv[1:]==['--prefix','firebase','run','seed']:
    raise SystemExit(0)
elif sys.argv[1:]==['--prefix','api','run','dev']:
    ports=[8081]
elif sys.argv[1:5]==['--prefix','web','run','dev']:
    ports=[3000]
else:
    raise SystemExit('Unexpected command: '+repr(sys.argv))
sockets=[]
for port in ports:
    port+=offset
    s=socket.socket();s.setsockopt(socket.SOL_SOCKET,socket.SO_REUSEADDR,1)
    s.bind(('127.0.0.1',port));s.listen(8);sockets.append(s)
while True:time.sleep(1)
'''

def ports_free():
    for port in PORTS:
        with socket.socket() as s:
            s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            try:
                s.bind(('127.0.0.1', port))
            except OSError:
                return False
    return True

def trial(sig):
    if not ports_free():
        raise RuntimeError('serveの停止検査には3000・8080・8081・9099が空いている必要があります。serveを止めてからcheckを実行してください')
    with tempfile.TemporaryDirectory(prefix='t167-serve-') as directory:
        root = Path(directory)
        (root/'scripts').mkdir()
        shutil.copyfile(ROOT/'scripts/dev.sh', root/'scripts/dev.sh')
        shutil.copyfile(ROOT/'firebase.json', root/'firebase.json')
        fb = root/'firebase/node_modules/.bin/firebase'
        fb.parent.mkdir(parents=True)
        npm = root/'bin/npm'
        npm.parent.mkdir()
        for executable in (fb, npm):
            executable.write_text(STUB)
            executable.chmod(0o755)
        env = dict(os.environ, GEMINI_MOCK='1', PATH=str(npm.parent)+os.pathsep+os.environ['PATH'])
        with (root/'output.log').open('w+') as output:
            process = subprocess.Popen(['bash', str(root/'scripts/dev.sh'), 'serve'], env=env,
                                       stdout=output, stderr=subprocess.STDOUT, start_new_session=True)
            try:
                for _ in range(200):
                    output.flush()
                    if f'== http://localhost:{3000+OFFSET}' in (root/'output.log').read_text():
                        break
                    if process.poll() is not None:
                        raise RuntimeError('serve exited before readiness: '+(root/'output.log').read_text()[-2000:])
                    time.sleep(0.05)
                else:
                    raise RuntimeError('serve did not become ready')
                assert os.getpgid(process.pid) == process.pid
                os.killpg(process.pid, sig)
                code = process.wait(timeout=5)
                if code not in (0, -signal.SIGTERM, -signal.SIGINT, 128+signal.SIGTERM, 128+signal.SIGINT):
                    raise RuntimeError('serve stopped abnormally: '+str(code))
                for _ in range(100):
                    if ports_free():
                        return
                    time.sleep(0.05)
                raise RuntimeError('a child server still owns a port after shutdown')
            finally:
                # The session is created by this test; never signal another process group.
                try:
                    os.killpg(process.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
                process.wait()

failed = 0
for sig in (signal.SIGINT, signal.SIGTERM):
    try:
        trial(sig)
        print('PASS serveを'+sig.name+'で止めると再帰せず子プロセスも終了する', flush=True)
    except Exception as error:
        failed += 1
        print('FAIL '+sig.name+': '+str(error), flush=True)
print(f'dev-serve: {2-failed} PASS / {failed} FAIL')
raise SystemExit(1 if failed else 0)
