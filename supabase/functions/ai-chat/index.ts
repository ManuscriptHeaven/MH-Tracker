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
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const geminiKey = Deno.env.get('GEMINI_API_KEY')
    const groqKey = Deno.env.get('GROQ_API_KEY')

    // Initialize Supabase client
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // Authenticate user
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      throw new Error('Missing Authorization header')
    }
    const token = authHeader.replace('Bearer ', '')
    const { data: { user }, error: authError } = await supabase.auth.getUser(token)
    
    if (authError || !user) {
      throw new Error('Unauthorized')
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
    const { message, conversationId, context } = body

    if (!message) {
      throw new Error('Message is required')
    }

    // Create conversation if needed
    let currentConversationId = conversationId
    if (!currentConversationId) {
      const { data: conv, error: convError } = await supabase
        .from('ai_conversations')
        .insert({ user_id: user.id, title: message.substring(0, 50) })
        .select()
        .single()
      
      if (convError) throw convError
      currentConversationId = conv.id
    }

    // Context summary
    const contextStr = context ? JSON.stringify(context) : ''
    
    // Check ai_response_cache
    const hashInput = `${message}-${contextStr}`
    const encoder = new TextEncoder()
    const data = encoder.encode(hashInput)
    const hashBuffer = await crypto.subtle.digest('SHA-256', data)
    const hashArray = Array.from(new Uint8Array(hashBuffer))
    const queryHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('')

    const { data: cachedResponse } = await supabase
      .from('ai_response_cache')
      .select('response')
      .eq('query_hash', queryHash)
      .gt('expires_at', new Date().toISOString())
      .single()

    const stream = new TransformStream()
    const writer = stream.writable.getWriter()
    
    const sendSSE = async (text: string) => {
      await writer.write(encoder.encode(`data: ${JSON.stringify({ text })}\n\n`))
    }
    
    const sendDone = async () => {
      await writer.write(encoder.encode(`data: [DONE]\n\n`))
      await writer.close()
    }

    if (cachedResponse) {
      // Stream cached response
      setTimeout(async () => {
        await sendSSE(cachedResponse.response)
        await sendDone()
      }, 0)
      
      return new Response(stream.readable, {
        headers: {
          ...corsHeaders,
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive'
        }
      })
    }

    const systemPrompt = `You are the 'MH AI Assistant' for the Manuscript Heaven Project Tracker.
You specialize in book formatting, publishing, and project management.
Keep responses helpful, professional, and warm. 
Context data summary: ${contextStr}`

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
    await supabase.from('ai_messages').insert({
      conversation_id: currentConversationId,
      user_id: user.id,
      role: 'user',
      content: message
    })

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
        await supabase.from('ai_messages').insert({
          conversation_id: currentConversationId,
          user_id: user.id,
          role: 'assistant',
          content: fullResponse
        })

        // Cache response
        const expiresAt = new Date()
        expiresAt.setHours(expiresAt.getHours() + 1)
        await supabase.from('ai_response_cache').upsert({
          query_hash: queryHash,
          response: fullResponse,
          expires_at: expiresAt.toISOString()
        })
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
    
    // Log error
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, supabaseServiceKey)
    await supabase.from('ai_error_logs').insert({ error: errorMsg })

    return new Response(JSON.stringify({ error: errorMsg }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})
