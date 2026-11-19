<#
.SYNOPSIS
  Assistant d'installation de Patrimoine pour Windows (équivalent de scripts/setup.sh).
.DESCRIPTION
  Crée .env avec des mots de passe aléatoires et pose quelques questions courtes sur les options facultatives.
  Idempotent : un .env existant garde ses mots de passe. Les secrets saisis ne sont jamais affichés.
.PARAMETER Yes
  Mode non interactif : valeurs par défaut (ou variables d'environnement déjà définies, ex. ANTHROPIC_API_KEY).
.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\scripts\setup.ps1
  powershell -ExecutionPolicy Bypass -File .\scripts\setup.ps1 -Yes
#>
param([switch]$Yes)
$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..')

if (-not [Environment]::UserInteractive -or [Console]::IsInputRedirected) { $Yes = $true }

$utf8 = New-Object System.Text.UTF8Encoding($false)   # UTF-8 sans BOM : Docker Compose lit .env tel quel
function New-Hex([int]$bytes) {
  $b = New-Object byte[] $bytes
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create(); $rng.GetBytes($b); $rng.Dispose()
  -join ($b | ForEach-Object { $_.ToString('x2') })
}
function Read-EnvLines { [System.IO.File]::ReadAllText((Join-Path (Get-Location) '.env')) -split "`r?`n" }
function Get-Kv([string]$k) {
  if (-not (Test-Path .env)) { return '' }
  foreach ($l in Read-EnvLines) { if ($l.StartsWith("$k=")) { return $l.Substring($k.Length + 1) } }
  return ''
}
function Set-Kv([string]$k, [string]$v) {
  $lines = @(Read-EnvLines); $done = $false
  $out = foreach ($l in $lines) { if ($l.StartsWith("$k=")) { $done = $true; "$k=$v" } else { $l } }
  $out = @($out)
  if (-not $done) { $out += "$k=$v" }
  $text = (($out -join "`n").TrimEnd("`n")) + "`n"
  [System.IO.File]::WriteAllText((Join-Path (Get-Location) '.env'), $text, $utf8)
}
function Protect-Env {
  # Droits restreints à l'utilisateur courant (équivalent de chmod 600).
  try { & icacls.exe .env /inheritance:r /grant:r "$($env:USERNAME):(R,W)" | Out-Null } catch { }
}
function Ask([string]$prompt, [string]$def = '', [switch]$Secret) {
  if ($Yes) { return $def }
  if ($def -and -not $Secret) { $prompt = "$prompt [$def]" }
  if ($Secret) {
    $s = Read-Host "$prompt (saisie invisible)" -AsSecureString
    $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($s)
    try { $ans = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
  } else { $ans = Read-Host $prompt }
  if ($ans) { $ans } else { $def }
}
function YesNo([string]$q, [bool]$def = $false) {
  if ($Yes) { return $def }
  $ans = Read-Host "$q [$(if ($def) { 'O/n' } else { 'o/N' })]"
  if (-not $ans) { return $def }
  return ($ans -match '^(o|oui|y|yes)$')
}

# --- 1. Fichier .env -----------------------------------------------------------------------------------------
$new = $false
if (-not (Test-Path .env)) {
  $new = $true
  $db = New-Hex 16; $gf = New-Hex 16
  $text = [System.IO.File]::ReadAllText((Join-Path (Get-Location) '.env.example'))
  $text = $text -replace '(?m)^POSTGRES_PASSWORD=.*$', "POSTGRES_PASSWORD=$db"
  $text = $text -replace '(?m)^DATABASE_URL=.*$', "DATABASE_URL=postgresql://patrimoine:$db@postgres:5432/patrimoine"
  $text = $text -replace '(?m)^GF_SECURITY_ADMIN_PASSWORD=.*$', "GF_SECURITY_ADMIN_PASSWORD=$gf"
  $text = $text -replace "`r`n", "`n"
  [System.IO.File]::WriteAllText((Join-Path (Get-Location) '.env'), $text, $utf8)
  Write-Host "OK  .env créé avec des mots de passe aléatoires."
} else {
  Write-Host "OK  .env existe déjà : mots de passe conservés."
}
Protect-Env
New-Item -ItemType Directory -Force -Path secrets | Out-Null

# --- 2. Options facultatives ---------------------------------------------------------------------------------
if ($Yes) {
  foreach ($k in 'ANTHROPIC_API_KEY','SMTP_HOST','SMTP_PORT','SMTP_USER','SMTP_PASSWORD','SMTP_FROM','NTFY_TOPIC','NTFY_URL','EB_APP_ID','APP_URL') {
    $v = [Environment]::GetEnvironmentVariable($k)
    if ($v -and $v -ne (Get-Kv $k)) { Set-Kv $k $v }
  }
} else {
  Write-Host ""
  Write-Host "Options facultatives (Entrée = passer). Tout se change plus tard dans .env."

  Write-Host "`n1/5  Adresse d'accès (utilisée dans les liens des e-mails et notifications)"
  $v = Ask "     Adresse de l'application" (Get-Kv 'APP_URL'); if ($v) { Set-Kv 'APP_URL' $v }

  Write-Host "`n2/5  Conseiller IA (clé API Anthropic, https://console.anthropic.com)"
  if (YesNo "     Activer le conseiller IA ?") { $v = Ask "     Clé API" '' -Secret; if ($v) { Set-Kv 'ANTHROPIC_API_KEY' $v } }

  Write-Host "`n3/5  Digest par e-mail (serveur SMTP ; Gmail : smtp.gmail.com + mot de passe d'application)"
  if (YesNo "     Activer l'envoi d'e-mails ?") {
    $v = Ask "     Serveur SMTP" (Get-Kv 'SMTP_HOST'); if ($v) { Set-Kv 'SMTP_HOST' $v }
    $v = Ask "     Port" (Get-Kv 'SMTP_PORT'); if ($v) { Set-Kv 'SMTP_PORT' $v }
    $u = Ask "     Utilisateur (adresse e-mail)"; if ($u) { Set-Kv 'SMTP_USER' $u }
    $v = Ask "     Mot de passe" '' -Secret; if ($v) { Set-Kv 'SMTP_PASSWORD' $v }
    $v = Ask "     Expéditeur" $u; if ($v) { Set-Kv 'SMTP_FROM' $v }
  }

  Write-Host "`n4/5  Notifications ntfy (https://ntfy.sh ; le nom du sujet sert de mot de passe)"
  if (YesNo "     Activer les notifications ntfy ?") {
    $v = Ask "     Nom du sujet (vide = en générer un aléatoire)"
    if (-not $v) { $v = "patrimoine-$(New-Hex 8)" }
    Set-Kv 'NTFY_TOPIC' $v
    $v = Ask "     Serveur ntfy" (Get-Kv 'NTFY_URL'); if ($v) { Set-Kv 'NTFY_URL' $v }
  }

  Write-Host "`n5/5  Banques automatiques (Enable Banking, gratuit pour ses propres comptes)"
  Write-Host "     Sans cela, vous pouvez importer vos relevés (CSV, OFX) depuis l'application."
  if (YesNo "     Configurer Enable Banking ?") {
    $v = Ask "     Identifiant d'application (EB_APP_ID)" (Get-Kv 'EB_APP_ID'); if ($v) { Set-Kv 'EB_APP_ID' $v }
    Write-Host "     Placez ensuite votre clé privée dans secrets\enablebanking.pem"
  }
}

# --- 3. Suite ----------------------------------------------------------------------------------------------------
Write-Host ""
Write-Host "Configuration terminée. Étape suivante :"
Write-Host ""
Write-Host "    docker compose up -d --build"
Write-Host ""
Write-Host "puis ouvrez $(Get-Kv 'APP_URL')."
Write-Host "Les secrets sont dans .env : ne le partagez pas et ne le versionnez pas."
if (-not $new) { Write-Host "Pour tout regénérer : supprimez .env puis relancez ce script (la base existante gardera l'ancien mot de passe)." }
