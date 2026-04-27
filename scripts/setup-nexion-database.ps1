# Cria o banco NexionDatabase, senha postgres=9191 e aplica sql/schema.sql
# Uso (PowerShell): .\setup-nexion-database.ps1
# Requer: PostgreSQL acessível em localhost:5432 (Docker OU serviço Windows).

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$backendRoot = Split-Path -Parent $scriptDir
$projectRoot = Split-Path -Parent $backendRoot

Write-Host '== Nexion — configurar PostgreSQL ==' -ForegroundColor Cyan

# 1) Tentar subir o contentor Docker do projeto (ignora falha se Docker estiver fechado)
Push-Location $projectRoot
docker compose up -d *>&1 | Out-Null
if ($LASTEXITCODE -eq 0) {
  Write-Host 'Docker Compose: contentor iniciado ou já em execução.' -ForegroundColor Green
} else {
  Write-Host 'Docker Compose: não disponível ou falhou — use PostgreSQL local ou abra o Docker Desktop.' -ForegroundColor Yellow
}
Pop-Location

# 2) Esperar porta 5432
$maxWaitSec = 120
$elapsed = 0
$listening = $false
Write-Host "À espera de localhost:5432 (até ${maxWaitSec}s)..."
while ($elapsed -lt $maxWaitSec) {
  $tcp = Test-NetConnection -ComputerName localhost -Port 5432 -WarningAction SilentlyContinue
  if ($tcp.TcpTestSucceeded) {
    $listening = $true
    Write-Host 'PostgreSQL está a aceitar ligações.' -ForegroundColor Green
    break
  }
  Start-Sleep -Seconds 3
  $elapsed += 3
}
if (-not $listening) {
  Write-Host @'

Não foi possível ligar à porta 5432.
• Com Docker: abra o Docker Desktop e execute na pasta do projeto:
    docker compose up -d
• Com PostgreSQL no Windows: inicie o serviço em services.msc (postgresql-…).

Depois volte a executar este script.

'@ -ForegroundColor Red
  exit 1
}

# 3) Criar banco + schema via Node (usa postgres:9191 por defeito — ver scripts/init-db.mjs)
Push-Location $backendRoot
npm run db:init
$dbInitCode = $LASTEXITCODE
Pop-Location

if ($dbInitCode -ne 0) {
  Write-Host @'

Falhou npm run db:init. Se a senha do utilizador postgres não for 9191 neste servidor, execute antes:

  `$env:DATABASE_URL_ADMIN='postgresql://postgres:SUA_SENHA@localhost:5432/postgres'`

Depois volte a correr este script.

'@ -ForegroundColor Yellow
  exit 1
}

Write-Host @'

Concluído.
• DBeaver: Host localhost, porta 5432, base NexionDatabase, utilizador postgres, senha 9191.

'@ -ForegroundColor Green
