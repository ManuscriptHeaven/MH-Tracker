/* =========================================================================
   MH TRACKER — AUDIO & VOICE NOTIFICATION SERVICE
   Synthesizes pleasant Web Audio chimes and SpeechSynthesis announcements
   ========================================================================= */

const SOUND_STORAGE_KEY = 'mh_sound_enabled';
const VOICE_STORAGE_KEY = 'mh_voice_enabled';

// Audio Context singleton (lazy initialized on user interaction)
let audioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  try {
    const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!audioCtx && AudioContextClass) {
      audioCtx = new AudioContextClass();
    }
    if (audioCtx && audioCtx.state === 'suspended') {
      void audioCtx.resume();
    }
    return audioCtx;
  } catch {
    return null;
  }
}

export function isSoundEnabled(): boolean {
  if (typeof window === 'undefined') return true;
  const saved = localStorage.getItem(SOUND_STORAGE_KEY);
  return saved === null ? true : saved === 'true';
}

export function setSoundEnabled(enabled: boolean): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(SOUND_STORAGE_KEY, String(enabled));
  window.dispatchEvent(new CustomEvent('mh_sound_settings_changed', { detail: { soundEnabled: enabled } }));
}

export function isVoiceEnabled(): boolean {
  if (typeof window === 'undefined') return true;
  const saved = localStorage.getItem(VOICE_STORAGE_KEY);
  return saved === null ? true : saved === 'true';
}

export function setVoiceEnabled(enabled: boolean): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(VOICE_STORAGE_KEY, String(enabled));
  window.dispatchEvent(new CustomEvent('mh_sound_settings_changed', { detail: { voiceEnabled: enabled } }));
}

/**
 * Play a warm 2-tone chime for general system notifications (D5 -> A5)
 */
export function playNotificationSound(): void {
  if (!isSoundEnabled()) return;
  const ctx = getAudioContext();
  if (!ctx) return;

  try {
    const now = ctx.currentTime;

    // Note 1: D5 (587.33 Hz)
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(587.33, now);
    gain1.gain.setValueAtTime(0.001, now);
    gain1.gain.exponentialRampToValueAtTime(0.18, now + 0.03);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.start(now);
    osc1.stop(now + 0.35);

    // Note 2: A5 (880.00 Hz)
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(880.00, now + 0.12);
    gain2.gain.setValueAtTime(0.001, now + 0.12);
    gain2.gain.exponentialRampToValueAtTime(0.22, now + 0.15);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.65);
    osc2.connect(gain2);
    gain2.connect(ctx.destination);
    osc2.start(now + 0.12);
    osc2.stop(now + 0.65);
  } catch (err) {
    console.warn('Could not play notification sound:', err);
  }
}

/**
 * Play a crisp communication chime for chat messages (E5 -> B5)
 */
export function playMessageSound(): void {
  if (!isSoundEnabled()) return;
  const ctx = getAudioContext();
  if (!ctx) return;

  try {
    const now = ctx.currentTime;

    // First harmonic pop: E5 (659.25 Hz)
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = 'triangle';
    osc1.frequency.setValueAtTime(659.25, now);
    gain1.gain.setValueAtTime(0.001, now);
    gain1.gain.exponentialRampToValueAtTime(0.2, now + 0.02);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.start(now);
    osc1.stop(now + 0.25);

    // Second chime: B5 (987.77 Hz)
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(987.77, now + 0.08);
    gain2.gain.setValueAtTime(0.001, now + 0.08);
    gain2.gain.exponentialRampToValueAtTime(0.25, now + 0.11);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
    osc2.connect(gain2);
    gain2.connect(ctx.destination);
    osc2.start(now + 0.08);
    osc2.stop(now + 0.5);
  } catch (err) {
    console.warn('Could not play message sound:', err);
  }
}

/**
 * Speaks text using SpeechSynthesis
 */
export function speakVoice(text: string): Promise<void> {
  if (typeof window === 'undefined' || !('speechSynthesis' in window) || !isVoiceEnabled()) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    try {
      window.speechSynthesis.cancel(); // Stop any pending speech

      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 1.05;
      utterance.pitch = 1.0;
      utterance.lang = 'en-US';

      // Pick a natural English voice if available
      const voices = window.speechSynthesis.getVoices();
      const preferred = voices.find(
        (v) => (v.lang.startsWith('en') && (v.name.includes('Natural') || v.name.includes('Google') || v.name.includes('Samantha') || v.name.includes('Alex'))),
      ) || voices.find((v) => v.lang.startsWith('en'));

      if (preferred) {
        utterance.voice = preferred;
      }

      utterance.onend = () => resolve();
      utterance.onerror = () => resolve();

      window.speechSynthesis.speak(utterance);
    } catch {
      resolve();
    }
  });
}

/**
 * Combined alert: plays audio chime, then speaks voice message
 */
export function notifyWithSoundAndVoice(
  type: 'notification' | 'message',
  title?: string | null,
  body?: string | null,
): void {
  if (type === 'message') {
    playMessageSound();
    if (isVoiceEnabled() && (title || body)) {
      const voiceText = title ? `New message from ${title}` : 'New chat message received';
      setTimeout(() => {
        void speakVoice(voiceText);
      }, 350);
    }
  } else {
    playNotificationSound();
    if (isVoiceEnabled() && (title || body)) {
      const voiceText = title ? `Notification: ${title}` : body || 'New notification';
      setTimeout(() => {
        void speakVoice(voiceText);
      }, 400);
    }
  }
}
