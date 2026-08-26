# Grimoire Analytics

Backend próprio de analytics dos jogos iOS. Recebe eventos anônimos do app
e mostra um dashboard de conversão. Node.js + Express + PostgreSQL,
rodando no Render.

## Funil de conversão

O dashboard mostra 4 etapas: **Paywall → Checkout → Trials → Subscribes**.

Cada etapa aceita mais de um nome de evento (pra manter compat com o
cliente atual e com o padrão que você já usa nos outros apps):

| Etapa       | Aceita esses eventos                                |
|-------------|-----------------------------------------------------|
| Paywall     | `paywall_viewed`, `paywall_view`                    |
| Checkout    | `purchase_started`, `checkout_initiated`            |
| Trials      | `trial_started`, `start_trial`                      |
| Subscribes  | `purchase_completed`, `subscribe_completed`         |

A **taxa de conversão geral** = `(trials + subscribes) / paywall`. Junta
trials com subscribes porque ambos são "converteu do paywall" — trials
são receita futura provável.

Se um dispositivo dispara `trial_started` E depois `purchase_completed`
(trial converteu em assinatura), ele conta 1 em cada etapa. É o que você
quer: dá pra ver a taxa de trial→subscribe olhando os dois números.

### Rastreando trials

Pra ter dados na coluna Trials, o cliente iOS precisa emitir
`trial_started` quando o produto comprado tem período de trial. Na
SubscriptionStore, dá pra fazer algo assim depois do
`await store.purchase(product)`:

```swift
if ok, let subInfo = product.subscription,
   let intro = subInfo.introductoryOffer,
   intro.paymentMode == .freeTrial {
    analytics.track(.trial_started, ["plan": product.id])
} else if ok {
    analytics.track(.purchase_completed, ["plan": product.id])
}
```

Enquanto não emitir `trial_started`, a coluna fica em 0 e a conversão
geral considera só assinaturas efetivadas.

## Estrutura

```
analytics-grimoire/
├── src/
│   ├── server.js         Express + rotas
│   └── db.js             Pool Postgres + migration
├── public/
│   └── index.html        Dashboard visual
├── render.yaml           Blueprint pro Render
└── package.json
```

## Deploy no Render

Já rodando em `https://analytics-grimoire.onrender.com`. Se precisar
recriar do zero:

1. Push do código pro GitHub
2. Render → New → Blueprint → conecta o repo
3. O `render.yaml` cria web + Postgres + conexão automática
4. No painel do serviço → Environment → define:
   - `DASHBOARD_PASSWORD` — senha do dashboard
   - `INGEST_KEY` — (recomendado) chave que o app precisa mandar em
     `x-api-key`; sem ela, `/track` fica público e qualquer script pode
     entupir o banco

## Rodar localmente

```bash
npm install
export DATABASE_URL="postgresql://postgres@localhost:5432/grimoire_analytics"
export DASHBOARD_PASSWORD="test"
npm start
```

Abre http://localhost:3000

## Plano free do Render

- **Web:** dorme após inatividade, demora alguns segundos pra acordar
  na primeira request. Irrelevante pra analytics (o app é
  fire-and-forget).
- **Postgres:** **expira em 30 dias** e o banco é deletado. Pra manter
  dados históricos, suba pro plano pago mais baixo antes que expire.
