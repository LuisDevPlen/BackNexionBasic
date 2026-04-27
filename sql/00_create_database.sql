-- Execute conectado ao banco padrão "postgres" (não ao NexionDatabase):
--   psql -U postgres -h localhost -d postgres -f sql/00_create_database.sql
--
-- Depois crie as tabelas:
--   psql -U postgres -h localhost -d "NexionDatabase" -f sql/schema.sql

CREATE DATABASE "NexionDatabase" ENCODING 'UTF8';
