# Manuscript Heaven Project Tracker

A modern internal project tracker for a book formatting and publishing service team.

## What Is Included

- React + Vite + TypeScript frontend
- Tailwind CSS premium dashboard design
- Supabase Auth-ready first-name login
- Supabase Postgres schema and Row Level Security
- Separate protected `project_payments` table so only Admin and Project Manager can read payment data
- Dashboard analytics
- Project list, filters, search, CSV export
- Project details with notes, revisions, links, activity, and payments
- Team workload view
- Calendar view
- Delivered projects and payment tracking
- Demo mode before Supabase keys are added
- Cloudflare Pages-ready static deployment

## Local Setup

Install dependencies:

```bash
npm install
```

Start the app:

```bash
npm run dev
```

Build for Cloudflare Pages:

```bash
npm run build
```

Cloudflare Pages settings:

```text
Build command: npm run build
Output directory: dist
```

## Environment Variables

Create `.env.local`:

```text
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_ANON_KEY=your-supabase-anon-key
```

If these are not set, the app opens in demo mode so you can preview the interface.

## Supabase Setup

1. Create a Supabase project on the Free Plan.
2. Open Supabase SQL Editor.
3. Copy and run `supabase/schema.sql`.
4. Create the first admin user in Supabase Auth.
5. Add a matching row to `public.profiles` using the Auth user ID.
6. Add employees in Supabase Auth.
7. Add employee rows in `public.profiles`.
8. Add the Supabase URL and anon key to Cloudflare Pages environment variables.

Employees log in with the first name saved in `profiles.full_name` and their Supabase Auth password.

More detailed setup is in:

- `SIMPLE_SETUP_GUIDE.md`
- `DEPLOYMENT.md`
