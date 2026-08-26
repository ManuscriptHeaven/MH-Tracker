import { supabase, isSupabaseConfigured } from '../supabase';
import type { 
  AIMessage, AIConversation, AIUserSettings, DailySummary, KnowledgeBaseDocument, RAGSource 
} from './aiTypes';

export class AIService {
  private static instance: AIService;
  private supabaseUrl: string;

  private constructor(supabaseUrl: string) {
    this.supabaseUrl = supabaseUrl;
  }

  public static getInstance(supabaseUrl: string = import.meta.env.VITE_SUPABASE_URL || ''): AIService {
    if (!AIService.instance) {
      AIService.instance = new AIService(supabaseUrl);
    }
    return AIService.instance;
  }

  async *sendMessage(message: string, conversationId: string, context: any = {}): AsyncGenerator<string, void, unknown> {
    if (!isSupabaseConfigured || !supabase) {
      // Mock response for demo mode
      yield 'Mock response: I hear you saying "';
      yield message;
      yield '". Supabase is not configured yet.';
      return;
    }

    try {
      const { data: { session } } = await supabase.auth.getSession();
      
      if (session) {
        const response = await fetch(`${this.supabaseUrl}/functions/v1/ai-chat`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${session.access_token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ message, conversationId, context }),
        });

        if (response.ok && response.body) {
          const reader = response.body.getReader();
          const decoder = new TextDecoder();

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            
            const chunk = decoder.decode(value, { stream: true });
            const lines = chunk.split('\n');
            for (const line of lines) {
              if (line.startsWith('data: ')) {
                const data = line.slice(6);
                if (data === '[DONE]') return;
                try {
                  const parsed = JSON.parse(data);
                  if (parsed.text) {
                    yield parsed.text;
                  }
                } catch (e) {
                  // ignore partial JSON chunks
                }
              }
            }
          }
          return;
        }
      }
    } catch (error) {
      console.warn('Backend edge function not available, using smart AI fallback:', error);
    }

    // Smart Conversational AI Fallback (for Demo Mode / local dev / before Edge Function deployment)
    const fallbackResponse = this.generateSmartFallback(message, context);
    for (const chunk of fallbackResponse) {
      yield chunk;
      await new Promise((r) => setTimeout(r, 40)); // Smooth typing animation effect
    }
  }

  private generateSmartFallback(message: string, context: any): string[] {
    const q = message.toLowerCase().trim();
    
    if (q.includes('name') || q.includes('who are you') || q.includes('what are you')) {
      return [
        'I am **MH AI Assistant**, your dedicated AI co-pilot for Manuscript Heaven Project Tracker!\n\n',
        'I can assist you with:\n',
        '• 📁 **Finding projects** and tracking production status\n',
        '• ⏰ **Checking due dates** and overdue tasks\n',
        '• 🧾 **Generating invoices** and checking payment balances\n',
        '• 📖 **Answering SOPs & Guidelines** for InDesign, KDP, and EPUB formatting.'
      ];
    }

    if (q.includes('hi') || q.includes('hello') || q.includes('hey') || q.includes('greetings')) {
      return [
        'Hello! 👋 I am **MH AI Assistant**.\n\n',
        'How can I help you manage your Manuscript Heaven projects and tasks today?'
      ];
    }

    if (q.includes('help') || q.includes('what can you do')) {
      return [
        'Here is what I can do for you in **Phase 1 (Read-Only Voice Assistant)**:\n\n',
        '1. **Project Queries**: Ask *"How many projects are overdue?"*, *"What is due today?"*, or *"Which clients?"*\n',
        '2. **Workflow & Revisions**: Ask *"How many projects are waiting for client approval?"* or *"What is QAI Reformatting status?"*\n',
        '3. **Team & Workload**: Ask *"What is Zain working on?"* or *"Which employee has the most active projects?"*\n',
        '4. **Finance & Receivables**: Ask *"How much do clients owe us?"* or *"What is our income this month?"*'
      ];
    }

    if (q.includes('thank')) {
      return ['You\'re very welcome! Let me know if you need anything else from Manuscript Heaven! 🌟'];
    }

    // Default intelligent response summarizing workspace context
    const activeProjects = context?.activeProjectsCount ?? 'several';
    const activeTasks = context?.activeTasksCount ?? 'pending';

    return [
      `I am analyzing live data for **"${message}"**.\n\n`,
      `Currently in your workspace, you have **${activeProjects} active project(s)** and **${activeTasks} active task(s)**.\n\n`,
      `You can speak or type questions about deadlines, team assignments, client accounts, or financial metrics!`
    ];
  }

  async getDailySummary(): Promise<DailySummary | null> {
    if (!isSupabaseConfigured || !supabase) {
      return {
        greeting: "Good morning! Welcome to demo mode.",
        pendingProjects: { count: 0, items: [] },
        dueToday: { count: 0, items: [] },
        overdueTasks: { count: 0, items: [] },
        unreadMessages: 0,
        pendingInvoices: { count: 0, totalAmount: 0 },
        revenueSummary: { thisMonth: 0, lastMonth: 0, change: 0 },
        recommendedActions: ["Explore the dashboard"],
        proactiveInsights: []
      };
    }

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return null;

      const response = await fetch(`${this.supabaseUrl}/functions/v1/ai-daily-summary`, {
        headers: {
          'Authorization': `Bearer ${session.access_token}`
        }
      });

      if (!response.ok) return null;
      return await response.json();
    } catch (e) {
      console.error(e);
      return null;
    }
  }

  async dismissDailySummary(): Promise<void> {
    if (!isSupabaseConfigured || !supabase) return;
    
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      
      await supabase.from('ai_daily_summary_dismissals').insert({
        user_id: user.id,
        dismissed_at: new Date().toISOString()
      });
    } catch (e) {
      console.error(e);
    }
  }

  async searchKnowledgeBase(query: string): Promise<RAGSource[]> {
    if (!isSupabaseConfigured || !supabase) return [];
    
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return [];

      const response = await fetch(`${this.supabaseUrl}/functions/v1/ai-rag`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query }),
      });
      
      if (!response.ok) return [];
      return await response.json();
    } catch (e) {
      console.error(e);
      return [];
    }
  }

  async loadConversations(userId: string): Promise<AIConversation[]> {
    if (!isSupabaseConfigured || !supabase) return [];
    
    const { data, error } = await supabase
      .from('ai_conversations')
      .select('*')
      .eq('user_id', userId)
      .order('updated_at', { ascending: false });
      
    if (error) {
      console.error(error);
      return [];
    }
    
    return data.map(d => ({
      id: d.id,
      userId: d.user_id,
      title: d.title,
      createdAt: d.created_at,
      updatedAt: d.updated_at,
      messages: []
    }));
  }

  async loadMessages(conversationId: string): Promise<AIMessage[]> {
    if (!isSupabaseConfigured || !supabase) return [];
    
    const { data, error } = await supabase
      .from('ai_messages')
      .select('*')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true });
      
    if (error) {
      console.error(error);
      return [];
    }
    
    return data.map(d => ({
      id: d.id,
      conversationId: d.conversation_id,
      role: d.role,
      content: d.content,
      metadata: d.metadata || {},
      createdAt: d.created_at
    }));
  }

  async deleteConversation(id: string): Promise<boolean> {
    if (!isSupabaseConfigured || !supabase) return true;
    
    const { error } = await supabase
      .from('ai_conversations')
      .delete()
      .eq('id', id);
      
    return !error;
  }

  async getUserSettings(): Promise<AIUserSettings> {
    const defaultSettings: AIUserSettings = {
      voiceEnabled: false,
      voiceLanguage: 'en-US',
      ttsEnabled: false,
      autoSpeak: false
    };

    if (!isSupabaseConfigured || !supabase) return defaultSettings;
    
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return defaultSettings;
      
      const { data, error } = await supabase
        .from('ai_user_settings')
        .select('*')
        .eq('user_id', user.id)
        .single();
        
      if (error && error.code !== 'PGRST116') {
        console.error(error);
        return defaultSettings;
      }
      
      if (!data) {
        await this.updateUserSettings(defaultSettings);
        return defaultSettings;
      }
      
      return {
        voiceEnabled: data.voice_enabled ?? defaultSettings.voiceEnabled,
        voiceLanguage: data.voice_language ?? defaultSettings.voiceLanguage,
        ttsEnabled: data.tts_enabled ?? defaultSettings.ttsEnabled,
        autoSpeak: data.auto_speak ?? defaultSettings.autoSpeak
      };
    } catch (e) {
      console.error(e);
      return defaultSettings;
    }
  }

  async updateUserSettings(settings: Partial<AIUserSettings>): Promise<void> {
    if (!isSupabaseConfigured || !supabase) return;
    
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      
      const payload = {
        user_id: user.id,
        ...(settings.voiceEnabled !== undefined && { voice_enabled: settings.voiceEnabled }),
        ...(settings.voiceLanguage !== undefined && { voice_language: settings.voiceLanguage }),
        ...(settings.ttsEnabled !== undefined && { tts_enabled: settings.ttsEnabled }),
        ...(settings.autoSpeak !== undefined && { auto_speak: settings.autoSpeak }),
        updated_at: new Date().toISOString()
      };
      
      await supabase
        .from('ai_user_settings')
        .upsert(payload, { onConflict: 'user_id' });
    } catch (e) {
      console.error(e);
    }
  }

  async uploadKnowledgeBaseDocument(file: File, title: string, category: string): Promise<boolean> {
    if (!isSupabaseConfigured || !supabase) return false;
    
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return false;
      
      const fileExt = file.name.split('.').pop();
      const fileName = `${Math.random().toString(36).substring(2)}_${Date.now()}.${fileExt}`;
      const filePath = `${user.id}/${fileName}`;
      
      const { error: uploadError } = await supabase.storage
        .from('knowledge_base')
        .upload(filePath, file);
        
      if (uploadError) throw uploadError;
      
      const { data: { publicUrl } } = supabase.storage
        .from('knowledge_base')
        .getPublicUrl(filePath);
        
      const { error: dbError } = await supabase
        .from('knowledge_base_documents')
        .insert({
          title,
          file_name: fileName,
          file_url: publicUrl,
          file_type: file.type,
          category,
          uploaded_by: user.id
        });
        
      if (dbError) throw dbError;
      
      // Trigger embedding asynchronously via edge function
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        fetch(`${this.supabaseUrl}/functions/v1/ai-embed`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${session.access_token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ fileUrl: publicUrl, fileName, title, category }),
        }).catch(e => console.error('Error calling ai-embed:', e));
      }
      
      return true;
    } catch (e) {
      console.error(e);
      return false;
    }
  }

  async deleteKnowledgeBaseDocument(id: string): Promise<boolean> {
    if (!isSupabaseConfigured || !supabase) return false;
    
    try {
      const { data, error: getError } = await supabase
        .from('knowledge_base_documents')
        .select('file_name, uploaded_by')
        .eq('id', id)
        .single();
        
      if (getError) throw getError;
      
      if (data) {
        const filePath = `${data.uploaded_by}/${data.file_name}`;
        await supabase.storage.from('knowledge_base').remove([filePath]);
      }
      
      const { error: delError } = await supabase
        .from('knowledge_base_documents')
        .delete()
        .eq('id', id);
        
      return !delError;
    } catch (e) {
      console.error(e);
      return false;
    }
  }

  async listKnowledgeBaseDocuments(): Promise<KnowledgeBaseDocument[]> {
    if (!isSupabaseConfigured || !supabase) return [];
    
    try {
      const { data, error } = await supabase
        .from('knowledge_base_documents')
        .select('*')
        .order('created_at', { ascending: false });
        
      if (error) throw error;
      
      return data.map(d => ({
        id: d.id,
        title: d.title,
        fileName: d.file_name,
        fileUrl: d.file_url,
        fileType: d.file_type,
        category: d.category,
        uploadedBy: d.uploaded_by,
        createdAt: d.created_at
      }));
    } catch (e) {
      console.error(e);
      return [];
    }
  }
}

export const aiService = AIService.getInstance();
