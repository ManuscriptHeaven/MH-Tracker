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

    // Check if dismissed today
    const todayStr = new Date().toISOString().split('T')[0]
    const { data: dismissal } = await supabase
      .from('ai_daily_summary_dismissals')
      .select('id')
      .eq('user_id', user.id)
      .eq('dismissed_date', todayStr)
      .single()

    if (dismissal) {
      return new Response(JSON.stringify({ dismissed: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const today = new Date()
    const next3Days = new Date(today)
    next3Days.setDate(today.getDate() + 3)

    // Gather data using Supabase
    // Note: Adjust table names and column names based on actual schema

    // 1. Active Projects
    const { data: activeProjects } = await supabase
      .from('projects')
      .select('*')
      .not('status', 'in', '("Closed", "Completed", "Delivered")')

    // 2. Overdue Projects
    const overdueProjects = activeProjects?.filter(p => new Date(p.due_date) < today) || []
    
    // 3. Projects due today
    const dueToday = activeProjects?.filter(p => p.due_date === todayStr) || []

    // 4. Pending Tasks
    const { data: tasks } = await supabase
      .from('tasks')
      .select('*')
      .eq('assigned_to', user.id)
      .not('status', 'eq', 'Completed')

    // 5. Unread notifications
    const { count: unreadCount } = await supabase
      .from('notifications')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .eq('read', false)

    // Proactive Detection Data Gathering
    // Upcoming deadlines (next 3 days)
    const upcomingDeadlines = activeProjects?.filter(p => {
      const dueDate = new Date(p.due_date)
      return dueDate > today && dueDate <= next3Days
    }) || []

    // Missing Files (>3 days in waiting)
    const threeDaysAgo = new Date(today)
    threeDaysAgo.setDate(today.getDate() - 3)
    const missingFiles = activeProjects?.filter(p => 
      (p.status === 'Files Required' || p.status === 'Waiting for Files') &&
      new Date(p.updated_at) < threeDaysAgo
    ) || []

    // AI Summary Generation
    const promptContext = `
    Active Projects: ${activeProjects?.length}
    Due Today: ${dueToday.length}
    Overdue: ${overdueProjects.length}
    Pending Tasks: ${tasks?.length}
    Unread Notifications: ${unreadCount}
    Upcoming Deadlines: ${upcomingDeadlines.length}
    Projects Missing Files: ${missingFiles.length}
    
    Please provide a short, professional, and helpful daily summary and action plan for a project manager.
    Keep it concise. Format as a warm greeting followed by 2-3 bullet points of the most urgent items.
    `

    const aiRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: promptContext }] }]
      })
    })

    let aiSummary = "Here is your daily overview."
    if (aiRes.ok) {
      const aiData = await aiRes.json()
      aiSummary = aiData.candidates?.[0]?.content?.parts?.[0]?.text || aiSummary
    }

    const summaryPayload = {
      dismissed: false,
      aiSummary,
      activeProjectsCount: activeProjects?.length || 0,
      dueToday,
      overdueProjects,
      pendingTasks: tasks || [],
      unreadNotificationsCount: unreadCount || 0,
      proactiveAlerts: {
        missingFiles,
        upcomingDeadlines
      }
    }

    return new Response(JSON.stringify(summaryPayload), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })

  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})
