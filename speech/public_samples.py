"""Sherpa公式例が参照する公開人声を検証用に取得。音声は.local-dataのみ、配布しない。"""
import hashlib
import json
import pathlib
import urllib.request
import wave

root = pathlib.Path(__file__).resolve().parent.parent / '.local-data' / 'public-voices'
root.mkdir(parents=True, exist_ok=True)
with urllib.request.urlopen('https://api.github.com/repos/csukuangfj/sr-data/git/ref/heads/main') as response:
    revision = json.load(response)['object']['sha']
groups = [(['fangjun-sr-1.wav', 'fangjun-sr-2.wav', 'fangjun-sr-3.wav'], 'fangjun-test-sr-1.wav'),
          (['leijun-sr-1.wav', 'leijun-sr-2.wav'], 'leijun-test-sr-1.wav')]
manifest = {'repository': 'https://github.com/csukuangfj/sr-data', 'revision': revision, 'license': 'Apache-2.0', 'samples': []}
def download(path):
    url = 'https://raw.githubusercontent.com/csukuangfj/sr-data/' + revision + '/' + path
    dest = root / path.replace('/', '-')
    with urllib.request.urlopen(url, timeout=60) as response:
        data = response.read()
    dest.write_bytes(data)
    manifest['samples'].append({'url': url, 'sha256': hashlib.sha256(data).hexdigest()})
    with wave.open(str(dest)) as reader:
        if (reader.getnchannels(), reader.getsampwidth(), reader.getframerate()) != (1, 2, 16000):
            raise ValueError('expected_16k_mono_pcm16')
        return reader.readframes(reader.getnframes())
def save(name, pcm):
    with wave.open(str(root / name), 'wb') as writer:
        writer.setnchannels(1); writer.setsampwidth(2); writer.setframerate(16000); writer.writeframes(pcm)
tests = []
for i, (enroll, test) in enumerate(groups, 1):
    pcm = b''.join(download('enroll/' + name) for name in enroll)
    if len(pcm) < 8 * 32000:
        raise ValueError('enrollment_too_short')
    save('speaker-' + str(i) + '-enroll.wav', pcm[:8 * 32000])
    test_pcm = download('test/' + test)
    save('speaker-' + str(i) + '-test.wav', test_pcm)
    tests.append(test_pcm)
save('discussion.wav', tests[0] + b'\0' * 32000 + tests[1] + b'\0' * 32000)
(root / 'sources.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2))
print('公開サンプルを.local-data/public-voicesへ準備しました。音声はGit管理しません。')
