#Requires -RunAsAdministrator
<#
  Tenta iniciar o serviço PostgreSQL instalado no Windows.
  Execute: clique direito no PowerShell > Executar como administrador, depois:
    cd caminho\ProjetoNexion\BackEndNexion\scripts
    .\start-postgres-service.ps1
#>

$ErrorActionPreference = 'Stop'

$found = Get-Service -ErrorAction SilentlyContinue | Where-Object {
  $_.Name -match 'postgres' -or $_.DisplayName -match 'PostgreSQL'
}

if (-not $found) {
  Write-Host 'Nenhum serviço PostgreSQL encontrado neste Windows.' -ForegroundColor Yellow
  Write-Host 'Opções:'
  Write-Host '  1) Instale o PostgreSQL: https://www.postgresql.org/download/windows/'
  Write-Host '  2) Ou use Docker na pasta do projeto: docker compose up -d'
  exit 1
}

foreach ($svc in $found) {
  Write-Host "Serviço: $($svc.Name) ($($svc.DisplayName)) — Status: $($svc.Status)"
  if ($svc.Status -ne 'Running') {
    try {
      Start-Service -Name $svc.Name
      Write-Host "  -> Iniciado." -ForegroundColor Green
    } catch {
      Write-Host "  -> Falha ao iniciar: $_" -ForegroundColor Red
    }
  } else {
    Write-Host '  -> Já estava em execução.' -ForegroundColor Green
  }
}

Write-Host "`nTeste no DBeaver: localhost:5432, usuário postgres, senha a que definiu na instalação."
