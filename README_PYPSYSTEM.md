# Firecrawl API - Guia de Manutenção e Operação

## 1. Introdução

### 1.1 O que é Firecrawl?

Firecrawl é uma API de web scraping e crawling que converte websites em dados estruturados e prontos para uso em aplicações. A solução pode ser self-hosted ou utilizada via cloud.

### 1.2 Objetivo deste Documento

Este guia é destinado a **equipes de manutenção e operação** que precisam:
- Configurar e manter a infraestrutura Firecrawl
- Monitorar e diagnosticar problemas
- Otimizar performance
- Gerenciar recursos e escalabilidade

**Nota:** Este documento **não** cobre integração com aplicações cliente. Para isso, consulte documentação específica de integração.

---

## 2. Arquitetura e Componentes

### 2.1 Visão Geral da Arquitetura

```
┌─────────────────────────────────────────────────────────┐
│                  API Server (Express.js)                │
│                  Port: 3002 (default)                   │
│  ┌───────────────────────────────────────────────────┐  │
│  │  Endpoints:                                       │  │
│  │  - POST /v1/scrape    (scraping síncrono)         │  │
│  │  - POST /v1/crawl     (crawling assíncrono)       │  │
│  │  - GET  /v1/crawl/:id (status do crawl)           │  │
│  │  - POST /v1/map       (discovery de URLs)         │  │
│  │  - POST /v1/search    (search na web)             │  │
│  │  - POST /v1/extract   (extração com AI)           │  │
│  │  - POST /v2/batch/scrape (batch scraping)         │  │
│  └───────────────────────────────────────────────────┘  │
└──────────────┬────────────┬──────────────┬──────────────┘
               │            │              │
       ┌───────┴────┐   ┌───┴─────┐   ┌───┴────────────┐
       │            │   │         │   │                │
┌──────▼──────┐ ┌──▼─────────┐ ┌─▼───────────┐ ┌──────▼──────┐
│   Redis     │ │ PostgreSQL │ │  Playwright │ │   Workers   │
│  Port: 6379 │ │ Port: 5432 │ │  Service    │ │  (BullMQ)   │
│             │ │            │ │  Port: 3000 │ │             │
└─────────────┘ └────────────┘ └─────────────┘ └─────────────┘
```

### 2.2 Componentes Principais

#### 2.2.1 API Server (apps/api)
- **Tecnologia:** Express.js com TypeScript
- **Porta padrão:** 3002
- **Função:** Recebe requisições HTTP, valida, enfileira jobs e retorna respostas
- **Processos:**
  - `harness.js --start-docker`: Inicializa API + Workers
  - `index.js`: Apenas API server
  - `queue-worker.js`: Worker para jobs de crawling

#### 2.2.2 Playwright Service (apps/playwright-service-ts)
- **Tecnologia:** Playwright (Chromium, Firefox, WebKit)
- **Porta padrão:** 3000
- **Função:** Renderização de JavaScript e automação de browser
- **Uso:** Páginas com conteúdo dinâmico (SPAs, React, Vue, etc.)

#### 2.2.3 Redis
- **Versão:** Alpine (latest)
- **Porta:** 6379
- **Funções:**
  - Gerenciamento de filas (BullMQ)
  - Rate limiting
  - Cache de sessões

#### 2.2.4 PostgreSQL (nuq-postgres)
- **Versão:** Custom build (apps/nuq-postgres)
- **Porta:** 5432
- **Credenciais padrão:**
  - User: `postgres`
  - Password: `postgres`
  - Database: `postgres`
- **Função:** Armazenamento de jobs e estado de crawling

#### 2.2.5 Workers
Processos separados que executam jobs em background:
- **queue-worker:** Processa jobs de crawling
- **nuq-worker:** Worker principal do sistema de filas
- **nuq-prefetch-worker:** Pre-fetch de URLs
- **extract-worker:** Jobs de extração com AI
- **index-worker:** Indexação de dados

---

## 3. Quick Start com Docker

### 3.1 Pré-requisitos

**Hardware mínimo recomendado:**
- 4 vCPUs
- 8GB RAM
- 20GB disco livre

**Software:**
- Docker 24+
- Docker Compose v2+

### 3.2 Configuração Inicial

#### Passo 1: Configurar variáveis de ambiente

Edite o arquivo `.env` na raiz do projeto:

```env
# ===== Configurações Básicas =====
PORT=3002
HOST=0.0.0.0

# Redis (autoconfigured pelo docker-compose)
REDIS_URL=redis://redis:6379
REDIS_RATE_LIMIT_URL=redis://redis:6379

# Playwright Service (autoconfigured)
PLAYWRIGHT_MICROSERVICE_URL=http://playwright-service:3000/scrape

# Desabilitar autenticação (ideal para self-hosted)
USE_DB_AUTHENTICATION=false

# ===== Segurança =====
# IMPORTANTE: Alterar em produção!
BULL_AUTH_KEY=firecrawl_admin_2024

# ===== Recursos do Sistema =====
MAX_CPU=0.8   # Limite de CPU (80%)
MAX_RAM=0.8   # Limite de RAM (80%)

# ===== Logging =====
LOGGING_LEVEL=INFO

# ===== Webhooks (Dev/Test) =====
ALLOW_LOCAL_WEBHOOKS=true
```

#### Passo 2: Build das imagens Docker

```bash
# Build de todos os serviços
docker compose build

# Build sem cache (troubleshooting)
docker compose build --no-cache
```

#### Passo 3: Iniciar serviços

```bash
# Iniciar em background
docker compose up -d

# Verificar status
docker compose ps

# Ver logs
docker compose logs -f
```

#### Passo 4: Verificar saúde dos serviços

```bash
# Health check da API
curl http://localhost:3002/health

# Esperado: {"status":"ok"} ou similar
```

### 3.3 Acessar Dashboard de Filas

URL: `http://localhost:3002/admin/{BULL_AUTH_KEY}/queues`

Exemplo com chave padrão:
`http://localhost:3002/admin/firecrawl_admin_2024/queues`

**Funcionalidades:**
- Monitorar jobs em execução
- Ver jobs completados/falhados
- Retry manual de jobs
- Estatísticas de performance

---

## 4. Endpoints e Funcionalidades

### 4.1 POST /v1/scrape - Scraping Síncrono

Extrai conteúdo de uma única página.

**Request:**
```bash
curl -X POST http://localhost:3002/v1/scrape \
  -H 'Content-Type: application/json' \
  -d '{
    "url": "https://example.com",
    "formats": ["markdown", "html"],
    "onlyMainContent": true,
    "waitFor": 2000,
    "timeout": 30000
  }'
```

**Parâmetros:**
- `url` (obrigatório): URL alvo
- `formats` (opcional): Array de formatos desejados
  - Opções: `markdown`, `html`, `rawHtml`, `links`, `screenshot`
- `onlyMainContent` (opcional): Extrair apenas conteúdo principal (padrão: true)
- `waitFor` (opcional): Tempo de espera após carregamento (ms)
- `timeout` (opcional): Timeout da operação (ms, padrão: 30000)

**Response:**
```json
{
  "success": true,
  "data": {
    "markdown": "# Example Domain\n\nThis domain is...",
    "html": "<html>...</html>",
    "metadata": {
      "title": "Example Domain",
      "description": "Example Domain",
      "url": "https://example.com",
      "statusCode": 200,
      "language": "en"
    }
  }
}
```

### 4.2 POST /v1/crawl - Crawling Assíncrono

Varre um site completo e todas as páginas acessíveis.

**Request:**
```bash
curl -X POST http://localhost:3002/v1/crawl \
  -H 'Content-Type: application/json' \
  -d '{
    "url": "https://example.com",
    "limit": 100,
    "maxDepth": 3,
    "includePaths": ["/blog/*"],
    "excludePaths": ["/admin/*", "*.pdf"],
    "scrapeOptions": {
      "formats": ["markdown"],
      "onlyMainContent": true
    },
    "webhook": {
      "url": "https://myapp.com/webhook",
      "events": ["completed", "failed"]
    }
  }'
```

**Parâmetros:**
- `url` (obrigatório): URL inicial
- `limit` (opcional): Número máximo de páginas (padrão: 10000)
- `maxDepth` (opcional): Profundidade máxima de crawling
- `includePaths` (opcional): Array de padrões regex para incluir
- `excludePaths` (opcional): Array de padrões regex para excluir
- `scrapeOptions` (opcional): Opções de scraping para cada página
- `webhook` (opcional): Configuração de webhook
  - `url`: URL do webhook
  - `events`: Array de eventos (`started`, `page`, `completed`, `failed`)

**Response (imediata):**
```json
{
  "success": true,
  "id": "crawl_abc123",
  "url": "http://localhost:3002/v1/crawl/crawl_abc123"
}
```

### 4.3 GET /v1/crawl/:id - Status do Crawl

Verifica o status de um job de crawling.

**Request:**
```bash
curl http://localhost:3002/v1/crawl/crawl_abc123
```

**Response (em progresso):**
```json
{
  "status": "scraping",
  "total": 15,
  "completed": 8,
  "creditsUsed": 8
}
```

**Response (completo):**
```json
{
  "status": "completed",
  "total": 36,
  "creditsUsed": 36,
  "expiresAt": "2024-12-31T23:59:59.000Z",
  "data": [
    {
      "markdown": "# Page 1\n\nContent...",
      "metadata": {
        "title": "Page 1",
        "url": "https://example.com/page1",
        "statusCode": 200
      }
    },
    {
      "markdown": "# Page 2\n\nContent...",
      "metadata": {
        "title": "Page 2",
        "url": "https://example.com/page2",
        "statusCode": 200
      }
    }
  ]
}
```

### 4.4 DELETE /v1/crawl/:id - Cancelar Crawl

Cancela um job de crawling em execução.

**Request:**
```bash
curl -X DELETE http://localhost:3002/v1/crawl/crawl_abc123
```

**Response:**
```json
{
  "success": true,
  "message": "Crawl job cancelled"
}
```

### 4.5 POST /v1/map - Discovery de URLs

Descobre URLs de um site sem fazer scraping (muito rápido).

**Request:**
```bash
curl -X POST http://localhost:3002/v1/map \
  -H 'Content-Type: application/json' \
  -d '{
    "url": "https://example.com"
  }'
```

**Response:**
```json
{
  "success": true,
  "links": [
    {
      "url": "https://example.com",
      "title": "Example Domain",
      "description": "Example Domain description"
    },
    {
      "url": "https://example.com/about",
      "title": "About",
      "description": "About page"
    }
  ]
}
```

**Map com busca:**
```bash
curl -X POST http://localhost:3002/v1/map \
  -H 'Content-Type: application/json' \
  -d '{
    "url": "https://example.com",
    "search": "documentation"
  }'
```

### 4.6 POST /v1/search - Web Search

**Nota:** Requer configuração de API de busca externa (Serper, SearchAPI ou SearXNG).

**Request:**
```bash
curl -X POST http://localhost:3002/v1/search \
  -H 'Content-Type: application/json' \
  -d '{
    "query": "what is firecrawl?",
    "limit": 5,
    "scrapeOptions": {
      "formats": ["markdown"]
    }
  }'
```

### 4.7 POST /v1/extract - Extração com AI (Beta)

**Nota:** Requer `OPENAI_API_KEY` ou `OLLAMA_BASE_URL` configurado.

**Request:**
```bash
curl -X POST http://localhost:3002/v1/extract \
  -H 'Content-Type: application/json' \
  -d '{
    "urls": ["https://example.com"],
    "prompt": "Extract the company mission and contact info",
    "schema": {
      "type": "object",
      "properties": {
        "mission": {"type": "string"},
        "email": {"type": "string"}
      }
    }
  }'
```

### 4.8 POST /v2/batch/scrape - Batch Scraping

Scrape múltiplas URLs de forma assíncrona.

**Request:**
```bash
curl -X POST http://localhost:3002/v2/batch/scrape \
  -H 'Content-Type: application/json' \
  -d '{
    "urls": [
      "https://example.com/page1",
      "https://example.com/page2"
    ],
    "formats": ["markdown"]
  }'
```

---

## 5. Formatos Suportados

### 5.1 Markdown
- Formato otimizado para LLMs
- Preserva estrutura semântica
- Remove elementos desnecessários (scripts, estilos)

### 5.2 HTML
- HTML limpo e formatado
- Remove scripts e estilos inline
- Mantém estrutura DOM

### 5.3 Raw HTML
- HTML original sem modificações
- Útil para debug

### 5.4 Links
- Extrai todos os links da página
- Retorna array de URLs

### 5.5 Screenshot
- Captura visual da página
- Formato: Base64 encoded PNG
- Útil para páginas com layout importante

### 5.6 JSON (AI Extract)
- Extração estruturada com LLM
- Requer schema ou prompt
- Retorna dados no formato especificado

---

## 6. Webhooks

### 6.1 Configuração

No `.env`:
```env
ALLOW_LOCAL_WEBHOOKS=true  # Para dev/test
```

No request de crawl:
```json
{
  "webhook": {
    "url": "https://myapp.com/webhook",
    "events": ["started", "page", "completed", "failed"]
  }
}
```

### 6.2 Payloads de Webhook

#### Event: `started`
```json
{
  "success": true,
  "id": "crawl-job-123",
  "url": "https://example.com",
  "type": "started"
}
```

#### Event: `page` (cada página scraped)
```json
{
  "success": true,
  "id": "crawl-job-123",
  "type": "page",
  "data": {
    "markdown": "# Page Title\n\nContent...",
    "metadata": {
      "title": "Page Title",
      "url": "https://example.com/page1"
    }
  }
}
```

#### Event: `completed`
```json
{
  "success": true,
  "id": "crawl-job-123",
  "type": "completed",
  "data": [
    {
      "markdown": "...",
      "url": "https://example.com/page1"
    },
    {
      "markdown": "...",
      "url": "https://example.com/page2"
    }
  ]
}
```

#### Event: `failed`
```json
{
  "success": false,
  "id": "crawl-job-123",
  "type": "failed",
  "error": "Error message here"
}
```

### 6.3 Segurança de Webhooks (HMAC)

**Configurar no `.env`:**
```env
SELF_HOSTED_WEBHOOK_HMAC_SECRET=your-secret-key
```

**Validação no receptor:**
```javascript
const crypto = require('crypto');

function validateSignature(payload, signature, secret) {
  const hash = crypto
    .createHmac('sha256', secret)
    .update(JSON.stringify(payload))
    .digest('hex');

  return signature === hash;
}

// No webhook handler
const signature = request.headers['x-webhook-signature'];
const isValid = validateSignature(request.body, signature, process.env.SECRET);
```

---

## 7. Configurações Avançadas

### 7.1 Limites de Recursos

```env
# Limite de CPU (0.0 a 1.0)
MAX_CPU=0.8

# Limite de RAM (0.0 a 1.0)
MAX_RAM=0.8
```

### 7.2 Proxy

```env
PROXY_SERVER=http://proxy.example.com:8080
PROXY_USERNAME=user
PROXY_PASSWORD=pass
```

### 7.3 AI Features

#### OpenAI (Pago)
```env
OPENAI_API_KEY=sk-...
```

#### Ollama (Local, Gratuito)
```env
OLLAMA_BASE_URL=http://ollama:11434/api
MODEL_NAME=deepseek-r1:7b
MODEL_EMBEDDING_NAME=nomic-embed-text
```

#### API OpenAI-compatible
```env
OPENAI_BASE_URL=https://api.groq.com/v1
OPENAI_API_KEY=gsk-...
```

### 7.4 Search API

#### Google direto (padrão)
Não requer configuração.

#### SearXNG (Self-hosted)
```env
SEARXNG_ENDPOINT=http://your.searxng.server
SEARXNG_ENGINES=google,bing
SEARXNG_CATEGORIES=general
```

#### Serper API
```env
SERPER_API_KEY=your-key
```

#### SearchAPI
```env
SEARCHAPI_API_KEY=your-key
```

### 7.5 PDF Parsing (LlamaParse)

```env
LLAMAPARSE_API_KEY=your-key
```

### 7.6 Autenticação e Supabase

Para features avançadas (autenticação, logging avançado):

```env
USE_DB_AUTHENTICATION=true
SUPABASE_ANON_TOKEN=your-token
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_TOKEN=your-service-token
```

### 7.7 Logging e Monitoring

```env
# Log level
LOGGING_LEVEL=DEBUG  # DEBUG, INFO, WARN, ERROR

# Slack notifications
SLACK_WEBHOOK_URL=https://hooks.slack.com/...

# PostHog analytics
POSTHOG_API_KEY=your-key
POSTHOG_HOST=https://app.posthog.com
```

### 7.8 Playwright Service

```env
# Block media para melhor performance
BLOCK_MEDIA=true
```

---

## 8. Monitoramento e Troubleshooting

### 8.1 Verificação de Saúde

#### Health Check
```bash
curl http://localhost:3002/health
```

#### Verificar containers
```bash
# Status de todos os containers
docker compose ps

# Uso de recursos
docker stats

# Específico
docker stats firecrawl-api-1
```

### 8.2 Logs

#### Ver todos os logs
```bash
docker compose logs -f
```

#### Logs de serviço específico
```bash
# API
docker compose logs -f api

# Playwright
docker compose logs -f playwright-service

# Redis
docker compose logs -f redis

# PostgreSQL
docker compose logs -f nuq-postgres
```

#### Últimas N linhas
```bash
docker compose logs --tail=100 api
```

#### Filtrar logs
```bash
# Logs de erro apenas
docker compose logs api | grep ERROR

# Logs de worker
docker compose logs api | grep worker
```

### 8.3 Dashboard de Filas (Bull Board)

**URL:** `http://localhost:3002/admin/{BULL_AUTH_KEY}/queues`

**Métricas disponíveis:**
- Jobs ativos, completados, falhados
- Taxa de processamento
- Tempo médio por job
- Fila de espera

**Ações:**
- Retry jobs falhados
- Limpar jobs antigos
- Pausar/retomar processamento
- Ver detalhes de cada job

### 8.4 Problemas Comuns

#### Problema: Container não inicia

**Sintomas:**
```bash
docker compose ps
# Container em estado "Exit" ou "Restarting"
```

**Diagnóstico:**
```bash
# Ver logs do container
docker compose logs api

# Ver últimas linhas antes do crash
docker compose logs --tail=50 api
```

**Soluções:**
- Verificar variáveis de ambiente no `.env`
- Rebuild sem cache: `docker compose build --no-cache`
- Verificar portas em uso: `netstat -an | grep 3002`

#### Problema: "Connection refused" ao chamar API

**Sintomas:**
```bash
curl http://localhost:3002/health
# curl: (7) Failed to connect to localhost port 3002: Connection refused
```

**Diagnóstico:**
```bash
# Container rodando?
docker ps | grep firecrawl

# Porta exposta corretamente?
docker compose port api 3002

# Verificar logs
docker compose logs --tail=20 api
```

**Soluções:**
- Verificar `PORT` no `.env`
- Reiniciar: `docker compose restart api`
- Rebuild: `docker compose up -d --build`

#### Problema: Scraping muito lento

**Sintomas:**
- Timeout de requisições
- Jobs na fila não progridem

**Diagnóstico:**
```bash
# CPU/RAM usage
docker stats

# Workers rodando?
docker compose logs api | grep "Worker started"
```

**Soluções:**
- Aumentar timeout: `timeout: 60000` nas requisições
- Aumentar recursos do Docker Desktop
- Ajustar `MAX_CPU` e `MAX_RAM` no `.env`
- Desabilitar screenshots se não necessário
- Usar `onlyMainContent: true`

#### Problema: "Out of Memory"

**Sintomas:**
```bash
# Logs mostram:
# Error: JavaScript heap out of memory
```

**Diagnóstico:**
```bash
docker stats
# CONTAINER          MEM USAGE / LIMIT
# firecrawl-api-1    7.8GiB / 8GiB
```

**Soluções:**
- Aumentar memória do Docker (Settings > Resources > Memory)
- Reduzir `limit` em crawls: `"limit": 50`
- Processar em batches menores
- Aumentar `MAX_RAM` no `.env` (se houver RAM disponível)

#### Problema: Redis/PostgreSQL não acessível

**Sintomas:**
```bash
# Logs mostram:
# Error: connect ECONNREFUSED redis:6379
# Error: connect ECONNREFUSED nuq-postgres:5432
```

**Diagnóstico:**
```bash
# Containers de dependências rodando?
docker compose ps redis nuq-postgres

# Rede Docker OK?
docker network ls
docker network inspect firecrawl_backend
```

**Soluções:**
```bash
# Reiniciar dependências
docker compose restart redis nuq-postgres

# Reiniciar tudo
docker compose down
docker compose up -d

# Limpar e recriar (CUIDADO: perde dados)
docker compose down -v
docker compose up -d
```

#### Problema: Webhook não está sendo chamado

**Sintomas:**
- Job completa mas webhook não recebe notificação

**Diagnóstico:**
```bash
# Logs de webhook
docker compose logs api | grep webhook

# Verificar configuração
grep ALLOW_LOCAL_WEBHOOKS .env
```

**Soluções:**
- Verificar `ALLOW_LOCAL_WEBHOOKS=true` no `.env`
- URL do webhook deve ser acessível do container
- Para webhooks locais em dev: usar `host.docker.internal`
- Verificar logs: `docker compose logs -f api`

#### Problema: Playwright timeout

**Sintomas:**
```bash
# Error: Timeout waiting for page load
```

**Diagnóstico:**
```bash
# Playwright service rodando?
docker compose ps playwright-service

# Logs
docker compose logs playwright-service
```

**Soluções:**
- Aumentar `waitFor` e `timeout` na requisição
- Verificar se site tem anti-bot (self-hosted não tem Fire-engine)
- Tentar com `BLOCK_MEDIA=true` no `.env`
- Reiniciar: `docker compose restart playwright-service`

### 8.5 Debug Avançado

#### Acessar shell do container
```bash
# API container
docker compose exec api sh

# Dentro do container
ps aux
ls -la
cat /app/.env
```

#### Verificar conectividade interna
```bash
# Do container da API
docker compose exec api sh

# Testar Redis
nc -zv redis 6379

# Testar PostgreSQL
nc -zv nuq-postgres 5432

# Testar Playwright
curl http://playwright-service:3000
```

#### Verificar rede Docker
```bash
# Inspecionar rede
docker network inspect firecrawl_backend

# Ver IPs dos containers
docker compose exec api cat /etc/hosts
```

---

## 9. Performance e Boas Práticas

### 9.1 Otimização de Scraping

#### Use formato adequado
```javascript
// Mais rápido
{ formats: ["markdown"] }

// Mais lento
{ formats: ["markdown", "html", "screenshot"] }
```

#### Extraia apenas conteúdo principal
```javascript
{
  onlyMainContent: true  // Remove headers, footers, ads
}
```

#### Exclua recursos desnecessários
```javascript
{
  excludePaths: [
    "*.pdf",
    "*.zip",
    "*.mp4",
    "/admin/*",
    "/login"
  ]
}
```

### 9.2 Otimização de Crawling

#### Limite páginas e profundidade
```javascript
{
  limit: 100,        // Máximo de páginas
  maxDepth: 3        // Profundidade máxima
}
```

#### Use includePaths
```javascript
{
  includePaths: ["/blog/*", "/docs/*"]  // Apenas essas seções
}
```

#### Webhooks vs Polling
```javascript
// Melhor: Webhook (push)
{
  webhook: {
    url: "https://myapp.com/webhook",
    events: ["completed"]
  }
}

// Evitar: Polling excessivo
// while (status !== 'completed') {
//   await sleep(1000);  // Muito frequente
// }
```

### 9.3 Otimização de Recursos

#### Playwright Service
```env
# Bloquear mídia para melhor performance
BLOCK_MEDIA=true
```

#### Workers
```bash
# Escalar workers horizontalmente
docker compose up -d --scale api=3
```

#### Redis
- Considere usar Valkey (fork open-source do Redis)
- Configure maxmemory policy se necessário

### 9.4 Benchmarks Esperados

| Operação | Tempo Médio | Observações |
|----------|-------------|-------------|
| Scrape simples | 1-3s | Página estática |
| Scrape com JS | 3-8s | Página dinâmica |
| Crawl (10 páginas) | 30-60s | Depende do site |
| Map (discovery) | 5-15s | Não faz scraping |
| Extract (AI) | 5-20s | Depende do modelo |

---

## 10. Segurança

### 10.1 Checklist para Produção

#### Alterar senhas padrão
```env
# NÃO usar em produção:
BULL_AUTH_KEY=firecrawl_admin_2024

# Usar:
BULL_AUTH_KEY=sua-senha-forte-aleatoria
```

#### Não expor portas desnecessárias

**docker-compose.yaml:**
```yaml
nuq-postgres:
  # Comentar se não precisar acessar externamente
  # ports:
  #   - "5432:5432"
```

#### Habilitar HTTPS

Use reverse proxy (Nginx, Traefik, Caddy):

**Exemplo Nginx:**
```nginx
server {
    listen 443 ssl;
    server_name firecrawl.example.com;

    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    location / {
        proxy_pass http://localhost:3002;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

#### Configurar Firewall

```bash
# Permitir apenas IPs conhecidos
ufw allow from 203.0.113.0/24 to any port 3002
ufw deny 3002
```

#### Rate Limiting

Já configurado via Redis. Para ajustar:

Editar `apps/api/src/services/rate-limiter.ts` (requer rebuild).

#### Validar Webhooks (HMAC)

```env
SELF_HOSTED_WEBHOOK_HMAC_SECRET=your-secret-key
```

### 10.2 Variáveis Sensíveis

**NUNCA commitar:**
- `.env` (já em `.gitignore`)
- API keys (OpenAI, Serper, etc.)
- Senhas de banco
- Tokens de autenticação

**Usar secrets management:**
- Docker Secrets
- Kubernetes Secrets
- HashiCorp Vault
- AWS Secrets Manager

### 10.3 Limitações do Self-Hosted

**Sem Fire-engine:**
- Proteção anti-bot limitada
- Bypass de Cloudflare/Captcha não disponível
- Sites com proteção avançada podem falhar

**Alternativas:**
- Configurar proxy rotativo
- Usar serviços de proxy premium
- Rate limiting manual
- User-agent rotation

---

## 11. Estrutura do Projeto

```
firecrawl-api/
├── apps/
│   ├── api/                          # API principal
│   │   ├── src/
│   │   │   ├── index.ts              # Entry point da API
│   │   │   ├── harness.ts            # Inicializador (API + Workers)
│   │   │   ├── controllers/          # Endpoints REST
│   │   │   ├── services/
│   │   │   │   ├── queue-worker.js   # Worker de jobs
│   │   │   │   ├── rate-limiter.ts   # Rate limiting
│   │   │   │   └── worker/           # Workers específicos
│   │   │   ├── scraper/              # Lógica de scraping
│   │   │   └── __tests__/            # Testes (E2E e unitários)
│   │   ├── Dockerfile
│   │   └── package.json
│   │
│   ├── playwright-service-ts/        # Serviço de browser automation
│   │   ├── src/
│   │   ├── Dockerfile
│   │   └── package.json
│   │
│   ├── nuq-postgres/                 # PostgreSQL customizado
│   │   └── Dockerfile
│   │
│   ├── js-sdk/                       # SDK JavaScript
│   ├── python-sdk/                   # SDK Python
│   └── rust-sdk/                     # SDK Rust
│
├── .env                              # Variáveis de ambiente (NÃO commitar)
├── docker-compose.yaml               # Orquestração Docker
├── SELF_HOST.md                      # Guia oficial self-hosting
├── CONTRIBUTING.md                   # Guia de contribuição
└── LICENSE                           # AGPL-3.0
```

### Diretórios Importantes

| Diretório | Função |
|-----------|--------|
| `apps/api/src/controllers/` | Endpoints REST da API |
| `apps/api/src/services/` | Workers, filas, rate-limiting |
| `apps/api/src/scraper/` | Lógica core de scraping |
| `apps/api/src/__tests__/` | Testes E2E (snips) |
| `apps/playwright-service-ts/` | Serviço de renderização JS |

---

## 12. Comandos Docker Úteis

### 12.1 Gerenciamento de Containers

```bash
# Ver containers em execução
docker compose ps

# Iniciar serviços
docker compose up -d

# Parar serviços
docker compose down

# Parar e remover volumes (PERDE DADOS!)
docker compose down -v

# Restart de serviço específico
docker compose restart api

# Restart de todos
docker compose restart

# Ver logs
docker compose logs -f

# Logs de serviço específico
docker compose logs -f api

# Últimas 100 linhas
docker compose logs --tail=100 api
```

### 12.2 Manutenção

```bash
# Rebuild de imagens
docker compose build

# Rebuild sem cache
docker compose build --no-cache

# Atualizar e reiniciar
docker compose up -d --build

# Limpar imagens antigas (liberar espaço)
docker system prune -a

# Limpar volumes não usados
docker volume prune
```

### 12.3 Debug

```bash
# Acessar shell do container
docker compose exec api sh

# Ver uso de recursos
docker stats

# Inspecionar container
docker inspect firecrawl-api-1

# Inspecionar rede
docker network inspect firecrawl_backend

# Ver logs do Docker daemon
journalctl -u docker.service
```

### 12.4 Backup e Restore

#### Backup do PostgreSQL
```bash
# Backup
docker compose exec nuq-postgres pg_dump -U postgres postgres > backup.sql

# Restore
docker compose exec -T nuq-postgres psql -U postgres postgres < backup.sql
```

#### Backup do Redis
```bash
# Redis persiste automaticamente em /data
# Copiar do container
docker compose cp redis:/data/dump.rdb ./redis-backup.rdb

# Restore
docker compose cp ./redis-backup.rdb redis:/data/dump.rdb
docker compose restart redis
```

---

## 13. Testes

### 13.1 Executar Testes

**Nota:** Use `pnpm harness` para subir ambiente de teste.

```bash
# Entrar no diretório da API
cd apps/api

# Instalar dependências
pnpm install

# Rodar test suite completo (lento)
pnpm harness jest

# Rodar apenas testes específicos
pnpm harness jest src/__tests__/snips/v1/scrape.test.ts

# Rodar testes que não requerem auth
pnpm test:local-no-auth

# Rodar snips (E2E)
pnpm test:snips
```

### 13.2 Variáveis de Ambiente para Testes

```env
# Pular testes que requerem Fire-engine
TEST_SUITE_SELF_HOSTED=true

# Testes que requerem AI
OPENAI_API_KEY=sk-...
# ou
OLLAMA_BASE_URL=http://localhost:11434/api
```

### 13.3 Escrevendo Testes

Conforme CLAUDE.md:
- Preferir E2E (snips) sobre testes unitários
- 1 happy path + 1+ failure paths
- Usar `scrapeTimeout` de `./lib`
- Gating adequado para features específicas

---

## 14. Atualização e Manutenção

### 14.1 Atualizar Firecrawl

```bash
# Parar serviços
docker compose down

# Atualizar código (se for fork/clone)
git pull origin main

# Rebuild imagens
docker compose build

# Reiniciar
docker compose up -d

# Verificar logs
docker compose logs -f
```

### 14.2 Usar Imagem Pré-built (GitHub Container Registry)

**docker-compose.yaml:**
```yaml
# Descomentar:
image: ghcr.io/firecrawl/firecrawl

# Comentar:
# build: apps/api
```

```bash
# Pull da imagem
docker compose pull

# Reiniciar
docker compose up -d
```

### 14.3 Rollback

```bash
# Se algo deu errado, voltar para commit anterior
git log --oneline
git checkout <commit-hash>

# Rebuild
docker compose build

# Reiniciar
docker compose up -d
```

---

## 15. Diferenças: Self-Hosted vs Cloud

| Feature | Self-Hosted | Cloud |
|---------|-------------|-------|
| **Scraping básico** | ✅ | ✅ |
| **Crawling** | ✅ | ✅ |
| **Map/Discovery** | ✅ | ✅ |
| **Formatos (MD, HTML)** | ✅ | ✅ |
| **Screenshot** | ✅ | ✅ |
| **AI Extract** | ✅ (requer OpenAI/Ollama) | ✅ |
| **Search API** | ✅ (requer config) | ✅ |
| **Batch Scraping** | ✅ | ✅ |
| **Fire-engine** | ❌ | ✅ |
| **Anti-bot avançado** | ❌ | ✅ |
| **Cloudflare bypass** | ❌ | ✅ |
| **IP rotation** | ❌ (manual) | ✅ |
| **Actions (click, scroll)** | ❌ | ✅ |
| **Managed infra** | ❌ (você gerencia) | ✅ |
| **Custo** | VPS (~$50/mês) | $15-500+/mês |

---

## 16. Recursos e Links

### 16.1 Documentação Oficial

- **Site:** https://firecrawl.dev
- **Docs:** https://docs.firecrawl.dev
- **API Reference:** https://docs.firecrawl.dev/api-reference/introduction
- **GitHub:** https://github.com/firecrawl/firecrawl

### 16.2 SDKs

- **Python:** https://docs.firecrawl.dev/sdks/python
- **Node.js:** https://docs.firecrawl.dev/sdks/node
- **Go:** https://docs.firecrawl.dev/sdks/go
- **Rust:** https://docs.firecrawl.dev/sdks/rust

### 16.3 Comunidade

- **Discord:** https://discord.com/invite/gSmWdAkdwd
- **Twitter/X:** https://twitter.com/firecrawl_dev
- **LinkedIn:** https://www.linkedin.com/company/104100957

### 16.4 Suporte

- **GitHub Issues:** https://github.com/firecrawl/firecrawl/issues
- **Discussions:** https://github.com/firecrawl/firecrawl/discussions

---

## 17. Licença

**Firecrawl:** AGPL-3.0

**Exceções:**
- SDKs: MIT License
- Alguns componentes de UI: MIT License

Consulte os arquivos `LICENSE` específicos nos diretórios para detalhes.

---

## 18. FAQ - Manutenção

### Q: Posso usar Valkey ao invés de Redis?
**A:** Sim, mas não testado oficialmente. Descomente a linha no `docker-compose.yaml`:
```yaml
# image: valkey/valkey:alpine
```

### Q: Como aumentar o número de workers?
**A:** Escalar horizontalmente:
```bash
docker compose up -d --scale api=3
```

### Q: Como configurar um proxy rotativo?
**A:** Use serviços como BrightData, Smartproxy, etc. Configure no `.env`:
```env
PROXY_SERVER=http://proxy.brightdata.com:22225
PROXY_USERNAME=customer-user
PROXY_PASSWORD=pass
```

### Q: É possível usar sem Docker?
**A:** Sim, mas não recomendado. Requer:
- Node.js 18+
- Redis rodando
- PostgreSQL rodando
- Playwright instalado
- Configurar variáveis de ambiente manualmente

### Q: Como migrar dados para outro servidor?
**A:**
1. Backup PostgreSQL e Redis (veja seção 12.4)
2. Copiar `.env` e `docker-compose.yaml`
3. No novo servidor: restore backups
4. `docker compose up -d`

### Q: O que fazer se jobs ficarem travados?
**A:**
1. Acessar Bull Board: `http://localhost:3002/admin/{BULL_AUTH_KEY}/queues`
2. Verificar jobs em "Active" ou "Failed"
3. Retry manual ou limpar fila
4. Se persistir: `docker compose restart redis`

### Q: Como ver métricas de performance?
**A:**
- Bull Board: jobs/s, tempo médio
- `docker stats`: CPU, RAM
- Logs: `docker compose logs -f api | grep "took"`

### Q: Posso usar bancos externos (não Docker)?
**A:** Sim. Configure no `.env`:
```env
REDIS_URL=redis://external-redis.com:6379
NUQ_DATABASE_URL=postgres://user:pass@external-pg.com:5432/dbname
```

E comente os serviços no `docker-compose.yaml`.

---

**Documento consolidado para manutenção e operação da API Firecrawl.**
**Última atualização:** 2025-11-10
