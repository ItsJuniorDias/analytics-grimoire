// Servidor de analytics do Grimoire.
// - POST /track       : o app envia eventos anônimos
// - GET  /api/stats   : o dashboard busca métricas de conversão
// - GET  /            : dashboard visual (público, protegido por senha simples)
//
// Feito para rodar no Render: usa a porta de process.env.PORT e o banco
// de process.env.DATABASE_URL.

import express from "express";
import cors from "cors";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { pool, initSchema } from "./db.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();

app.use(cors());
app.use(express.json({ limit: "64kb" }));
app.use(express.static(join(__dirname, "..", "public")));

// Chave simples para proteger o dashboard e (opcionalmente) o envio.
// Defina DASHBOARD_PASSWORD e INGEST_KEY nas variáveis de ambiente do Render.
const DASHBOARD_PASSWORD = process.env.DASHBOARD_PASSWORD || "grimoire";
const INGEST_KEY = process.env.INGEST_KEY || null; // se null, não exige chave

// ------------------------------------------------------------------
// Definição do funil: cada etapa mapeia pra uma lista de nomes de
// evento que contam pra ela. Isso mantém compat com o cliente atual
// (purchase_started, purchase_completed) e também aceita o padrão dos
// outros apps (checkout_initiated, subscribe_completed, etc.).
// ------------------------------------------------------------------
const FUNNEL_STAGES = {
  paywall:    ["paywall_viewed", "paywall_view"],
  checkout:   ["purchase_started", "checkout_initiated"],
  trials:     ["trial_started", "start_trial"],
  subscribes: ["purchase_completed", "subscribe_completed"],
};

// ------------------------------------------------------------------
// Ingestão de eventos — o app chama isto.
// ------------------------------------------------------------------
app.post("/track", async (req, res) => {
  try {
    // Se você configurou INGEST_KEY, exige o header correspondente.
    if (INGEST_KEY) {
      const key = req.header("x-api-key");
      if (key !== INGEST_KEY) return res.status(401).json({ error: "unauthorized" });
    }

    const { device_id, name } = req.body || {};
    if (!device_id || !name) {
      return res.status(400).json({ error: "device_id e name são obrigatórios" });
    }

    const properties = req.body.properties && typeof req.body.properties === "object"
      ? req.body.properties : {};
    const appVersion = typeof req.body.app_version === "string" ? req.body.app_version : null;
    const platform = typeof req.body.platform === "string" ? req.body.platform : "ios";
    // country: opcional, 2 letras (ISO 3166-1 alpha-2). O cliente iOS envia
    // Locale.current.region?.identifier. Se vier maior ou vazio, ignora.
    const rawCountry = typeof req.body.country === "string" ? req.body.country.trim().toUpperCase() : null;
    const country = rawCountry && rawCountry.length === 2 ? rawCountry : null;

    await pool.query(
      `INSERT INTO events (device_id, name, properties, app_version, platform, country)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [String(device_id), String(name), properties, appVersion, platform, country]
    );

    res.status(201).json({ ok: true });
  } catch (err) {
    console.error("Erro no /track:", err);
    res.status(500).json({ error: "internal" });
  }
});

// ------------------------------------------------------------------
// Métricas — o dashboard chama isto.
// ------------------------------------------------------------------
app.get("/api/stats", async (req, res) => {
  try {
    if (req.query.password !== DASHBOARD_PASSWORD) {
      return res.status(401).json({ error: "unauthorized" });
    }

    // Janela de tempo em dias (default 30).
    const days = Math.max(1, Math.min(365, parseInt(req.query.days) || 30));
    const since = `now() - interval '${days} days'`;

    // Contagem por tipo de evento.
    const byEvent = await pool.query(
      `SELECT name, COUNT(*)::int AS count
       FROM events WHERE created_at >= ${since}
       GROUP BY name ORDER BY count DESC`
    );

    // Dispositivos únicos (proxy de "usuários" anônimos).
    const devices = await pool.query(
      `SELECT COUNT(DISTINCT device_id)::int AS n
       FROM events WHERE created_at >= ${since}`
    );

    // ---- FUNIL: Paywall → Checkout → Trials → Subscribes ----
    // Cada etapa aceita múltiplos nomes de evento (ver FUNNEL_STAGES).
    // Conta dispositivos únicos que dispararam qualquer um dos eventos
    // da etapa dentro da janela de tempo.
    const stageCount = async (eventNames) => {
      const r = await pool.query(
        `SELECT COUNT(DISTINCT device_id)::int AS n
         FROM events WHERE name = ANY($1) AND created_at >= ${since}`,
        [eventNames]
      );
      return r.rows[0].n;
    };

    const funnel = {
      paywall:    await stageCount(FUNNEL_STAGES.paywall),
      checkout:   await stageCount(FUNNEL_STAGES.checkout),
      trials:     await stageCount(FUNNEL_STAGES.trials),
      subscribes: await stageCount(FUNNEL_STAGES.subscribes),
    };

    // Conversão geral: quem viu o paywall e virou trial OU assinatura.
    // Trials + subscribes porque ambos são "converteu" do ponto de vista de negócio.
    // (Um trial pode virar subscribe depois; contar só subscribes esconde o topo.)
    const converted = funnel.trials + funnel.subscribes;
    const conversionRate = funnel.paywall > 0
      ? (converted / funnel.paywall) * 100
      : 0;

    // Eventos por dia (para o gráfico de linha).
    const daily = await pool.query(
      `SELECT to_char(date_trunc('day', created_at), 'YYYY-MM-DD') AS day,
              COUNT(*)::int AS count
       FROM events WHERE created_at >= ${since}
       GROUP BY day ORDER BY day`
    );

    // Histórias mais abertas (top 10). Aceita story_opened e story_open.
    const topStories = await pool.query(
      `SELECT properties->>'story_id' AS story_id,
              properties->>'title' AS title,
              COUNT(*)::int AS opens
       FROM events
       WHERE name IN ('story_opened', 'story_open')
         AND created_at >= ${since}
         AND properties->>'story_id' IS NOT NULL
       GROUP BY story_id, title ORDER BY opens DESC LIMIT 10`
    );

    res.json({
      days,
      total_events: byEvent.rows.reduce((s, r) => s + r.count, 0),
      unique_devices: devices.rows[0].n,
      by_event: byEvent.rows,
      funnel,
      conversion_rate: Number(conversionRate.toFixed(2)),
      converted, // trials + subscribes (numerador da conversão)
      daily: daily.rows,
      top_stories: topStories.rows,
    });
  } catch (err) {
    console.error("Erro no /api/stats:", err);
    res.status(500).json({ error: "internal" });
  }
});

// ------------------------------------------------------------------
// Últimos eventos individuais — o dashboard mostra numa tabela.
// Diferente de /api/stats que agrega, este retorna cada linha.
// ------------------------------------------------------------------
app.get("/api/recent-events", async (req, res) => {
  try {
    if (req.query.password !== DASHBOARD_PASSWORD) {
      return res.status(401).json({ error: "unauthorized" });
    }

    const limit = Math.max(1, Math.min(500, parseInt(req.query.limit) || 100));

    const r = await pool.query(
      `SELECT id, created_at, name, device_id, platform, country, properties
       FROM events
       ORDER BY created_at DESC
       LIMIT $1`,
      [limit]
    );

    res.json({
      events: r.rows.map(row => ({
        id: row.id,
        time: row.created_at,
        event: row.name,
        // Só os 8 primeiros chars do device_id — legível e ainda único no dia-a-dia.
        user: String(row.device_id).slice(0, 8),
        platform: row.platform || "—",
        country: row.country || "—",
        properties: row.properties || {},
      })),
    });
  } catch (err) {
    console.error("Erro no /api/recent-events:", err);
    res.status(500).json({ error: "internal" });
  }
});

// ------------------------------------------------------------------
// ZERAR EVENTOS — apaga TODA a tabela events e reinicia o id.
// Ação irreversível: protegida pela senha do dashboard.
// Usa TRUNCATE (mais rápido que DELETE em tabelas grandes) com
// RESTART IDENTITY pra reiniciar o BIGSERIAL do id em 1.
// ------------------------------------------------------------------
app.post("/api/events/clear", async (req, res) => {
  try {
    if (req.query.password !== DASHBOARD_PASSWORD) {
      return res.status(401).json({ error: "unauthorized" });
    }

    // Conta antes pra devolver quantos foram apagados (COUNT numa
    // tabela pequena é barato; se a tabela crescer muito, dá pra
    // trocar por pg_class.reltuples pra uma estimativa).
    const before = await pool.query(`SELECT COUNT(*)::int AS n FROM events`);
    const deleted = before.rows[0].n;

    await pool.query(`TRUNCATE TABLE events RESTART IDENTITY`);

    console.log(`Eventos zerados: ${deleted} linhas apagadas.`);
    res.json({ ok: true, deleted });
  } catch (err) {
    console.error("Erro no /api/events/clear:", err);
    res.status(500).json({ error: "internal" });
  }
});

// Healthcheck (o Render usa para saber se o serviço está vivo).
app.get("/health", (_req, res) => res.json({ ok: true }));

const PORT = process.env.PORT || 3000;

initSchema()
  .then(() => {
    app.listen(PORT, () => console.log(`Analytics rodando na porta ${PORT}`));
  })
  .catch((err) => {
    console.error("Falha ao iniciar schema:", err);
    process.exit(1);
  });
