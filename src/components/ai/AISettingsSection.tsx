import React from 'react';
import { Brain, Mic, Volume2, Languages, Upload, Trash2, Play } from 'lucide-react';
import type { AIUserSettings } from '../../lib/ai/aiTypes';
import { Card, Button } from '../ui';

interface AISettingsSectionProps {
  settings: AIUserSettings;
  onUpdate: (settings: Partial<AIUserSettings>) => void;
}

export function AISettingsSection({ settings, onUpdate }: AISettingsSectionProps) {
  // Fallback default settings if none provided
  const currentSettings = settings || {
    voiceEnabled: false,
    voiceLanguage: 'en-US',
    ttsEnabled: false,
    autoSpeak: false
  };

  const handleToggle = (key: keyof AIUserSettings) => {
    onUpdate({ [key]: !currentSettings[key] });
  };

  const handleLanguageChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    onUpdate({ voiceLanguage: e.target.value });
  };

  const testVoice = () => {
    if ('speechSynthesis' in window) {
      const msg = new SpeechSynthesisUtterance("Hello, I am your MH AI Assistant.");
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
            <h2 className="text-lg font-display font-semibold text-ink dark:text-white">AI Assistant Settings</h2>
            <p className="text-sm text-muted">Configure your AI experience, voice interactions, and knowledge base.</p>
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
                    <div className="font-medium text-ink dark:text-white">Voice Commands</div>
                    <div className="text-sm text-muted">Allow speaking to the AI assistant</div>
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
                    <div className="font-medium text-ink dark:text-white">Voice Language</div>
                    <div className="text-sm text-muted">Primary language for voice recognition</div>
                  </div>
                </div>
                <select 
                  value={currentSettings.voiceLanguage || 'en-US'} 
                  onChange={handleLanguageChange}
                  className="bg-white dark:bg-ink border border-border dark:border-white/10 rounded-md px-3 py-1.5 text-sm text-ink dark:text-white focus:ring-gold focus:border-gold outline-none"
                >
                  <option value="en-US">English (US)</option>
                  <option value="ur-PK">Urdu (Pakistan)</option>
                </select>
              </div>

              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Volume2 className="w-5 h-5 text-muted" />
                  <div>
                    <div className="font-medium text-ink dark:text-white">Text-to-Speech</div>
                    <div className="text-sm text-muted">Enable voice responses from AI</div>
                  </div>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input type="checkbox" className="sr-only peer" checked={!!currentSettings.ttsEnabled} onChange={() => handleToggle('ttsEnabled')} />
                  <div className="w-11 h-6 bg-border dark:bg-white/10 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-gold"></div>
                </label>
              </div>

              {currentSettings.ttsEnabled && (
                <div className="flex items-center justify-between pl-8">
                  <div className="text-sm font-medium text-ink dark:text-white">Auto-speak responses</div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input type="checkbox" className="sr-only peer" checked={!!currentSettings.autoSpeak} onChange={() => handleToggle('autoSpeak')} />
                    <div className="w-9 h-5 bg-border dark:bg-white/10 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-gold"></div>
                  </label>
                </div>
              )}
              
              <Button variant="secondary" onClick={testVoice} className="mt-2 text-sm w-full sm:w-auto">
                <Play className="w-4 h-4" />
                Test Voice
              </Button>
            </div>
          </div>

          {/* Knowledge Base */}
          <div className="pt-2">
            <h3 className="text-sm font-semibold text-ink dark:text-white uppercase tracking-wider mb-4 border-b border-border dark:border-white/10 pb-2">Knowledge Base</h3>
            
            <div className="flex items-center justify-between mb-4">
              <p className="text-sm text-muted">Upload documents to help the AI understand your projects better.</p>
              <Button className="bg-ink text-white hover:bg-ink/90 dark:bg-white dark:text-ink dark:hover:bg-white/90 border-transparent">
                <Upload className="w-4 h-4" />
                Upload Doc
              </Button>
            </div>
            
            <div className="bg-white dark:bg-ink rounded-lg border border-border dark:border-white/10 divide-y divide-border dark:divide-white/10">
              <div className="flex items-center justify-between p-3">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded bg-gold/10 flex items-center justify-center text-gold font-mono text-xs">PDF</div>
                  <div>
                    <div className="text-sm font-medium text-ink dark:text-white">Project_Guidelines_2023.pdf</div>
                    <div className="text-xs text-muted">2.4 MB • Uploaded 2 days ago</div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <select className="text-xs bg-transparent border-none focus:ring-0 text-muted outline-none">
                    <option>General</option>
                    <option>Guidelines</option>
                    <option>Templates</option>
                  </select>
                  <button
                    title="Delete document"
                    aria-label="Delete document"
                    className="inline-flex h-8 w-8 items-center justify-center rounded text-danger hover:bg-danger/10"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
              
              <div className="flex items-center justify-between p-3">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded bg-info/10 flex items-center justify-center text-info font-mono text-xs">DOC</div>
                  <div>
                    <div className="text-sm font-medium text-ink dark:text-white">Client_Onboarding.docx</div>
                    <div className="text-xs text-muted">1.1 MB • Uploaded last week</div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <select className="text-xs bg-transparent border-none focus:ring-0 text-muted outline-none">
                    <option>Templates</option>
                    <option>General</option>
                    <option>Guidelines</option>
                  </select>
                  <button
                    title="Delete document"
                    aria-label="Delete document"
                    className="inline-flex h-8 w-8 items-center justify-center rounded text-danger hover:bg-danger/10"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          </div>
          
        </div>
      </div>
    </Card>
  );
}
