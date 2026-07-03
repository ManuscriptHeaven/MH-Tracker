# Simple Step-by-Step Setup Guide

Use this guide first. It explains the setup in the easiest order.

The detailed technical version is in `DEPLOYMENT.md`.

## What You Are Building

You will have:

- A free frontend website on Cloudflare Pages
- Employee login using Supabase
- Employees type their first name and password in the app
- A Supabase database for projects
- Rules so employees only see their assigned projects
- Admin and Project Manager accounts that can see all projects

You do not need a paid domain.

The app can run on a free URL like:

```text
https://your-app-name.pages.dev
```

## Accounts You Need

Create free accounts for:

1. GitHub
2. Supabase
3. Cloudflare

## Step 1: Create Supabase Project

1. Go to Supabase.
2. Create a new project.
3. Choose the Free Plan.
4. Wait until the project is ready.
5. Open the project dashboard.
6. Go to Project Settings.
7. Go to API.
8. Copy these two values:

```text
Project URL
anon public key
```

You will use them later in Cloudflare.

## Step 2: Create Database and Security Rules

1. In Supabase, open SQL Editor.
2. Open this file in the project:

```text
supabase/schema.sql
```

3. Copy the full SQL code.
4. Paste it into Supabase SQL Editor.
5. Click Run.

This creates the database tables and turns on the security rules so:

- Employees see only assigned projects
- Admin can see all projects
- Project Manager can see all projects
- Payment records are protected separately for Admin and Project Manager only

## Step 3: Create First Admin Login

1. In Supabase, go to Authentication.
2. Go to Users.
3. Click Add user.
4. Add your admin email and password.
5. After creating the user, copy the user ID.

Now add that user to the profiles table:

1. Go to Table Editor.
2. Open the `profiles` table.
3. Add a new row.
4. Fill it like this:

```text
id: paste the Supabase Auth user ID
email: your admin email
full_name: your name
role: admin
status: active
```

Save the row.

## Step 4: Add Employee Users

For each employee:

1. Go to Supabase Authentication.
2. Go to Users.
3. Click Add user.
4. Enter the employee email and password.
5. Copy the user ID.
6. Go to the `profiles` table.
7. Add a matching row.

Use one of these roles:

```text
admin
project_manager
employee
junior_assistant
```

Most staff should use:

```text
employee
```

## Step 5: Push Code to GitHub

1. Create a GitHub repository.
2. Upload or push this project code to GitHub.
3. Make sure the repository contains the React/Vite app files.

The app should use:

```text
npm run build
```

and should create a build folder named:

```text
dist
```

## Step 6: Deploy on Cloudflare Pages

1. Open Cloudflare.
2. Go to Workers & Pages.
3. Create a new Pages project.
4. Connect your GitHub repository.
5. Select your project.
6. Use these settings:

```text
Build command: npm run build
Output directory: dist
```

7. Save and deploy.

Cloudflare will give you a free website URL like:

```text
https://your-app-name.pages.dev
```

## Step 7: Add Supabase Keys to Cloudflare

1. Open your Cloudflare Pages project.
2. Go to Settings.
3. Go to Environment variables.
4. Add this variable:

```text
VITE_SUPABASE_URL
```

Value:

```text
Your Supabase Project URL
```

5. Add this variable:

```text
VITE_SUPABASE_ANON_KEY
```

Value:

```text
Your Supabase anon public key
```

6. Save.
7. Deploy again.

## Step 8: Add Cloudflare URL in Supabase

1. Copy your Cloudflare Pages URL.
2. Go back to Supabase.
3. Go to Authentication.
4. Go to URL Configuration.
5. Set Site URL to your Cloudflare Pages URL.

Example:

```text
https://your-app-name.pages.dev
```

6. Add this redirect URL:

```text
https://your-app-name.pages.dev/**
```

7. Also add this for local testing:

```text
http://localhost:5173/**
```

Save the settings.

## Step 9: Test Login

Open your Cloudflare Pages URL.

Test these accounts:

1. Login as admin using the first name from the `profiles` table and the Supabase Auth password.
2. Create a project.
3. Assign an employee to the project.
4. Login as that employee using their first name and password.
5. Confirm the employee can see the assigned project.
6. Login as another employee who is not assigned.
7. Confirm that employee cannot see the project.
8. Login as Project Manager using their first name and password.
9. Confirm Project Manager can see all projects.

## Simple Setup Order

Follow this exact order:

1. Create Supabase project.
2. Run `supabase/schema.sql`.
3. Create admin user.
4. Add admin row in `profiles`.
5. Add employee users.
6. Add employee rows in `profiles`.
7. Push code to GitHub.
8. Connect GitHub to Cloudflare Pages.
9. Add Supabase environment variables in Cloudflare.
10. Deploy.
11. Add Cloudflare URL in Supabase Auth settings.
12. Test login.
13. Test employee access.

## Important Notes

- Do not pay for a domain.
- Do not use Next.js.
- Do not use server-side rendering.
- Do not put the Supabase service role key in Cloudflare.
- Only use the Supabase anon public key in the frontend.
- Keep the app small and lightweight.
