"""macOSの組み込み音声からテスト専用の日本語WAVを作る。マイクや個人の音声は使用しない。"""
import pathlib
import subprocess
import sys
import wave

if sys.platform != 'darwin':
    raise SystemExit('macOS以外では16kHz mono PCM16 WAVの合成音声2本を用意してください')
root = pathlib.Path(__file__).resolve().parent.parent / '.local-data' / 'speaker-samples'
root.mkdir(parents=True, exist_ok=True)
text = '今日の話し合いでは、理由を添えて自分の考えを伝えます。違う意見にも耳を傾け、みんなで結論を考えます。' * 3
for name, voice in [('kyoko', 'Kyoko'), ('eddy', 'Eddy (日本語（日本）)')]:
    aiff, wav = root / (name + '.aiff'), root / (name + '.wav')
    subprocess.run(['/usr/bin/say', '-v', voice, '-r', '160', '-o', str(aiff), text], check=True)
    subprocess.run(['/usr/bin/afconvert', '-f', 'WAVE', '-d', 'LEI16@16000', '-c', '1', str(aiff), str(wav)], check=True)
    aiff.unlink()
    with wave.open(str(wav)) as audio:
        if audio.getnframes() / audio.getframerate() < 9:
            raise SystemExit('合成音声の生成に失敗しました。macOSの音声機能を利用できる環境で再実行してください')
    print(wav)
