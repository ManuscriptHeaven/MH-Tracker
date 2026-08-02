type SpeechRecognition = any; // Fallback type
type SpeechSynthesisVoice = any;

export class VoiceService {
  private static instance: VoiceService;
  
  private recognition: SpeechRecognition | null = null;
  private synth: SpeechSynthesis | null = null;
  private voices: SpeechSynthesisVoice[] = [];
  private currentLanguage: string = 'en-US';
  
  public onTranscript?: (text: string, isFinal: boolean) => void;
  public onListeningChange?: (isListening: boolean) => void;
  public onSpeakingChange?: (isSpeaking: boolean) => void;
  public onError?: (error: string) => void;

  private isCurrentlyListening: boolean = false;
  private isCurrentlySpeaking: boolean = false;

  private constructor() {
    this.initSynth();
    this.initRecognition();
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
        this.voices = this.synth?.getVoices() || [];
      };
      
      populateVoices();
      if (speechSynthesis.onvoiceschanged !== undefined) {
        speechSynthesis.onvoiceschanged = populateVoices;
      }
    }
  }

  private initRecognition() {
    if (typeof window !== 'undefined') {
      const SpeechRecognitionImpl = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (SpeechRecognitionImpl) {
        this.recognition = new SpeechRecognitionImpl();
        this.recognition.continuous = true;
        this.recognition.interimResults = true;
        
        this.recognition.onstart = () => {
          this.isCurrentlyListening = true;
          this.onListeningChange?.(true);
        };
        
        this.recognition.onresult = (event: any) => {
          if (this.isCurrentlySpeaking) {
            this.stopSpeaking();
          }

          let interimTranscript = '';
          let finalTranscript = '';

          for (let i = event.resultIndex; i < event.results.length; ++i) {
            if (event.results[i].isFinal) {
              finalTranscript += event.results[i][0].transcript;
            } else {
              interimTranscript += event.results[i][0].transcript;
            }
          }

          if (finalTranscript) {
            this.onTranscript?.(finalTranscript, true);
          } else if (interimTranscript) {
            this.onTranscript?.(interimTranscript, false);
          }
        };
        
        this.recognition.onerror = (event: any) => {
          this.onError?.(`Speech recognition error: ${event.error}`);
        };
        
        this.recognition.onend = () => {
          this.isCurrentlyListening = false;
          this.onListeningChange?.(false);
        };
      }
    }
  }

  public isSupported(): boolean {
    return !!this.recognition && !!this.synth;
  }

  public setLanguage(lang: string) {
    this.currentLanguage = lang;
    if (this.recognition) {
      this.recognition.lang = lang;
    }
  }

  public startListening(language?: string) {
    if (!this.recognition) return;
    
    if (language) {
      this.setLanguage(language);
    }
    
    try {
      this.recognition.start();
    } catch (e) {
      console.warn('Recognition start error', e);
    }
  }

  public stopListening() {
    if (this.recognition && this.isCurrentlyListening) {
      this.recognition.stop();
    }
  }

  public async speak(text: string, language: string = this.currentLanguage): Promise<void> {
    if (!this.synth) return;
    
    this.stopSpeaking();
    
    return new Promise((resolve, reject) => {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = language;
      
      const targetVoices = this.voices.filter(v => v.lang.startsWith(language.split('-')[0]));
      if (targetVoices.length > 0) {
        utterance.voice = targetVoices[0];
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
        reject(e);
      };
      
      this.synth!.speak(utterance);
    });
  }

  public stopSpeaking() {
    if (this.synth && this.isCurrentlySpeaking) {
      this.synth.cancel();
      this.isCurrentlySpeaking = false;
      this.onSpeakingChange?.(false);
    }
  }
}

export const voiceService = VoiceService.getInstance();
