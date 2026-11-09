"""明示セットアップ時だけ公式モデルを用意する。アプリ起動時には取得しない。

同じハッシュのモデルが控え（SPEAKER_MODEL_CACHE、既定は speech/models-cache）にあれば、取得せずにそれを使う。
本番のデプロイは、いま動いている API のイメージからモデルを控えに取り出してから、このスクリプトを動かす
（.github/workflows/deploy.yml）。外部の取得先の障害でデプロイが止まらないようにするため。
控えにないときだけ取得先から取り、504 などで失敗したら、間をあけて取り直す。どの経路でも SHA-256 で照合する。
"""
import hashlib
import os
import pathlib
import shutil
import time
import urllib.request

HERE = pathlib.Path(__file__).resolve().parent
root = pathlib.Path(os.environ.get('SPEAKER_MODEL_DIR', HERE.parent / '.local-data' / 'speaker-models'))
cache = pathlib.Path(os.environ.get('SPEAKER_MODEL_CACHE', HERE / 'models-cache'))
models = [
    ('campplus.onnx', 'https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-recongition-models/3dspeaker_speech_campplus_sv_zh_en_16k-common_advanced.onnx', 'aa3cfc16963a10586a9393f5035d6d6b57e98d358b347f80c2a30bf4f00ceba2'),
    ('silero-vad.onnx', 'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/silero_vad.onnx', '9e2449e1087496d8d4caba907f23e0bd3f78d91fa552479bb9c23ac09cbb1fd6'),
]
ATTEMPTS = 4
WAIT_SECONDS = 5


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def download(url, destination):
    """取得先から取る。失敗したら 5・10・20 秒あけて取り直し、それでも失敗したら例外を投げる。"""
    for attempt in range(ATTEMPTS):
        try:
            with urllib.request.urlopen(url, timeout=60) as response, destination.open('wb') as output:
                shutil.copyfileobj(response, output, 1024 * 1024)
            return
        except Exception as error:  # 取得先の一時的な障害（HTTP 504 など）
            if attempt == ATTEMPTS - 1:
                raise
            wait = WAIT_SECONDS * 2 ** attempt
            print(f'{url}: {error}。{wait}秒後に取り直す', flush=True)
            time.sleep(wait)


def main():
    root.mkdir(parents=True, exist_ok=True)
    for name, url, digest in models:
        path = root / name
        if path.is_file() and sha256(path) == digest:
            print(name + ': verified')
            continue
        cached = cache / name
        if cached.is_file() and sha256(cached) == digest:
            shutil.copyfile(cached, path)
            print(name + ': verified (cache)')
            continue
        temporary = path.with_suffix('.download')
        try:
            download(url, temporary)
            if sha256(temporary) != digest:
                raise ValueError('model_checksum_mismatch')
            temporary.replace(path)
            print(name + ': verified')
        finally:
            if temporary.exists():
                temporary.unlink()


if __name__ == '__main__':
    main()
