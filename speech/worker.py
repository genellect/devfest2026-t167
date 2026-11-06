"""PCMをメモリ上だけで処理する。音声・特徴・例外本文をログへ出さない。"""
import base64
import json
import os
import sys
import numpy as np
import sherpa_onnx

extractor = sherpa_onnx.SpeakerEmbeddingExtractor(sherpa_onnx.SpeakerEmbeddingExtractorConfig(
    model=os.environ['SPEAKER_EMBEDDING_MODEL'], num_threads=1, debug=False, provider='cpu'))

def analyze(pcm):
    samples = np.frombuffer(pcm, dtype='<i2').astype(np.float32) / 32768.0
    if len(samples) < 8000 or len(samples) > 16000 * 12:
        raise ValueError('invalid_length')
    config = sherpa_onnx.VadModelConfig()
    config.silero_vad.model = os.environ['SPEAKER_VAD_MODEL']
    config.silero_vad.min_silence_duration = 0.15
    config.silero_vad.min_speech_duration = 0.15
    config.silero_vad.threshold = 0.5
    config.sample_rate = 16000
    config.num_threads = 1
    vad = sherpa_onnx.VoiceActivityDetector(config, buffer_size_in_seconds=15)
    padded = np.concatenate([samples, np.zeros(8000, dtype=np.float32)])
    for start in range(0, len(padded), 512):
        frame = padded[start:start + 512]
        if len(frame) < 512:
            frame = np.pad(frame, (0, 512 - len(frame)))
        vad.accept_waveform(frame)
    vad.flush()
    segments = []
    voiced = []
    while not vad.empty():
        current = vad.front
        begin = min(int(current.start), len(samples))
        end = min(begin + len(current.samples), len(samples))
        vad.pop()
        if end <= begin:
            continue
        chunk = samples[begin:end]
        voiced.append(chunk)
        segments.append({'startMs': round(begin / 16), 'endMs': round(end / 16)})
    speech_ms = sum(s['endMs'] - s['startMs'] for s in segments)
    embedding = None
    if voiced and speech_ms >= 400:
        stream = extractor.create_stream()
        stream.accept_waveform(16000, np.concatenate(voiced))
        stream.input_finished()
        if extractor.is_ready(stream):
            vector = np.asarray(extractor.compute(stream), dtype=np.float32)
            norm = float(np.linalg.norm(vector))
            if norm > 0:
                embedding = (vector / norm).tolist()
    return {'segments': segments, 'speechMs': speech_ms, 'embedding': embedding}

print(json.dumps({'ready': True}), flush=True)
for line in sys.stdin:
    request = {}
    try:
        if len(line) > 600000:
            raise ValueError('oversized')
        request = json.loads(line)
        result = analyze(base64.b64decode(request['pcm'], validate=True))
        print(json.dumps({'id': request['id'], 'ok': True, **result}), flush=True)
    except Exception:
        print(json.dumps({'id': request.get('id'), 'ok': False, 'error': 'speaker_analysis_failed'}), flush=True)
    finally:
        # 次の入力を待つ間にも、直前の音声や特徴への参照を残さない。
        request.clear()
        line = ''
        if 'result' in locals():
            if result.get('embedding'):
                result['embedding'][:] = [0.0] * len(result['embedding'])
            result.clear()
