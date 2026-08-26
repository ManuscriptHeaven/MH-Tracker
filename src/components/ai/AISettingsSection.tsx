import React from 'react';
import { Brain, Mic, Volume2, VolumeX, Languages, Upload, Trash2, Play } from 'lucide-react';
import type { AIUserSettings } from '../../lib/ai/aiTypes';
import { Card, Button } from '../ui';

interface AISettingsSectionProps {
  settings: AIUserSettings;
  onUpdate: (settings: Partial<AIUserSettings>) => void;
}

export function AISettingsSection({ settings, onUpdate }: AISettingsSectionProps) {
  const currentSettings = settings || {
    voiceEnabled: true,
    voiceLanguage: 'en-US',
    ttsEnabled: true,
    autoSpeak: true,
    isMuted: false,
  };

  const handleToggle = (key: keyof AIUserSettings) => {
    onUpdate({ [key]: !currentSettings[key] });
  };

  const handleLanguageChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    onUpdate({ voiceLanguage: e.target.value });
  };

  const testVoice = () => {
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      const msg = new SpeechSynthesisUtterance("Hello! I am your Manuscript Heaven voice assistant. How can I help with your projects today?");
      msg.lang = currentSettings.voiceLanguage || 'en-US';
      window.speechSynthesis.speak(msg);
    }
  };

  return (
    <Card className="bg-ivory dark:bg-charcoal border-border dark:border-white/10">
      <div className="p-6">
        <div className="flex items-center gap-3 mb-6">
          <div className="p-2 bg-gold/10 rounded-lg">
            <Brain className="w-6 h-6 text-gold" />
          </div>
          <div>
            <h2 className="text-lg font-display font-semibold text-ink dark:text-white">AI Voice Assistant Settings</h2>
            <p className="text-sm text-muted">Configure speech-to-text, voice responses, and language preferences.</p>
          </div>
        </div>

        <div className="space-y-6">
          {/* Voice Settings */}
          <div>
            <h3 className="text-sm font-semibold text-ink dark:text-white uppercase tracking-wider mb-4 border-b border-border dark:border-white/10 pb-2">Voice & Speech</h3>
            
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Mic className="w-5 h-5 text-muted" />
                  <div>
                    <div className="font-medium text-ink dark:text-white">Voice Input (Microphone)</div>
                    <div className="text-sm text-muted">Allow speaking questions using speech-to-text</div>
                  </div>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input type="checkbox" className="sr-only peer" checked={!!currentSettings.voiceEnabled} onChange={() => handleToggle('voiceEnabled')} />
                  <div className="w-11 h-6 bg-border dark:bg-white/10 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-gold"></div>
                </label>
              </div>

              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Languages className="w-5 h-5 text-muted" />
                  <div>
                    <div className="font-medium text-ink dark:text-white">Assistant Language</div>
                    <div className="text-sm text-muted">Language for speech recognition and synthesized voice</div>
                  </div>
                </div>
                <select 
                  value={currentSettings.voiceLanguage || 'en-US'} 
                  onChange={handleLanguageChange}
                  className="bg-white dark:bg-ink border border-border dark:border-white/10 rounded-md px-3 py-1.5 text-sm text-ink dark:text-white focus:ring-gold focus:border-gold outline-none"
                >
                  <option value="en-US">English (US)</option>
                  <option value="en-GB">English (UK)</option>
                  <option value="ur-PK">Urdu (Pakistan)</option>
                </select>
              </div>

              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Volume2 className="w-5 h-5 text-muted" />
                  <div>
                    <div className="font-medium text-ink dark:text-white">Text-to-Speech (TTS)</div>
                    <div className="text-sm text-muted">Enable spoken answers from assistant</div>
                  </div>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input type="checkbox" className="sr-only peer" checked={!!currentSettings.ttsEnabled} onChange={() => handleToggle('ttsEnabled')} />
                  <div className="w-11 h-6 bg-border dark:bg-white/10 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-gold"></div>
                </label>
              </div>

              {currentSettings.ttsEnabled && (
                <>
                  <div className="flex items-center justify-between pl-8">
                    <div className="text-sm font-medium text-ink dark:text-white">Auto-speak responses after answering</div>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input type="checkbox" className="sr-only peer" checked={!!currentSettings.autoSpeak} onChange={() => handleToggle('autoSpeak')} />
                      <div className="w-9 h-5 bg-border dark:bg-white/10 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-gold"></div>
                    </label>
                  </div>

                  <div className="flex items-center justify-between pl-8">
                    <div className="text-sm font-medium text-ink dark:text-white">Mute all voice audio</div>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input type="checkbox" className="sr-only peer" checked={!!currentSettings.isMuted} onChange={() => handleToggle('isMuted')} />
                      <div className="w-9 h-5 bg-border dark:bg-white/10 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-danger"></div>
                    </label>
                  </div>
                </>
              )}
              
              <div className="pt-2">
                <Button variant="secondary" onClick={testVoice} className="text-sm w-full sm:w-auto">
                  <Play className="w-4 h-4" />
                  Test Voice Response
                </Button>
              </div>
            </div>
          </div>

          {/* Phase 1 Status Banner */}
          <div className="p-4 rounded-xl bg-gold/10 border border-gold/30 text-xs text-ink dark:text-linen">
            <h4 className="font-semibold text-gold mb-1">MH Voice Assistant Phase 1: Read-Only Business Assistant</h4>
            <p className="text-muted">
              In Phase 1, the AI Assistant queries live authorized project data, team workload, deadlines, and finances. All operations are strictly read-only. Database modification actions are disabled.
            </p>
          </div>
        </div>
      </div>
    </Card>
  );
}
