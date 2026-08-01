$ErrorActionPreference = "Stop"

$projectRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $projectRoot

$token = [Environment]::GetEnvironmentVariable("CLOUDFLARE_API_TOKEN", "User")
if ([string]::IsNullOrWhiteSpace($token)) {
  $secureToken = Read-Host "Paste Cloudflare API token" -AsSecureString
  $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureToken)
  try {
    $token = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
  }
  finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
  }
}

if ([string]::IsNullOrWhiteSpace($token)) {
  throw "Cloudflare API token was not provided."
}

$env:CLOUDFLARE_API_TOKEN = $token
$env:CLOUDFLARE_ACCOUNT_ID = "46960ac6c9b58d562d6bc646f3b6b318"

$supabaseUrl = [Environment]::GetEnvironmentVariable("VITE_SUPABASE_URL", "User")
if ([string]::IsNullOrWhiteSpace($supabaseUrl)) {
  $supabaseUrl = "https://emhvwdhdmajpakoscuyn.supabase.co"
}

$supabaseAnonKey = [Environment]::GetEnvironmentVariable("VITE_SUPABASE_ANON_KEY", "User")
if ([string]::IsNullOrWhiteSpace($supabaseAnonKey)) {
  $secureSupabaseKey = Read-Host "Paste Supabase anon/public key" -AsSecureString
  $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureSupabaseKey)
  try {
    $supabaseAnonKey = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
  }
  finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
  }
}

if ([string]::IsNullOrWhiteSpace($supabaseAnonKey)) {
  throw "Supabase anon/public key was not provided."
}

$env:VITE_SUPABASE_URL = $supabaseUrl
$env:VITE_SUPABASE_ANON_KEY = $supabaseAnonKey

Write-Host "Building app..."
$pnpm = Get-Command pnpm.cmd -ErrorAction SilentlyContinue
$npm = Get-Command npm.cmd -ErrorAction SilentlyContinue

if ($pnpm) {
  & $pnpm.Source run build
}
elseif ($npm) {
  & $npm.Source run build
}
else {
  throw "Neither pnpm.cmd nor npm.cmd was found. Please install Node.js or add it to PATH."
}

Write-Host "Deploying to Cloudflare Pages..."
$npx = Get-Command npx.cmd -ErrorAction SilentlyContinue
if (-not $npx) {
  $defaultNpx = "C:\Program Files\nodejs\npx.cmd"
  if (Test-Path $defaultNpx) {
    $npx = [pscustomobject]@{ Source = $defaultNpx }
  }
}

if (-not $npx) {
  throw "npx.cmd was not found. Please install Node.js or add it to PATH."
}

& $npx.Source wrangler pages deploy dist --project-name=mh-tracker
