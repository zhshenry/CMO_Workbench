import { encodeSpeechWave } from '../../shared/speech-audio';
import { SPEECH_SAMPLE_RATE } from '../../shared/speech-contracts';

export class MeetingRecorder {
  private streams: MediaStream[] = [];
  private context?: AudioContext;
  private processor?: ScriptProcessorNode;
  private video?: HTMLVideoElement;
  private frameTimer?: ReturnType<typeof setInterval>;
  private buffers: Float32Array[] = [];
  private samples = 0;
  private quiet = 0;
  private elapsed = 0;
  private tail = Promise.resolve();
  private paused = false;
  private ended = false;

  constructor(private readonly id: string, private readonly startedAt: number, private readonly failed: (error: unknown) => void,
    private readonly interrupted: () => void) {}

  async start(display: boolean, systemAudio: boolean, microphone: boolean, deviceId?: string) {
    try {
      const screen = display ? await navigator.mediaDevices.getDisplayMedia({ video: true, audio: systemAudio }) : undefined;
      if (screen) this.accept(screen);
      const mic = microphone ? await navigator.mediaDevices.getUserMedia({ video: false, audio: {
        echoCancellation: true, noiseSuppression: true, ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
      } }) : undefined;
      if (mic) this.accept(mic);
      if (systemAudio && !screen?.getAudioTracks().length) this.failed(new Error('系统没有返回共享声音，可核对当前录制音源。'));
      const audio = this.streams.filter(stream => stream.getAudioTracks().length);
      if (audio.length) this.startAudio(audio);
      if (screen) await this.startFrames(screen);
    } catch (error) { await this.stop(); throw error; }
  }

  private accept(stream: MediaStream) {
    if (this.ended) { stream.getTracks().forEach(track => track.stop()); throw new Error('录制已停止。'); }
    for (const track of stream.getTracks()) track.onended = this.interrupted;
    this.streams.push(stream);
  }

  private startAudio(streams: MediaStream[]) {
    const context = this.context = new AudioContext(), processor = this.processor = context.createScriptProcessor(4096, 1, 1);
    for (const stream of streams) context.createMediaStreamSource(new MediaStream(stream.getAudioTracks())).connect(processor);
    const sink = context.createGain(); sink.gain.value = 0; processor.connect(sink).connect(context.destination);
    this.elapsed = Date.now() - this.startedAt;
    processor.onaudioprocess = event => {
      if (this.paused || this.ended) return;
      const input = event.inputBuffer.getChannelData(0), copy = input.slice();
      this.buffers.push(copy); this.samples += copy.length;
      const energy = copy.reduce((sum, value) => sum + Math.abs(value), 0) / copy.length;
      this.quiet = energy < 0.007 ? this.quiet + copy.length : 0;
      if (this.samples >= 20 * context.sampleRate || this.samples >= 8 * context.sampleRate && this.quiet >= 0.45 * context.sampleRate) this.flush();
    };
    void context.resume().catch(this.failed);
  }

  private flush() {
    if (!this.context || !this.samples) return;
    const at = Math.max(0, Math.round(this.elapsed)), frames = this.samples, samples = this.buffers, rate = this.context.sampleRate;
    this.samples = 0; this.quiet = 0; this.buffers = []; this.elapsed += frames / rate * 1000;
    this.tail = this.tail.then(async () => {
      const offline = new OfflineAudioContext(1, Math.max(1, Math.ceil(frames / rate * SPEECH_SAMPLE_RATE)), SPEECH_SAMPLE_RATE);
      const buffer = offline.createBuffer(1, frames, rate), output = buffer.getChannelData(0);
      let offset = 0; for (const chunk of samples) { output.set(chunk, offset); offset += chunk.length; }
      const source = offline.createBufferSource(); source.buffer = buffer; source.connect(offline.destination); source.start();
      const rendered = await offline.startRendering();
      await window.workbench.meetingCompanion.audio({ id: this.id, chunk: crypto.randomUUID(), at, bytes: new Uint8Array(encodeSpeechWave(rendered.getChannelData(0))) });
    }).catch(this.failed);
  }

  private async startFrames(stream: MediaStream) {
    const video = this.video = document.createElement('video');
    video.srcObject = stream; video.muted = true; video.playsInline = true;
    await video.play();
    if (this.ended) return;
    const thumbnail = document.createElement('canvas'); thumbnail.width = 32; thumbnail.height = 18;
    const mini = thumbnail.getContext('2d', { willReadFrequently: true })!, frame = document.createElement('canvas');
    const ctx = frame.getContext('2d')!;
    let previous: Uint8ClampedArray | undefined, saved: Uint8ClampedArray | undefined;
    const difference = (a: Uint8ClampedArray, b: Uint8ClampedArray) => {
      let sum = 0; for (let i = 0; i < a.length; i += 4) sum += Math.abs(a[i] - b[i]);
      return sum * 4 / a.length;
    };
    this.frameTimer = setInterval(() => {
      if (this.paused || this.ended) { previous = undefined; return; }
      if (!video.videoWidth) return;
      mini.drawImage(video, 0, 0, thumbnail.width, thumbnail.height);
      const image = mini.getImageData(0, 0, thumbnail.width, thumbnail.height).data;
      const stable = previous && difference(previous, image) < 3;
      previous = image;
      if (!stable || saved && difference(saved, image) < 7) return;
      saved = image;
      const at = Math.max(0, Date.now() - this.startedAt);
      frame.width = Math.min(1280, video.videoWidth); frame.height = Math.max(1, Math.round(video.videoHeight * frame.width / video.videoWidth));
      ctx.drawImage(video, 0, 0, frame.width, frame.height);
      frame.toBlob(blob => {
        if (!blob || this.ended) return;
        void blob.arrayBuffer().then(bytes => window.workbench.meetingCompanion.frame({ id: this.id, frame: crypto.randomUUID(), at, bytes: new Uint8Array(bytes) })).catch(this.failed);
      }, 'image/jpeg', 0.78);
    }, 3500);
  }

  pause() {
    if (this.paused || this.ended) return;
    this.paused = true;
    for (const stream of this.streams) for (const track of stream.getAudioTracks()) track.enabled = false;
    this.flush();
  }

  resume() {
    if (!this.paused || this.ended) return;
    this.elapsed = Math.max(this.elapsed, Date.now() - this.startedAt);
    for (const stream of this.streams) for (const track of stream.getAudioTracks()) track.enabled = true;
    this.paused = false;
  }

  async stop() {
    if (this.ended) return this.tail;
    this.ended = true; clearInterval(this.frameTimer);
    if (this.processor) { this.processor.onaudioprocess = null; this.processor.disconnect(); }
    this.flush();
    for (const stream of this.streams) for (const track of stream.getTracks()) { track.onended = null; track.stop(); }
    this.streams = [];
    if (this.video) this.video.srcObject = null;
    if (this.context && this.context.state !== 'closed') void this.context.close();
    await this.tail;
  }
}
