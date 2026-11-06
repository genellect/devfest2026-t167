import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export interface VoiceEngine {
  version: string;
  source: 'model' | 'mock';
  extract(pcm: Buffer): Promise<number[]>;
}

/** 模擬音声はエミュレータ起動時にだけ明示的に注入する。本番への代替経路は作らない。 */
export const mockVoice: VoiceEngine = { version: 'test-voice-v1', source: 'mock', extract: async () => [1, 0, 0] };

export function modelVoice(): VoiceEngine {
  return {
    version: 'wespeaker-resnet34-v1', source: 'model',
    async extract(pcm) {
      return new Promise((resolve, reject) => {
        const child = spawn(process.env.MVP_VOICE_PYTHON ?? 'python3', [fileURLToPath(new URL('../voice/extract.py', import.meta.url))], { stdio: ['pipe', 'pipe', 'ignore'] });
        let output = '';
        const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('voice_timeout')); }, 20_000);
        child.on('error', () => { clearTimeout(timer); reject(new Error('voice_unavailable')); });
        child.stdout.on('data', (data: Buffer) => { output += data.toString(); if (output.length > 20_000) child.kill('SIGKILL'); });
        child.on('close', (code) => {
          clearTimeout(timer);
          try {
            const vector: unknown = JSON.parse(output);
            if (code !== 0 || !Array.isArray(vector) || vector.length < 16 || vector.length > 1024 || !vector.every((n) => typeof n === 'number' && Number.isFinite(n))) throw new Error();
            resolve(vector);
          } catch { reject(new Error('voice_unavailable')); }
        });
        child.stdin.on('error', () => {});
        child.stdin.end(pcm);
      });
    },
  };
}
