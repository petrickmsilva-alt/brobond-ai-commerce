# PR002 — Trend Hunter AI

Primeiro módulo de **Inteligência Comercial**: armazena, classifica e prioriza tendências de produtos por tenant. Todo o sistema funciona com **dados mock** — **NÃO** implementa TikTok API, scraping, OpenAI, Selenium, Playwright ou Puppeteer. A arquitetura está preparada para receber as fontes reais em PRs futuros.

## Arquitetura criada

```
modules/trends/
├── hunter/
│   ├── collector.ts     # TrendCollector (interface) + MockTrendCollector — 30 tendências mock/dia
│   ├── scorer.ts        # Score Engine (puro) — normaliza 0–100 e pondera os pesos
│   └── scheduler.ts     # SchedulerJob (interface) + job collect-daily-trends — manual, SEM cron
├── repositories/
│   └── trend.repository.ts   # createSnapshot · listSnapshots · topTrends · findKeywords
├── dto/
│   └── create-trend.dto.ts   # CreateTrendDTO + shapes serializáveis (RSC)
├── validators/
│   └── trend.validator.ts    # Zod (signal/snapshot/list query) + slug de keyword
└── interfaces/
    └── trend.interface.ts    # TrendSignal · TrendCollector · TREND_CATEGORIES
```

## Novos modelos Prisma

- **TrendSnapshot** — `id · organizationId · createdAt · updatedAt · keyword · category · views · likes · shares · trendScore`
- **TrendKeyword** — `id · organizationId · createdAt · updatedAt · keyword · frequency` (único por tenant)
- **TrendCategory** — `id · organizationId · createdAt · updatedAt · name · score` (único por tenant)
- Todos com `organizationId` **obrigatório** (NOT NULL + FK `ON DELETE CASCADE`) — nenhum registro existe sem tenant.

## Score Engine

`calculateTrendScore({ views, likes, shares, margin, saturation })`:

| Componente      | Peso | Normalização                            |
| --------------- | ---: | --------------------------------------- |
| Views           |  30% | linear vs teto de 1.200.000 (clamp 100) |
| Likes           |  20% | linear vs teto de 250.000 (clamp 100)   |
| Shares          |  15% | linear vs teto de 35.000 (clamp 100)    |
| Margin          |  20% | percentual, clamp 0–100                 |
| Low Saturation  |  15% | `100 − saturation`                      |

Retorna **inteiro 0–100**. Entradas malformadas (NaN/Infinity/negativos/fracionários) lançam `RangeError` — nunca são pontuadas silenciosamente. O score é **sempre calculado no servidor**.

## Dashboard (`/dashboard/trends`)

- **KPI cards**: Maior Score · Keywords · Categorias · Última Coleta.
- **Tabela**: Keyword · Categoria · Views · Likes · Score — com **busca**, **filtro por categoria**, **ordenação** por coluna e **paginação** (URL-state). Responsivo.
- **Executar coleta** (ADMIN) dispara o job manual do scheduler; **Nova tendência** (ADMIN) cria um snapshot manual com score computado no servidor.

## RBAC

| Ação            | ADMIN | MANAGER | MEMBER            |
| --------------- | ----- | ------- | ----------------- |
| Executar coleta | ✅    | ❌      | ❌                 |
| Criar snapshot  | ✅    | ❌      | ❌                 |
| Visualizar      | ✅    | ✅      | ✅ (somente leitura) |

Re-afirmado em cada server action (`requireAdmin()`); `organizationId` sempre vem da sessão, nunca do cliente.

## Repository — isolamento de tenant

Toda query recebe `organizationId` como **primeiro argumento** e é construída via `tenantWhere`/`scopedWhere` (o escopo é aplicado por último — filtros do caller nunca alargam a fronteira). Nenhuma consulta roda sem tenant: tenant vazio lança `AuthorizationError` **antes** de qualquer chamada ao banco (coberto por testes).

## Testes

**+126 testes (240 no total** — mínimo exigido: 130):

- Score Engine — pesos, normalização, clamps, arredondamento, guards
- Repository — fake Prisma in-memory: tenant sempre injetado, tenant vazio nunca toca o banco, invisibilidade cross-tenant, filtros/ordenação/paginação
- Slug de keyword — acentos, colapso de espaços, fallback, limite de tamanho
- Tenant isolation, Collector (30 sinais únicos, 5 categorias, scores 60–98), Scheduler (fluxo completo + falhas), RBAC, DTOs

## Migration

`20260922230000_trend_hunter_ai` — cria as 3 tabelas com FKs de tenant (`CASCADE`), unicidade tenant-scoped (`organizationId+keyword` / `organizationId+name`) e índices de dashboard (`organizationId+trendScore|category|createdAt`).

## Seed

30 tendências inseridas via o pipeline real (mock collector → score engine) nas categorias **Moda · Casual · Street · Executivo · Fitness** (inclui "camisa masculina", "jaqueta premium", "bermuda cargo", "camiseta oversized", "polo slim"), com **scores entre 60 e 98**, frequência de keywords e score médio por categoria. Idempotente — não apaga coletas reais.

## PROJECT_STATE atualizado

Current PR → **PR002**; adicionados Trend Hunter, Score Engine, Scheduler e Dashboard Trends (snapshot, data model, migrations, rotas, RBAC, testes, changelog, roadmap).

## Verificação

`npm ci` · `npx prisma validate` · `npx prisma generate` · `npm run lint` · `npm run typecheck` · `npm test` (240 ✓) · `npm run build` · `npm run format:check` — **todos verdes**.

## Próximo PR

**PR003 — Creators & TikTok Link**: conectar creators à API real do TikTok e plugar a primeira fonte real no `TrendCollector` (o contrato `collectDailyTrends()` já está definido e testado — zero mudanças nos consumidores).
