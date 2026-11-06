"""16kHz mono PCM16 in; speaker embedding JSON out. Audio never touches disk."""
import json
import os
import sys
import numpy as np
import sherpa_onnx

samples = np.frombuffer(sys.stdin.buffer.read(384001), dtype='<i2').astype(np.float32) / 32768
if not 128000 <= len(samples) <= 192000:
    raise ValueError('8-12 seconds required')
# Reject silence before computing a voice profile; this does not authenticate a speaker.
if float(np.sqrt(np.mean(samples * samples))) < 0.008:
    raise ValueError('insufficient speech')
config = sherpa_onnx.SpeakerEmbeddingExtractorConfig(
    model=os.environ.get('MVP_VOICE_MODEL', '/app/voice/model.onnx'),
    num_threads=1, debug=False, provider='cpu',
)
extractor = sherpa_onnx.SpeakerEmbeddingExtractor(config)
stream = extractor.create_stream()
stream.accept_waveform(sample_rate=16000, waveform=samples)
stream.input_finished()
if not extractor.is_ready(stream):
    raise ValueError('insufficient speech')
embedding = np.asarray(extractor.compute(stream), dtype=np.float32)
samples.fill(0)
embedding /= max(float(np.linalg.norm(embedding)), 1e-12)
print(json.dumps(embedding.tolist()))
