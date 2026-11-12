# Database backup and restore

The Supabase free plan has no automatic backups. The **Database Backup**
GitHub Action (`.github/workflows/database-backup.yml`) makes an encrypted
copy of the production database every Sunday night and keeps it for 90 days.

## One-time setup

1. Supabase dashboard → project **MH Tracker** → **Connect** → copy the
   **Session pooler** connection string and put the database password into it.
   (Forgot the password? Project Settings → Database → Reset database password,
   then update anything else that uses it.)
2. Choose a long passphrase (for example four random words and a number) and
   store it in your password manager. Without it no backup can be opened.
3. GitHub → repository → **Settings → Secrets and variables → Actions** →
   **New repository secret**, twice:
   - `SUPABASE_DB_URL` = the connection string from step 1
   - `BACKUP_PASSPHRASE` = the passphrase from step 2
4. GitHub → **Actions → Database Backup → Run workflow** to make the first
   backup now. The run should finish green and show one artifact named
   `mh-tracker-db-<date>`.

Until both secrets exist the workflow still runs but skips the backup and
shows a "Backup skipped" warning.

## Downloading and opening a backup

1. Actions → Database Backup → pick a run → download the artifact (a zip).
2. Unzip it, then decrypt (Git Bash on Windows, or any Linux/macOS terminal):

   ```bash
   gpg --decrypt mh-tracker-db-<date>.tar.gz.gpg > backup.tar.gz
   tar -xzf backup.tar.gz
   ```

   The folder contains `roles.sql`, `schema.sql` and `data.sql`.

## Restoring into a new Supabase project

Restore into a **new, empty** project first and check it there. Never run
these files against the live project.

```bash
psql "<NEW_PROJECT_SESSION_POOLER_URL>" \
  --single-transaction --variable ON_ERROR_STOP=1 \
  --file roles.sql --file schema.sql \
  --command 'SET session_replication_role = replica' \
  --file data.sql
```

Afterwards: point `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` (Cloudflare
Pages environment variables) at the new project, redeploy the edge functions,
and re-add their secrets (`GEMINI_API_KEY`, Meta app secrets).

Storage files (uploaded PDFs and images) are not inside the database dump.
Most project files live as Google Drive links, so the database backup covers
the important records.
