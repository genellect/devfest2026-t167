/* ブラウザの実サンプルレートから16kHz・16bit・monoへ変換する。200msごとに独立したPCMを送る。 */
class DiscussPCM extends AudioWorkletProcessor {
  constructor() {
    super(); this.phase = 0; this.last = 0; this.samples = []; this.flushed = false;
    this.port.onmessage = (event) => {
      if (!event.data?.flush) return;
      this.flushed = true;
      if (this.samples.length) {
        const pcm = new Int16Array(3200); pcm.set(this.samples); this.samples = [];
        this.port.postMessage(pcm.buffer, [pcm.buffer]);
      }
      this.port.postMessage({ flushed: true });
    };
  }
  process(inputs) {
    if (this.flushed) return true;
    const input = inputs[0]?.[0];
    if (!input) return true;
    const step = sampleRate / 16000;
    while (this.phase < input.length) {
      const left = Math.floor(this.phase), fraction = this.phase - left;
      const a = left < 0 ? this.last : input[left];
      const b = input[Math.min(left + 1, input.length - 1)];
      const value = Math.max(-1, Math.min(1, a + (b-a)*fraction));
      this.samples.push(Math.round(value < 0 ? value*32768 : value*32767));
      this.phase += step;
      if (this.samples.length === 3200) {
        const pcm = new Int16Array(this.samples); this.samples = [];
        this.port.postMessage(pcm.buffer, [pcm.buffer]);
      }
    }
    this.phase -= input.length; this.last = input[input.length - 1];
    return true;
  }
}
registerProcessor('discuss-pcm', DiscussPCM);
