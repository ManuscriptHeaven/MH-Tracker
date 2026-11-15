// Hands-free mode: opt-in wake phrase ("Hey Nova") listener built on the Web Speech API.

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

export const DEFAULT_WAKE_NAME = 'Nova';

function editDistance(a: string, b: string): number {
  const dp = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const tmp = dp[j];
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[b.length];
}

/**
 * Detect "Hey Nova ..." in a transcript and return what was said after it.
 * Accepts hey/hi/ok/okay/hello + name (one-letter mishearings allowed for
 * names of 4+ letters), or the bare name at the very start of the phrase.
 * Returns null when the wake phrase is not present.
 */
export function parseWakePhrase(transcript: string, name: string = DEFAULT_WAKE_NAME): { command: string } | null {
  const wake = name.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
  if (!wake) return null;
  const words = transcript.toLowerCase().replace(/[^a-z0-9؀-ۿ\s']/g, ' ').split(/\s+/).filter(Boolean);
  const raw = transcript.trim().split(/\s+/);
  const wakeWords = wake.split(/\s+/);
  const n = wakeWords.length;
  const tolerance = wake.replace(/\s/g, '').length >= 4 ? 1 : 0;
  const isName = (i: number) => {
    if (i + n > words.length) return false;
    const heard = words.slice(i, i + n).join(' ');
    return heard === wake || editDistance(heard, wake) <= tolerance;
  };
  for (let i = 0; i < words.length; i += 1) {
    const greeting = /^(?:hey|hi|ok|okay|hello|ae|oye|yo)$/.test(words[i]);
    if (greeting && isName(i + 1)) {
      return { command: raw.slice(i + 1 + n).join(' ').replace(/^[,.\s]+/, '').trim() };
    }
    if (i === 0 && isName(0)) {
      return { command: raw.slice(n).join(' ').replace(/^[,.\s]+/, '').trim() };
    }
  }
  return null;
}

/**
 * Hands-free mode: an opt-in, always-on listener that only reacts to the
 * wake phrase. It is OFF unless the user switches it on, pauses while the
 * assistant is taking a command or speaking, and stops completely when
 * switched off. Write actions still require an explicit confirmation.
 */
export class WakeWordService {
  private static instance: WakeWordService;
  private recognition: any = null;
  private enabled = false;
  private paused = false;
  private name = DEFAULT_WAKE_NAME;
  private language = 'en-US';
  private restartTimer: any = null;
  private failures = 0;
  private idleTimer: any = null;
  /** Hands-free switches itself off after this long without a wake phrase. */
  public idleTimeoutMs = 5 * 60 * 1000;
  public onWake?: (command: string) => void;
  public onStateChange?: (state: { enabled: boolean; listening: boolean; error?: string; notice?: string }) => void;

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

  public isEnabled(): boolean { return this.enabled; }
  public getIsListening(): boolean { return Boolean(this.recognition); }

  /** Switch hands-free mode on. Safe to call repeatedly. */
  public enable(name: string = DEFAULT_WAKE_NAME, language = 'en-US') {
    this.name = name.trim() || DEFAULT_WAKE_NAME;
    this.language = language;
    if (!this.isSupported()) {
      this.onStateChange?.({ enabled: false, listening: false, error: 'Hands-free mode needs Chrome or Edge speech recognition.' });
      return;
    }
    this.enabled = true;
    this.failures = 0;
    this.resetIdleTimer();
    if (!this.paused) this.startRecognition();
    else this.emit();
  }

  /** Switch hands-free mode off and release the microphone. */
  public disable() {
    this.enabled = false;
    this.paused = false;
    clearTimeout(this.idleTimer);
    this.stopRecognition();
    this.emit();
  }

  /** Any wake or command keeps hands-free alive for another idle period. */
  public noteActivity() {
    if (this.enabled) this.resetIdleTimer();
  }

  private resetIdleTimer() {
    clearTimeout(this.idleTimer);
    if (!this.idleTimeoutMs) return;
    this.idleTimer = setTimeout(() => {
      if (!this.enabled) return;
      if (this.paused) { this.resetIdleTimer(); return; } // never cut off a command in progress
      this.enabled = false;
      this.stopRecognition();
      const minutes = Math.round(this.idleTimeoutMs / 60000);
      this.onStateChange?.({ enabled: false, listening: false, notice: `Hands-free turned off after ${minutes} minutes without a command.` });
    }, this.idleTimeoutMs);
  }

  /** Temporarily release the mic (a command is being taken or answered). */
  public pause() {
    this.paused = true;
    this.stopRecognition();
    this.emit();
  }

  public resume() {
    if (this.paused && this.enabled) this.resetIdleTimer();
    this.paused = false;
    if (this.enabled && !this.recognition) this.startRecognition();
  }

  public setName(name: string) {
    this.name = name.trim() || DEFAULT_WAKE_NAME;
  }

  private emit(error?: string) {
    this.onStateChange?.({ enabled: this.enabled, listening: Boolean(this.recognition), error });
  }

  private startRecognition() {
    clearTimeout(this.restartTimer);
    if (!this.enabled || this.paused || this.recognition) return;
    const Impl = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    let rec: any;
    try {
      rec = new Impl();
    } catch {
      this.emit('Could not start hands-free listening.');
      return;
    }
    rec.continuous = true;
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    rec.lang = this.language;
    rec.onresult = (event: any) => {
      if (this.recognition !== rec) return;
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        if (!event.results[i].isFinal) continue;
        const transcript = String(event.results[i][0]?.transcript || '');
        const wake = parseWakePhrase(transcript, this.name);
        if (wake) {
          this.failures = 0;
          this.resetIdleTimer();
          playWakeChime();
          this.pause();
          this.onWake?.(wake.command);
          return;
        }
      }
    };
    rec.onerror = (event: any) => {
      if (this.recognition !== rec) return;
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        this.enabled = false;
        this.stopRecognition();
        this.emit('Microphone permission was denied, so hands-free mode was switched off.');
        return;
      }
      if (event.error !== 'no-speech' && event.error !== 'aborted') this.failures += 1;
    };
    rec.onend = () => {
      if (this.recognition !== rec) return;
      this.recognition = null;
      if (this.enabled && !this.paused) {
        // Browsers end continuous sessions every minute or so; restart,
        // backing off if the speech service keeps failing.
        const delay = Math.min(500 * 2 ** Math.min(this.failures, 5), 15000);
        this.restartTimer = setTimeout(() => this.startRecognition(), delay);
      }
      this.emit();
    };
    this.recognition = rec;
    try {
      rec.start();
      this.emit();
    } catch {
      this.recognition = null;
      this.restartTimer = setTimeout(() => this.startRecognition(), 1000);
    }
  }

  private stopRecognition() {
    clearTimeout(this.restartTimer);
    const rec = this.recognition;
    this.recognition = null;
    if (rec) {
      rec.onresult = null;
      rec.onerror = null;
      rec.onend = null;
      try { rec.abort(); } catch { /* ignore */ }
    }
  }

  /** Back-compat for older callers: fully stop. */
  public stopListening() {
    this.disable();
  }
}

export const wakeWordService = WakeWordService.getInstance();
