# Grimoire Analytics — Backend

Backend próprio de analytics do app Grimoire. Recebe eventos anônimos
do app iOS e mostra um dashboard de conversão. Node.js + Express +
PostgreSQL, pronto para rodar no Render.

## O que ele mede

Funil de conversão (dispositivos únicos anônimos em cada etapa):

1. `app_opened` — abriu o app
2. `story_opened` — abriu uma história
3. `paywall_viewed` — viu o paywall
4. `purchase_started` — tocou em assinar
5. `purchase_completed` — assinou

Mais: taxa de conversão do paywall, histórias mais abertas, eventos por dia.

## Deploy no Render (passo a passo)

### 1. Suba o código para um repositório (GitHub/GitLab)
Crie um repositório e faça push desta pasta (`analytics-server`).

### 2. No Render, crie a partir do Blueprint
- Acesse render.com → New → Blueprint
- Conecte o repositório
- O Render lê o `render.yaml` e cria automaticamente:
  - o serviço web (o servidor)
  - o banco Postgres (`grimoire-db`)
  - a conexão entre eles (DATABASE_URL é preenchida sozinha)

### 3. Defina a senha do dashboard
No painel do serviço → Environment → defina:
- `DASHBOARD_PASSWORD` = uma senha sua (para acessar o dashboard)
- `INGEST_KEY` = (opcional) uma chave; se definir, ponha a mesma no app

### 4. Deploy
O Render faz o build e sobe. Ao final você terá uma URL tipo:
`https://grimoire-analytics.onrender.com`

### 5. Conecte o app
No arquivo `Core/Analytics.swift` do app iOS, troque:
```swift
private let endpoint = "https://SEU-APP.onrender.com"
```
pela URL real do seu serviço. Se definiu `INGEST_KEY`, ponha em `ingestKey`.

### 6. Veja o dashboard
Abra a URL do serviço no navegador, digite a senha, e pronto.

## Rodar localmente (opcional, para testar)

Precisa de um Postgres local. Depois:
```bash
npm install
export DATABASE_URL="postgresql://postgres@localhost:5432/grimoire_analytics"
export DASHBOARD_PASSWORD="test"
npm start
```
Abra http://localhost:3000

## Nota sobre o plano free do Render

O plano gratuito "dorme" após inatividade e demora alguns segundos para
acordar na primeira requisição. Para analytics isso é irrelevante (os
eventos são fire-and-forget e o app não espera resposta). O banco free
tem limite de armazenamento generoso para começar.

## Privacidade

Tudo é anônimo: cada evento traz um UUID aleatório gerado no app, sem
vínculo com identidade, Apple ID ou dados pessoais. Ainda assim, declare
no App Store Connect que o app coleta "dados de uso" (analytics) — mesmo
anônimo, a Apple pede a declaração.
