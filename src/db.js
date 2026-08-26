// Conexão com PostgreSQL e criação do schema.
// Usa a variável de ambiente DATABASE_URL (o Render fornece isso
// automaticamente quando você conecta um banco Postgres ao serviço).

import pg from "pg";

const { Pool } = pg;

// No Render, o Postgres exige SSL. Localmente, não.
const isProduction = process.env.NODE_ENV === "production";

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: isProduction ? { rejectUnauthorized: false } : false,
});

// Cria a tabela de eventos se ainda não existir. Chamado no start do servidor.
// Cada evento é ANÔNIMO: device_id é um UUID aleatório gerado no app, não
// vinculado à identidade da pessoa. Serve só para agrupar a jornada de um
// mesmo aparelho (ex.: viu o paywall -> assinou).
export async function initSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS events (
      id           BIGSERIAL PRIMARY KEY,
      device_id    TEXT        NOT NULL,
      name         TEXT        NOT NULL,
      properties   JSONB       NOT NULL DEFAULT '{}'::jsonb,
      app_version  TEXT,
      platform     TEXT        DEFAULT 'ios',
      created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  // Índices para as consultas do dashboard ficarem rápidas mesmo com
  // muitos eventos: por nome de evento e por data.
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_events_name ON events (name);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_events_created ON events (created_at);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_events_device ON events (device_id);`);

  console.log("Schema pronto (tabela events + índices).");
}
