
export class AudioStreamer {
  private audioContext: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private processor: ScriptProcessorNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private externalStream: MediaStream | null = null;

  private volumeCallback: ((volume: number) => void) | null = null;

  constructor(private onAudioData: (base64Data: string) => void) {
    const AudioContextClass = (window.AudioContext || (window as any).webkitAudioContext);
    try {
      this.audioContext = new AudioContextClass({ sampleRate: 16000 });
    } catch (e) {
      console.warn("Could not create AudioContext at 16000Hz, using default rate");
      this.audioContext = new AudioContextClass();
    }
  }

  setExternalStream(stream: MediaStream) {
    this.externalStream = stream;
  }

  setVolumeCallback(callback: (volume: number) => void) {
    this.volumeCallback = callback;
  }

  async start() {
    try {
      if (!this.audioContext) {
        const AudioContextClass = (window.AudioContext || (window as any).webkitAudioContext);
        this.audioContext = new AudioContextClass();
      }

      if (this.externalStream) {
        this.stream = this.externalStream;
      } else {
        this.stream = await navigator.mediaDevices.getUserMedia({ 
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true
          } 
        });
      }
      
      this.source = this.audioContext.createMediaStreamSource(this.stream);
      
      // Using ScriptProcessorNode
      this.processor = this.audioContext.createScriptProcessor(2048, 1, 1);
      
      this.processor.onaudioprocess = (e) => {
        if (!this.audioContext || this.audioContext.state !== 'running') return;
        
        let inputData = e.inputBuffer.getChannelData(0);
        
        // Calculate volume for visualizer
        if (this.volumeCallback) {
          let sum = 0;
          for (let i = 0; i < inputData.length; i++) {
            sum += inputData[i] * inputData[i];
          }
          const rms = Math.sqrt(sum / inputData.length);
          if (rms > 0.01) {
            // Only log if there's significant sound
            console.debug("Mic volume (RMS):", rms.toFixed(4));
          }
          this.volumeCallback(rms);
        }

        // Manual resampling if the context is not at 16000Hz
        if (this.audioContext.sampleRate !== 16000) {
          inputData = this.resample(inputData, this.audioContext.sampleRate, 16000);
        }

        const pcmData = this.floatTo16BitPCM(inputData);
        const base64Data = this.arrayBufferToBase64(pcmData);
        this.onAudioData(base64Data);
      };

      this.source.connect(this.processor);
      this.processor.connect(this.audioContext.destination);

      if (this.audioContext.state === 'suspended') {
        await this.audioContext.resume();
      }
      
      console.log("AudioStreamer started successfully. State:", this.audioContext.state, "SampleRate:", this.audioContext.sampleRate);
    } catch (error) {
      console.error("Failed to start audio streamer:", error);
      throw error;
    }
  }

  private resample(input: Float32Array, fromRate: number, toRate: number): Float32Array {
    const ratio = fromRate / toRate;
    const newLength = Math.round(input.length / ratio);
    const result = new Float32Array(newLength);
    for (let i = 0; i < newLength; i++) {
      result[i] = input[Math.round(i * ratio)];
    }
    return result;
  }

  stop() {
    this.processor?.disconnect();
    this.source?.disconnect();
    this.stream?.getTracks().forEach(track => track.stop());
    this.audioContext?.close();
    
    this.processor = null;
    this.source = null;
    this.stream = null;
    this.audioContext = null;
  }

  private floatTo16BitPCM(input: Float32Array): ArrayBuffer {
    const buffer = new ArrayBuffer(input.length * 2);
    const view = new DataView(buffer);
    for (let i = 0; i < input.length; i++) {
      // Add a small gain boost (1.5x) to help Alice hear better
      const s = Math.max(-1, Math.min(1, input[i] * 1.5));
      view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
    }
    return buffer;
  }

  private arrayBufferToBase64(buffer: ArrayBuffer): string {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return window.btoa(binary);
  }
}

export class AudioPlayer {
  private audioContext: AudioContext | null = null;
  private nextStartTime: number = 0;
  private activeSources: AudioBufferSourceNode[] = [];

  constructor() {
    const AudioContextClass = (window.AudioContext || (window as any).webkitAudioContext);
    this.audioContext = new AudioContextClass();
  }

  async resume() {
    if (this.audioContext?.state === 'suspended') {
      await this.audioContext.resume();
    }
  }

  async play(base64Data: string) {
    if (!this.audioContext) {
      console.warn("AudioPlayer: No AudioContext available");
      return;
    }
    
    try {
      if (this.audioContext.state === 'suspended') {
        console.log("AudioPlayer: Resuming suspended context");
        await this.audioContext.resume();
      }
      
      console.log("AudioPlayer: Decoding and scheduling audio chunk");
      const binaryString = window.atob(base64Data);
      const len = binaryString.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      
      // Ensure we have an even number of bytes for Int16Array
      const pcmData = new Int16Array(bytes.buffer, 0, Math.floor(bytes.byteLength / 2));
      const floatData = new Float32Array(pcmData.length);
      for (let i = 0; i < pcmData.length; i++) {
        floatData[i] = pcmData[i] / 32768.0;
      }

      const audioBuffer = this.audioContext.createBuffer(1, floatData.length, 24000);
      audioBuffer.getChannelData(0).set(floatData);

      const source = this.audioContext.createBufferSource();
      source.buffer = audioBuffer;
      
      const gainNode = this.audioContext.createGain();
      gainNode.gain.value = 2.0; // Boost Alice's voice
      
      source.connect(gainNode);
      gainNode.connect(this.audioContext.destination);

      const currentTime = this.audioContext.currentTime;
      if (this.nextStartTime < currentTime) {
        this.nextStartTime = currentTime;
      }

      source.start(this.nextStartTime);
      this.activeSources.push(source);
      source.onended = () => {
        this.activeSources = this.activeSources.filter(s => s !== source);
      };

      this.nextStartTime += audioBuffer.duration;
    } catch (error) {
      console.error("Error playing audio chunk:", error);
    }
  }

  interrupt() {
    this.activeSources.forEach(source => {
      try {
        source.stop();
      } catch (e) {
        // Source might have already stopped
      }
    });
    this.activeSources = [];
    this.nextStartTime = 0;
  }

  stop() {
    this.interrupt();
    this.audioContext?.close();
    this.audioContext = null;
  }
}
