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
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const geminiKey = Deno.env.get('GEMINI_API_KEY')

    if (!geminiKey) throw new Error('GEMINI_API_KEY missing')

    const supabase = createClient(supabaseUrl, supabaseServiceKey)
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) throw new Error('Missing Authorization header')
    
    const token = authHeader.replace('Bearer ', '')
    const { data: { user }, error: authError } = await supabase.auth.getUser(token)
    
    if (authError || !user) throw new Error('Unauthorized')

    // Check user role (admin only)
    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single()

    if (profile?.role !== 'admin') {
      throw new Error('Forbidden: Admin access required')
    }

    const { documentId, content, title } = await req.json()
    if (!documentId || !content) throw new Error('documentId and content are required')

    // Basic chunking: split on sentences, aim for ~500 chars per chunk with ~50 overlap
    // (In a real scenario, a robust token-based chunker is preferred)
    const sentences = content.split(/(?<=[.?!])\s+/)
    const chunks: string[] = []
    let currentChunk = ''

    for (const sentence of sentences) {
      if ((currentChunk.length + sentence.length) > 2000) { // roughly 500 tokens
        chunks.push(currentChunk)
        // Keep last sentence for overlap
        currentChunk = currentChunk.split(/(?<=[.?!])\s+/).slice(-2).join(' ') + ' ' + sentence
      } else {
        currentChunk += (currentChunk ? ' ' : '') + sentence
      }
    }
    if (currentChunk) chunks.push(currentChunk)

    let chunksCreated = 0

    // Process chunks in sequence to avoid rate limits
    for (let i = 0; i < chunks.length; i++) {
      const chunkText = chunks[i]
      
      const embedRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent?key=${geminiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'models/text-embedding-004',
          content: { parts: [{ text: chunkText }] }
        })
      })

      if (!embedRes.ok) {
        console.error(`Failed to embed chunk ${i}`)
        continue
      }

      const embedData = await embedRes.json()
      const embedding = embedData.embedding?.values

      if (embedding) {
        await supabase.from('knowledge_base_chunks').insert({
          document_id: documentId,
          content: chunkText,
          chunk_index: i,
          embedding: embedding
        })
        chunksCreated++
      }
    }

    return new Response(JSON.stringify({ chunksCreated }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })

  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})
