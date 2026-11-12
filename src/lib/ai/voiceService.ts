// Production-grade Web Speech API Voice Service for STT & TTS

type SpeechRecognitionType = any;
type SpeechSynthesisVoiceType = any;

export class VoiceService {
  private static instance: VoiceService;

  private recognition: SpeechRecognitionType | null = null;
  private synth: SpeechSynthesis | null = null;
  private voices: SpeechSynthesisVoiceType[] = [];
  private currentLanguage: string = 'en-US';

  public onTranscript?: (text: string, isFinal: boolean) => void;
  public onListeningChange?: (isListening: boolean) => void;
  public onSpeakingChange?: (isSpeaking: boolean) => void;
  public onError?: (error: string) => void;

  private isCurrentlyListening: boolean = false;
  private isCurrentlySpeaking: boolean = false;
  private isMuted: boolean = false;
  private silenceTimer: any = null;
  private restartTimeout: any = null;
  private listeningSession = 0;
  private finalTranscript = '';
  private interimTranscript = '';
  public readonly pauseWindowMs = 2500;

  private constructor() {
    this.initSynth();
  }

  public static getInstance(): VoiceService {
    if (!VoiceService.instance) {
      VoiceService.instance = new VoiceService();
    }
    return VoiceService.instance;
  }

  private initSynth() {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      this.synth = window.speechSynthesis;

      const populateVoices = () => {
        try {
          this.voices = this.synth?.getVoices() || [];
        } catch (e) {
          console.warn('Could not populate voices:', e);
        }
      };

      populateVoices();
      if (
        typeof window.speechSynthesis !== 'undefined' &&
        window.speechSynthesis.onvoiceschanged !== undefined
      ) {
        window.speechSynthesis.onvoiceschanged = populateVoices;
      }
    }
  }

  private createRecognitionInstance(): SpeechRecognitionType | null {
    if (typeof window === 'undefined') return null;

    const SpeechRecognitionImpl =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!SpeechRecognitionImpl) return null;

    try {
      const rec = new SpeechRecognitionImpl();
      // Using continuous = false prevents persistent gRPC streaming network drops in Chrome/Brave
      rec.continuous = false;
      rec.interimResults = true;
      rec.maxAlternatives = 1;
      rec.lang = this.currentLanguage;
      const seenFinals = new Set<number>();

      rec.onspeechstart = () => {
        if (this.recognition === rec) this.clearSilenceTimer();
      };
      rec.onspeechend = () => {
        if (this.recognition === rec) this.resetSilenceTimer();
      };

      rec.onstart = () => {
        if (this.recognition !== rec) {
          try {
            rec.abort();
          } catch {}
          return;
        }
        this.isCurrentlyListening = true;
        this.onListeningChange?.(true);
      };

      rec.onresult = (event: any) => {
        if (this.recognition !== rec) return;
        if (this.isCurrentlySpeaking) {
          this.stopSpeaking();
        }

        let interimTranscript = '';
        let finalTranscript = '';

        for (let i = event.resultIndex; i < event.results.length; ++i) {
          if (event.results[i].isFinal) {
            if (!seenFinals.has(i)) {
              finalTranscript += ' ' + event.results[i][0].transcript;
              seenFinals.add(i);
            }
          } else {
            interimTranscript += event.results[i][0].transcript;
          }
        }

        if (finalTranscript.trim())
          this.finalTranscript = [this.finalTranscript, finalTranscript.trim()]
            .filter(Boolean)
            .join(' ');
        this.interimTranscript = interimTranscript.trim();
        const combined = [this.finalTranscript, this.interimTranscript].filter(Boolean).join(' ');
        if (combined) this.onTranscript?.(combined, false);
        this.resetSilenceTimer();
      };

      rec.onerror = (event: any) => {
        if (this.recognition !== rec) return;
        console.warn('Speech recognition error event:', event.error);
        if (event.error === 'no-speech') {
          if (this.finalTranscript || this.interimTranscript) {
            this.resetSilenceTimer();
            return;
          }
          this.stopListening();
          this.onError?.('No speech was detected. Try again, or type into the field.');
          return;
        }

        this.stopListening();

        if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
          this.onError?.(
            'Microphone permission was denied. Please allow microphone access in your browser.',
          );
        } else if (event.error === 'network') {
          this.onError?.(
            'Browser speech service unreachable. (If using Brave, enable "Google services for voice recognition" in Settings > Privacy, or use Chrome/Edge).',
          );
        } else {
          this.onError?.(`Voice recognition notice: ${event.error}`);
        }
      };

      rec.onend = () => {
        if (this.recognition !== rec) return;
        this.recognition = null;
        if (!this.isCurrentlyListening) return;
        // Browsers often end recognition at a short pause. Reopen within the
        // same click-to-speak session while retaining the sentence and timer.
        const session = this.listeningSession;
        this.restartTimeout = setTimeout(() => {
          this.restartTimeout = null;
          if (session !== this.listeningSession || !this.isCurrentlyListening) return;
          this.recognition = this.createRecognitionInstance();
          try {
            this.recognition?.start();
          } catch {
            this.stopListening();
            this.onError?.('Listening stopped. Please try again, or type your request.');
          }
        }, 100);
      };

      return rec;
    } catch (err) {
      console.warn('Failed to create SpeechRecognition:', err);
      return null;
    }
  }

  private resetSilenceTimer(delay = this.pauseWindowMs) {
    this.clearSilenceTimer();
    const session = this.listeningSession;
    this.silenceTimer = setTimeout(() => {
      if (session !== this.listeningSession) return;
      const text = [this.finalTranscript, this.interimTranscript].filter(Boolean).join(' ').trim();
      this.stopListening();
      if (text) this.onTranscript?.(text, true);
      else this.onError?.('No speech was detected. Try again, or type your request.');
    }, delay);
  }

  private clearSilenceTimer() {
    if (this.silenceTimer) {
      clearTimeout(this.silenceTimer);
      this.silenceTimer = null;
    }
  }

  public isSupported(): boolean {
    return (
      typeof window !== 'undefined' &&
      (Boolean((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition) ||
        'speechSynthesis' in window)
    );
  }

  public isRecognitionSupported(): boolean {
    return (
      typeof window !== 'undefined' &&
      Boolean((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition)
    );
  }

  public isSynthSupported(): boolean {
    return typeof window !== 'undefined' && 'speechSynthesis' in window;
  }

  public setLanguage(lang: string) {
    this.currentLanguage = lang;
  }

  public setMuted(muted: boolean) {
    this.isMuted = muted;
    if (muted && this.isCurrentlySpeaking) {
      this.stopSpeaking();
    }
  }

  public getMuted(): boolean {
    return this.isMuted;
  }

  public async startListening(language?: string) {
    this.stopListening();
    const session = this.listeningSession;
    if (language) {
      this.setLanguage(language);
    }

    if (this.isCurrentlySpeaking) {
      this.stopSpeaking();
    }

    // Attempt to verify/request hardware microphone access first
    if (typeof navigator !== 'undefined' && navigator.mediaDevices?.getUserMedia) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach((track) => track.stop());
        if (session !== this.listeningSession) return;
      } catch (micErr: any) {
        if (session !== this.listeningSession) return;
        if (micErr.name === 'NotAllowedError' || micErr.name === 'PermissionDeniedError') {
          this.onError?.(
            'Microphone access was denied. Please allow microphone permissions in your browser.',
          );
          return;
        }
      }
    }

    // Create a fresh SpeechRecognition instance on every session to avoid stale socket states
    if (session !== this.listeningSession) return;
    this.recognition = this.createRecognitionInstance();

    if (!this.recognition) {
      this.onError?.(
        'Speech recognition is not supported on this browser. You can still type your questions!',
      );
      return;
    }

    try {
      this.recognition.start();
      this.resetSilenceTimer(10000);
    } catch (e: any) {
      console.warn('Recognition start error:', e);
      if (e.name === 'InvalidStateError' || e.message?.includes('already started')) {
        // Try stopping and restarting cleanly
        this.stopListening();
      } else {
        this.onError?.(`Could not start microphone: ${e.message || 'Unknown error'}`);
      }
    }
  }

  public stopListening() {
    this.listeningSession += 1;
    this.clearSilenceTimer();
    if (this.restartTimeout) {
      clearTimeout(this.restartTimeout);
      this.restartTimeout = null;
    }
    this.finalTranscript = '';
    this.interimTranscript = '';
    if (this.recognition) {
      const recognition = this.recognition;
      this.recognition = null;
      try {
        recognition.abort();
      } catch (e) {}
    }
    this.isCurrentlyListening = false;
    this.onListeningChange?.(false);
  }

  public cleanTextForSpeech(text: string): string {
    return (
      text
        // Remove markdown headings, bold, italics, code blocks
        .replace(/^#{1,6}\s+/gm, '')
        .replace(/\*\*(.*?)\*\*/g, '$1')
        .replace(/\*(.*?)\*/g, '$1')
        .replace(/`(.*?)`/g, '$1')
        // Remove bullet symbols
        .replace(/^[•\-\*]\s+/gm, '')
        // Remove emoji symbols
        .replace(
          /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F700}-\u{1F77F}\u{1F780}-\u{1F7FF}\u{1F800}-\u{1F8FF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu,
          '',
        )
        // Clean extra spaces
        .replace(/\s+/g, ' ')
        .trim()
    );
  }

  public async speak(text: string, language: string = this.currentLanguage): Promise<void> {
    if (this.isMuted || !this.synth) return;

    this.stopSpeaking();

    const spokenText = this.cleanTextForSpeech(text);
    if (!spokenText) return;

    return new Promise((resolve) => {
      try {
        const utterance = new SpeechSynthesisUtterance(spokenText);
        utterance.lang = language;
        utterance.rate = 1.05; // Slightly brisk, clear pace
        utterance.pitch = 1.0;

        // Select the most natural voice
        if (this.voices.length === 0 && this.synth) {
          this.voices = this.synth.getVoices() || [];
        }

        const langPrefix = language.split('-')[0];
        const matchingVoices = this.voices.filter((v) => v.lang.startsWith(langPrefix));

        // Prioritize natural sounding voices
        const naturalVoice =
          matchingVoices.find(
            (v) =>
              v.name.includes('Google') ||
              v.name.includes('Natural') ||
              v.name.includes('Samantha') ||
              v.name.includes('Daniel') ||
              v.name.includes('Alex'),
          ) || matchingVoices[0];

        if (naturalVoice) {
          utterance.voice = naturalVoice;
        }

        utterance.onstart = () => {
          this.isCurrentlySpeaking = true;
          this.onSpeakingChange?.(true);
        };

        utterance.onend = () => {
          this.isCurrentlySpeaking = false;
          this.onSpeakingChange?.(false);
          resolve();
        };

        utterance.onerror = (e) => {
          this.isCurrentlySpeaking = false;
          this.onSpeakingChange?.(false);
          resolve();
        };

        this.synth?.speak(utterance);
      } catch (err) {
        console.warn('Speech synthesis error:', err);
        this.isCurrentlySpeaking = false;
        this.onSpeakingChange?.(false);
        resolve();
      }
    });
  }

  public stopSpeaking() {
    if (this.synth) {
      try {
        this.synth.cancel();
      } catch (e) {}
      this.isCurrentlySpeaking = false;
      this.onSpeakingChange?.(false);
    }
  }
}

export const voiceService = VoiceService.getInstance();
