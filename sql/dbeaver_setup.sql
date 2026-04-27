-- ============================================================================
-- Nexion — criar banco NexionDatabase para usar no DBeaver
--
-- IMPORTANTE: no DBeaver, ligue-se primeiro ao banco interno "postgres"
-- (não ao NexionDatabase). Editor SQL → cole este script → Execute.
--
-- Depois: nova conexão ou altere "Base de dados" para NexionDatabase e,
-- se ainda não tiver tabelas, execute schema.sql estando ligado ao NexionDatabase.
-- ============================================================================

-- Senha do utilizador postgres (mesma do docker-compose e .env do projeto)
ALTER USER postgres WITH PASSWORD '9191';

-- Cria o banco (se já existir, o PostgreSQL devolve erro — pode ignorar)
CREATE DATABASE "NexionDatabase" ENCODING 'UTF8';
