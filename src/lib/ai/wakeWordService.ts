// Production Web Speech API Wake-Word Service for "Hey James" hands-free assistant activation

export function playWakeChime() {
  try {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextClass) return;
    const ctx = new AudioContextClass();
    const now = ctx.currentTime;

    // Note 1 (E5 - 659.25Hz)
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(659.25, now);
    gain1.gain.setValueAtTime(0.18, now);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.start(now);
    osc1.stop(now + 0.35);

    // Note 2 (B5 - 987.77Hz)
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(987.77, now + 0.12);
    gain2.gain.setValueAtTime(0.22, now + 0.12);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.65);
    osc2.connect(gain2);
    gain2.connect(ctx.destination);
    osc2.start(now + 0.12);
    osc2.stop(now + 0.65);
  } catch (e) {
    // Ignore audio context autoplay restrictions
  }
}

export class WakeWordService {
  private static instance: WakeWordService;
  private recognition: any = null;
  private isListeningActive: boolean = false;
  private targetWakeWord: string = 'hey james';
  private assistantName: string = 'James';
  public onWakeWordDetected?: (phrase: string) => void;
  public onListeningStateChange?: (active: boolean) => void;

  private constructor() {}

  public static getInstance(): WakeWordService {
    if (!WakeWordService.instance) {
      WakeWordService.instance = new WakeWordService();
    }
    return WakeWordService.instance;
  }

  public isSupported(): boolean {
    if (typeof window === 'undefined') return false;
    return Boolean((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);
  }

  public startListening(wakeWord: string = 'hey james', name: string = 'James') {
    if (!this.isSupported()) return;
    this.targetWakeWord = wakeWord.toLowerCase().trim();
    this.assistantName = name;

    if (this.isListeningActive && this.recognition) {
      return;
    }

    const SpeechRecognitionImpl =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    try {
      this.recognition = new SpeechRecognitionImpl();
      this.recognition.continuous = true;
      this.recognition.interimResults = true;
      this.recognition.lang = 'en-US';

      this.recognition.onstart = () => {
        this.isListeningActive = true;
        this.onListeningStateChange?.(true);
      };

      this.recognition.onresult = (event: any) => {
        for (let i = event.resultIndex; i < event.results.length; ++i) {
          const transcript = (event.results[i][0].transcript || '').toLowerCase().trim();
          
          if (this.matchesWakeWord(transcript)) {
            playWakeChime();
            this.stopListening();
            this.onWakeWordDetected?.(transcript);
            break;
          }
        }
      };

      this.recognition.onerror = (event: any) => {
        if (event.error === 'no-speech' || event.error === 'aborted') {
          // Restart background listening silently
          if (this.isListeningActive) {
            this.restartDebounced();
          }
          return;
        }
        this.isListeningActive = false;
        this.onListeningStateChange?.(false);
      };

      this.recognition.onend = () => {
        if (this.isListeningActive) {
          this.restartDebounced();
        } else {
          this.onListeningStateChange?.(false);
        }
      };

      this.recognition.start();
    } catch (e) {
      console.warn('Could not start wake word recognition:', e);
      this.isListeningActive = false;
      this.onListeningStateChange?.(false);
    }
  }

  private matchesWakeWord(text: string): boolean {
    if (!text) return false;
    const clean = text.toLowerCase();
    
    // Default wake keywords
    const keywords = [
      this.targetWakeWord,
      `hey ${this.assistantName.toLowerCase()}`,
      `hi ${this.assistantName.toLowerCase()}`,
      `ok ${this.assistantName.toLowerCase()}`,
      `wake up ${this.assistantName.toLowerCase()}`,
      this.assistantName.toLowerCase(),
      'hey assistant',
      'hey mh tracker',
      'hey mh',
    ];

    return keywords.some((kw) => clean.includes(kw));
  }

  private restartDebounced() {
    setTimeout(() => {
      if (this.isListeningActive && this.recognition) {
        try {
          this.recognition.start();
        } catch (e) {
          // Already running
        }
      }
    }, 500);
  }

  public stopListening() {
    this.isListeningActive = false;
    if (this.recognition) {
      try {
        this.recognition.stop();
      } catch (e) {
        // Ignore
      }
      this.recognition = null;
    }
    this.onListeningStateChange?.(false);
  }

  public getIsListening(): boolean {
    return this.isListeningActive;
  }
}

export const wakeWordService = WakeWordService.getInstance();
