-- MH AI Assistant Schema
-- Creates all necessary tables, types, and policies for the AI Assistant feature.

-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Shared function for setting updated_at
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 1. ai_conversations
CREATE TABLE IF NOT EXISTS ai_conversations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    title TEXT DEFAULT 'New Conversation',
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE ai_conversations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own conversations"
ON ai_conversations
FOR ALL
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_ai_conversations_user_id ON ai_conversations(user_id);

CREATE TRIGGER set_ai_conversations_updated_at
BEFORE UPDATE ON ai_conversations
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

-- 2. ai_messages
CREATE TABLE IF NOT EXISTS ai_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE,
    role TEXT CHECK (role IN ('user', 'assistant', 'system')),
    content TEXT NOT NULL,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE ai_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage messages in their own conversations"
ON ai_messages
FOR ALL
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM ai_conversations
        WHERE ai_conversations.id = ai_messages.conversation_id
        AND ai_conversations.user_id = auth.uid()
    )
)
WITH CHECK (
    EXISTS (
        SELECT 1 FROM ai_conversations
        WHERE ai_conversations.id = ai_messages.conversation_id
        AND ai_conversations.user_id = auth.uid()
    )
);

CREATE INDEX IF NOT EXISTS idx_ai_messages_conversation_id ON ai_messages(conversation_id);

-- 3. knowledge_base_documents
CREATE TABLE IF NOT EXISTS knowledge_base_documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title TEXT NOT NULL,
    file_name TEXT NOT NULL,
    file_url TEXT,
    file_type TEXT,
    category TEXT CHECK (category IN ('sop','template','pricing','indesign','epub','kdp','internal','other')),
    uploaded_by UUID REFERENCES auth.users(id),
    created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE knowledge_base_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "All authenticated users can read knowledge_base_documents"
ON knowledge_base_documents
FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "Admin can insert/update/delete knowledge_base_documents"
ON knowledge_base_documents
FOR ALL
TO authenticated
USING (auth.jwt() ->> 'role' = 'admin')
WITH CHECK (auth.jwt() ->> 'role' = 'admin');

-- 4. knowledge_base_chunks
CREATE TABLE IF NOT EXISTS knowledge_base_chunks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id UUID NOT NULL REFERENCES knowledge_base_documents(id) ON DELETE CASCADE,
    chunk_index INTEGER NOT NULL,
    content TEXT NOT NULL,
    embedding VECTOR(768),
    created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE knowledge_base_chunks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "All authenticated users can read knowledge_base_chunks"
ON knowledge_base_chunks
FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "Admin or service role can insert chunks"
ON knowledge_base_chunks
FOR INSERT
TO authenticated, service_role
WITH CHECK (auth.jwt() ->> 'role' = 'admin' OR current_user = 'service_role');

CREATE INDEX IF NOT EXISTS idx_knowledge_base_chunks_document_id ON knowledge_base_chunks(document_id);

-- Add IVFFlat index on embedding column for vector similarity search
CREATE INDEX IF NOT EXISTS idx_knowledge_base_chunks_embedding ON knowledge_base_chunks USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- 5. ai_response_cache
CREATE TABLE IF NOT EXISTS ai_response_cache (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    query_hash TEXT UNIQUE NOT NULL,
    response TEXT NOT NULL,
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE ai_response_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role can manage ai_response_cache"
ON ai_response_cache
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- 6. ai_error_logs
CREATE TABLE IF NOT EXISTS ai_error_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID,
    error_type TEXT,
    error_message TEXT,
    provider TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE ai_error_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role can insert ai_error_logs"
ON ai_error_logs
FOR INSERT
TO service_role
WITH CHECK (true);

CREATE POLICY "Admin can read ai_error_logs"
ON ai_error_logs
FOR SELECT
TO authenticated
USING (auth.jwt() ->> 'role' = 'admin');

-- 7. ai_daily_summary_dismissals
CREATE TABLE IF NOT EXISTS ai_daily_summary_dismissals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    dismissed_date DATE NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(user_id, dismissed_date)
);

ALTER TABLE ai_daily_summary_dismissals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own dismissals"
ON ai_daily_summary_dismissals
FOR ALL
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_ai_daily_summary_dismissals_lookup ON ai_daily_summary_dismissals(user_id, dismissed_date);

-- 8. ai_user_settings
CREATE TABLE IF NOT EXISTS ai_user_settings (
    user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    voice_enabled BOOLEAN DEFAULT false,
    voice_language TEXT DEFAULT 'en-US',
    tts_enabled BOOLEAN DEFAULT true,
    auto_speak BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE ai_user_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own settings"
ON ai_user_settings
FOR ALL
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER set_ai_user_settings_updated_at
BEFORE UPDATE ON ai_user_settings
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();
