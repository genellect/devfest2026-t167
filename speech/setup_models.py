"""明示セットアップ時だけ公式モデルを取得する。アプリ起動時には取得しない。"""
import hashlib
import pathlib
import urllib.request
root = pathlib.Path(__file__).resolve().parent.parent / '.local-data' / 'speaker-models'
root.mkdir(parents=True, exist_ok=True)
models = [
    ('campplus.onnx', 'https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-recongition-models/3dspeaker_speech_campplus_sv_zh_en_16k-common_advanced.onnx', 'aa3cfc16963a10586a9393f5035d6d6b57e98d358b347f80c2a30bf4f00ceba2'),
    ('silero-vad.onnx', 'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/silero_vad.onnx', '9e2449e1087496d8d4caba907f23e0bd3f78d91fa552479bb9c23ac09cbb1fd6'),
]
for name, url, digest in models:
    path = root / name
    if path.is_file() and hashlib.sha256(path.read_bytes()).hexdigest() == digest:
        print(name + ': verified')
        continue
    temporary = path.with_suffix('.download')
    try:
        with urllib.request.urlopen(url, timeout=60) as response, temporary.open('wb') as output:
            while True:
                chunk = response.read(1024 * 1024)
                if not chunk:
                    break
                output.write(chunk)
        if hashlib.sha256(temporary.read_bytes()).hexdigest() != digest:
            raise ValueError('model_checksum_mismatch')
        temporary.replace(path)
        print(name + ': verified')
    finally:
        if temporary.exists():
            temporary.unlink()
