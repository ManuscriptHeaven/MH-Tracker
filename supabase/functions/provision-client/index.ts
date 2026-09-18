import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    if (!supabaseUrl || !serviceRoleKey) throw new Error('Supabase server configuration is missing.')

    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return json({ error: 'Unauthorized' }, 401)

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    const token = authHeader.replace(/^Bearer\s+/i, '')
    const { data: authData, error: authError } = await admin.auth.getUser(token)
    if (authError || !authData.user) return json({ error: 'Unauthorized' }, 401)

    const { data: caller, error: callerError } = await admin
      .from('profiles')
      .select('id, role, status')
      .eq('id', authData.user.id)
      .maybeSingle()

    if (callerError || !caller || caller.role !== 'admin' || caller.status !== 'active') {
      return json({ error: 'Only active admins can add or update clients.' }, 403)
    }

    const body = await req.json()
    const fullName = String(body?.full_name || '').trim()
    const email = String(body?.email || '').trim().toLowerCase()
    const projectIds = Array.isArray(body?.project_ids)
      ? [...new Set(body.project_ids.map((value: unknown) => String(value)).filter(Boolean))]
      : []

    if (!fullName || !email || !email.includes('@')) {
      return json({ error: 'Client name and a valid email are required.' }, 400)
    }

    const { error: teamError } = await admin
      .from('team_members')
      .upsert(
        {
          full_name: fullName,
          email,
          role: 'client',
          status: 'active',
        },
        { onConflict: 'email' },
      )
    if (teamError) throw teamError

    let { data: profile, error: profileError } = await admin
      .from('profiles')
      .select('id, full_name, email, role, status')
      .ilike('email', email)
      .maybeSingle()
    if (profileError) throw profileError

    let invited = false
    if (!profile) {
      const { data: inviteData, error: inviteError } = await admin.auth.admin.inviteUserByEmail(email, {
        data: { full_name: fullName },
      })

      if (inviteError) {
        const normalized = inviteError.message.toLowerCase()
        if (!normalized.includes('already') && !normalized.includes('registered') && !normalized.includes('exists')) {
          throw inviteError
        }

        const { data: usersData, error: usersError } = await admin.auth.admin.listUsers({
          page: 1,
          perPage: 1000,
        })
        if (usersError) throw usersError
        const existingUser = usersData.users.find(
          (user) => String(user.email || '').toLowerCase() === email,
        )
        if (!existingUser) throw inviteError
        profile = {
          id: existingUser.id,
          full_name: fullName,
          email,
          role: 'client',
          status: 'active',
        }
      } else if (inviteData.user) {
        invited = true
        profile = {
          id: inviteData.user.id,
          full_name: fullName,
          email,
          role: 'client',
          status: 'active',
        }
      }
    }

    if (!profile?.id) throw new Error('Client identity could not be created.')

    const { error: profileUpdateError } = await admin
      .from('profiles')
      .update({ full_name: fullName, role: 'client', status: 'active' })
      .eq('id', profile.id)
    if (profileUpdateError) throw profileUpdateError

    const { error: accessDeleteError } = await admin
      .from('client_project_access')
      .delete()
      .eq('client_id', profile.id)
    if (accessDeleteError) throw accessDeleteError

    if (projectIds.length > 0) {
      const { data: validProjects, error: validProjectsError } = await admin
        .from('projects')
        .select('id')
        .in('id', projectIds)
      if (validProjectsError) throw validProjectsError

      const validIds = new Set((validProjects || []).map((project) => project.id))
      const rows = projectIds
        .filter((projectId) => validIds.has(projectId))
        .map((projectId) => ({ client_id: profile!.id, project_id: projectId }))

      if (rows.length > 0) {
        const { error: accessInsertError } = await admin
          .from('client_project_access')
          .insert(rows)
        if (accessInsertError) throw accessInsertError
      }
    }

    return json({
      ok: true,
      client_id: profile.id,
      invited,
      message: invited
        ? 'Client added and portal invite email sent.'
        : 'Client details and project access updated.',
    })
  } catch (error) {
    console.error('provision-client failed', error)
    return json(
      { error: error instanceof Error ? error.message : 'Client could not be saved.' },
      400,
    )
  }
})
