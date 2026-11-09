"""speech/setup_models.py：控えの再利用と、取得先の一時的な障害での取り直しを確かめる（外部には接続しない）。"""
import hashlib
import importlib.util
import io
import os
import pathlib
import sys
import tempfile
import unittest
from unittest import mock

ROOT = pathlib.Path(__file__).resolve().parent.parent


def load(model_dir, cache_dir):
    with mock.patch.dict(os.environ, {'SPEAKER_MODEL_DIR': str(model_dir), 'SPEAKER_MODEL_CACHE': str(cache_dir)}):
        spec = importlib.util.spec_from_file_location('setup_models', ROOT / 'speech' / 'setup_models.py')
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
    return module


class Response(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, *args):
        self.close()


BODY = b'fake-onnx-model'
DIGEST = hashlib.sha256(BODY).hexdigest()


class SetupModelsTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        base = pathlib.Path(self.tmp.name)
        self.models, self.cache = base / 'models', base / 'cache'
        self.cache.mkdir()
        self.m = load(self.models, self.cache)
        self.m.models = [('m.onnx', 'https://example.invalid/m.onnx', DIGEST)]
        self.sleeps = []
        patcher = mock.patch.object(self.m.time, 'sleep', side_effect=self.sleeps.append)
        patcher.start()
        self.addCleanup(patcher.stop)

    def tearDown(self):
        self.tmp.cleanup()

    def test_控えのハッシュが一致すれば取得先に取りに行かない(self):
        (self.cache / 'm.onnx').write_bytes(BODY)
        with mock.patch.object(self.m.urllib.request, 'urlopen', side_effect=AssertionError('取得先に接続した')):
            self.m.main()
        self.assertEqual((self.models / 'm.onnx').read_bytes(), BODY)

    def test_控えのハッシュが違えば取得先から取る(self):
        (self.cache / 'm.onnx').write_bytes(b'broken')
        with mock.patch.object(self.m.urllib.request, 'urlopen', return_value=Response(BODY)) as urlopen:
            self.m.main()
        self.assertEqual(urlopen.call_count, 1)
        self.assertEqual((self.models / 'm.onnx').read_bytes(), BODY)

    def test_取得先が一時的に失敗しても取り直して取れる(self):
        calls = [OSError('HTTP Error 504'), OSError('HTTP Error 504'), Response(BODY)]
        with mock.patch.object(self.m.urllib.request, 'urlopen', side_effect=calls):
            self.m.main()
        self.assertEqual(self.sleeps, [5, 10])
        self.assertEqual((self.models / 'm.onnx').read_bytes(), BODY)

    def test_取り直しても取れなければ止まり書きかけを残さない(self):
        with mock.patch.object(self.m.urllib.request, 'urlopen', side_effect=OSError('HTTP Error 504')):
            with self.assertRaises(OSError):
                self.m.main()
        self.assertEqual(self.sleeps, [5, 10, 20])
        self.assertEqual(sorted(p.name for p in self.models.iterdir()), [])

    def test_本物のモデルの名前とハッシュを変えていない(self):
        actual = [(name, digest) for name, _, digest in load(self.models, self.cache).models]
        self.assertEqual(actual, [
            ('campplus.onnx', 'aa3cfc16963a10586a9393f5035d6d6b57e98d358b347f80c2a30bf4f00ceba2'),
            ('silero-vad.onnx', '9e2449e1087496d8d4caba907f23e0bd3f78d91fa552479bb9c23ac09cbb1fd6'),
        ])


if __name__ == '__main__':
    sys.exit(0 if unittest.main(exit=False).result.wasSuccessful() else 1)
