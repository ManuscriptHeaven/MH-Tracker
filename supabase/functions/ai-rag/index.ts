import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') || ''
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY') || ''
    const geminiKey = Deno.env.get('GEMINI_API_KEY')
    const authHeader = req.headers.get('Authorization') || ''

    if (!authHeader || !supabaseUrl || !anonKey) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }
    // RLS is the final authorization boundary; never query RAG with service_role.
    const supabase = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false, autoRefreshToken: false }
    })
    const { data: { user }, error: authError } = await supabase.auth.getUser(authHeader.replace('Bearer ', ''))
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }
    // Knowledge has no tenant scope yet. Until then, only active admins may search.
    const { data: profile, error: profileError } = await supabase
      .from('profiles').select('role,status').eq('id', user.id).maybeSingle()
    if (profileError || profile?.role !== 'admin' || profile?.status !== 'active') {
      return new Response(JSON.stringify({ error: 'Forbidden' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const body = await req.json()
    const query = typeof body?.query === 'string' ? body.query.trim() : ''
    const requestedK = Number(body?.topK ?? 5)
    const topK = Number.isFinite(requestedK) ? Math.max(1, Math.min(20, Math.floor(requestedK))) : 5
    if (!query || query.length > 2000) {
      return new Response(JSON.stringify({ error: 'Query must be 1-2000 characters' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }
    if (!geminiKey) throw new Error('Knowledge search is not configured')

    // Generate embedding using Gemini
    const embedRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent?key=${geminiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'models/text-embedding-004',
        content: { parts: [{ text: query }] }
      })
    })

    if (!embedRes.ok) throw new Error('Failed to generate embedding')
    const embedData = await embedRes.json()
    const embedding = embedData.embedding?.values

    if (!embedding) throw new Error('No embedding returned')

    // Query pgvector using RPC
    const { data: chunks, error: rpcError } = await supabase.rpc('match_knowledge_base_chunks', {
      query_embedding: embedding,
      match_count: Math.min(topK, 20)
    })

    if (rpcError) throw rpcError

    return new Response(JSON.stringify({ chunks }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })

  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})
