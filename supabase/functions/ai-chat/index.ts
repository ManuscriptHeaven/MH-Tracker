import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// In-memory rate limiting map: userId -> { count, resetTime }
const rateLimitMap = new Map<string, { count: number; resetTime: number }>()

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const geminiKey = Deno.env.get('GEMINI_API_KEY')
    const groqKey = Deno.env.get('GROQ_API_KEY')

    // Use the caller's JWT, never service_role, for all conversation reads.
    const authHeader = req.headers.get('Authorization')
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
    if (!authHeader || !anonKey || !supabaseUrl) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }
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

    // Rate Limiting (30 requests per minute)
    const now = Date.now()
    let rateLimit = rateLimitMap.get(user.id)
    if (!rateLimit || rateLimit.resetTime < now) {
      rateLimit = { count: 1, resetTime: now + 60000 }
    } else {
      rateLimit.count++
    }
    rateLimitMap.set(user.id, rateLimit)

    if (rateLimit.count > 30) {
      return new Response(JSON.stringify({ error: 'Rate limit exceeded. Try again later.' }), {
        status: 429,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const body = await req.json()
    const message = typeof body?.message === 'string' ? body.message.trim() : ''
    const conversationId = typeof body?.conversationId === 'string' ? body.conversationId : null
    const context = body?.context && typeof body.context === 'object' ? body.context : {}
    if (!message || message.length > 4000) {
      return new Response(JSON.stringify({ error: 'Message must be 1-4000 characters' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    let currentConversationId = conversationId
    if (conversationId) {
      // Do not trust caller-supplied conversation IDs; confirm ownership first.
      const { data: owned, error: accessError } = await supabase
        .from('ai_conversations').select('id')
        .eq('id', conversationId).eq('user_id', user.id).maybeSingle()
      if (accessError || !owned) {
        return new Response(JSON.stringify({ error: 'Conversation not found' }), {
          status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }
    } else {
      const { data: conv, error: convError } = await supabase
        .from('ai_conversations')
        .insert({ user_id: user.id, title: message.slice(0, 50) }).select('id').single()
      if (convError || !conv) throw convError || new Error('Conversation creation failed')
      currentConversationId = conv.id
    }

    // Legacy cache is disabled: global response keys were not user/tenant scoped.
    const contextStr = JSON.stringify(context).slice(0, 2000)
    const encoder = new TextEncoder()

    const stream = new TransformStream()
    const writer = stream.writable.getWriter()
    
    const sendSSE = async (text: string) => {
      await writer.write(encoder.encode(`data: ${JSON.stringify({ text })}\n\n`))
    }
    
    const sendDone = async () => {
      await writer.write(encoder.encode(`data: [DONE]\n\n`))
      await writer.close()
    }

    const systemPrompt = `You are the 'MH AI Voice Assistant' for the Manuscript Heaven Project Tracker.
Phase 1: Strictly Read-Only Business Assistant.
You specialize in book formatting, publishing, project tracking, team workload, and live financial metrics.
Keep responses direct, natural, concise, and conversational for voice playback.
Never fabricate data or perform write actions.
Unverified browser context (not an authorization source): ${contextStr}`

    // Fetch conversation history
    const { data: history } = await supabase
      .from('ai_messages')
      .select('role, content')
      .eq('conversation_id', currentConversationId)
      .order('created_at', { ascending: true })
      .limit(10)

    const geminiMessages = history?.map(h => ({
      role: h.role === 'user' ? 'user' : 'model',
      parts: [{ text: h.content }]
    })) || []

    geminiMessages.push({ role: 'user', parts: [{ text: message }] })
    
    const geminiPayload = {
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents: geminiMessages
    }

    // Save user message
    const { error: userMessageError } = await supabase.from('ai_messages').insert({
      conversation_id: currentConversationId,
      role: 'user',
      content: message
    })
    if (userMessageError) throw userMessageError

    let fullResponse = ''

    // Background streaming process
    const processStream = async () => {
      try {
        if (!geminiKey) throw new Error('GEMINI_API_KEY missing')
        
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:streamGenerateContent?alt=sse&key=${geminiKey}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(geminiPayload)
        })

        if (!response.ok) {
          throw new Error(`Gemini API error: ${response.statusText}`)
        }

        const reader = response.body?.getReader()
        if (!reader) throw new Error('No reader from Gemini')

        const decoder = new TextDecoder()
        let buffer = ''
        
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          
          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n')
          buffer = lines.pop() || ''
          
          for (const line of lines) {
            if (line.startsWith('data: ') && line !== 'data: [DONE]') {
              try {
                const parsed = JSON.parse(line.slice(6))
                const text = parsed.candidates?.[0]?.content?.parts?.[0]?.text || ''
                if (text) {
                  fullResponse += text
                  await sendSSE(text)
                }
              } catch (e) {
                // Ignore parse errors on partial chunks
              }
            }
          }
        }
      } catch (geminiError) {
        console.error('Gemini error, falling back to Groq:', geminiError)
        try {
          if (!groqKey) throw new Error('GROQ_API_KEY missing')
          
          const groqMessages = [
            { role: 'system', content: systemPrompt },
            ...(history || []).map(h => ({ role: h.role, content: h.content })),
            { role: 'user', content: message }
          ]

          const groqResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${groqKey}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              model: 'llama-3.1-70b-versatile',
              messages: groqMessages,
              stream: true
            })
          })

          if (!groqResponse.ok) throw new Error('Groq API error')

          const reader = groqResponse.body?.getReader()
          if (!reader) throw new Error('No reader from Groq')

          const decoder = new TextDecoder()
          let buffer = ''

          while (true) {
            const { done, value } = await reader.read()
            if (done) break
            
            buffer += decoder.decode(value, { stream: true })
            const lines = buffer.split('\n')
            buffer = lines.pop() || ''
            
            for (const line of lines) {
              if (line.startsWith('data: ') && line !== 'data: [DONE]') {
                try {
                  const parsed = JSON.parse(line.slice(6))
                  const text = parsed.choices?.[0]?.delta?.content || ''
                  if (text) {
                    fullResponse += text
                    await sendSSE(text)
                  }
                } catch (e) {}
              }
            }
          }
        } catch (groqError) {
          console.error('Groq fallback failed:', groqError)
          await sendSSE('\n\n[Error: Unable to generate response]')
        }
      }

      await sendDone()

      if (fullResponse) {
        // Save assistant message
        const { error: assistantMessageError } = await supabase.from('ai_messages').insert({
          conversation_id: currentConversationId,
          role: 'assistant',
          content: fullResponse
        })
        if (assistantMessageError) console.error('Could not save assistant reply', assistantMessageError)

      }
    }

    processStream()

    return new Response(stream.readable, {
      headers: {
        ...corsHeaders,
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive'
      }
    })

  } catch (err: any) {
    const errorMsg = err instanceof Error ? err.message : 'Unknown error'
    
    // No privileged DB client in the error handler.
    console.error('AI chat error:', errorMsg)

    return new Response(JSON.stringify({ error: errorMsg }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})
