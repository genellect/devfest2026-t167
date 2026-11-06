"""Download the published WeSpeaker model; never overwrite a valid local model."""
import os
from pathlib import Path
import urllib.request

target = Path(os.environ.get('MVP_VOICE_MODEL', '/app/voice/model.onnx'))
target.parent.mkdir(parents=True, exist_ok=True)
if not target.exists():
    temporary = target.with_suffix('.download')
    urllib.request.urlretrieve(
        'https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-recongition-models/wespeaker_zh_cnceleb_resnet34.onnx',
        temporary,
    )
    if temporary.stat().st_size < 1000000:
        temporary.unlink()
        raise ValueError('incomplete voice model')
    temporary.replace(target)
