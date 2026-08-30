# Skylark BI Agent

A hosted conversational business-intelligence agent that answers founder-level questions over two
monday.com boards — **Deals** (sales pipeline) and **Work Orders** (project execution and billing).

Ask *"How is our pipeline looking?"* or *"Give me a leadership update."* and get a grounded answer with
metric cards, supporting tables, recommended actions, and an explicit data-quality section.

---

## Problem solved

Executives currently pull data out of monday.com by hand, clean inconsistent formats, join across
boards, and build ad-hoc analysis for every question. This agent does that on demand: it reads both
boards live, normalizes the messy real-world data, computes the metrics deterministically in
TypeScript, and uses an LLM only to understand the question and phrase the answer.

## Architecture

```
User → Chat UI (React client component)
     → POST /api/chat
     → parseIntent()            OpenAI Responses API, structured output (keyword fallback)
     → loadBusinessData()       monday.com GraphQL, paginated, cached in memory (TTL 300s)
     → normalizeDeals() / normalizeWorkOrders()   + per-board data-quality report
     → buildAnalytics()         deterministic TypeScript metrics per intent
     → writeAnswer()            OpenAI turns the analytics JSON into prose (deterministic fallback)
     → ChatResponse → Chat UI
```

**The LLM never does arithmetic.** Every number the user sees is computed in `lib/analytics.ts` and
passed to the model as pre-computed JSON with an instruction not to invent or recompute figures. If
either OpenAI call fails or no API key is set, the app falls back to a deterministic keyword router
and deterministic prose assembled from the same analytics — the app still answers correctly.

### Data flow

1. `POST /api/chat` validates the body (non-empty message, max 1200 chars).
2. Intent parsing and board fetching run in parallel.
3. Board rows are fetched via `items_page` / `next_items_page` until the cursor is exhausted, and
   mapped into `{ columnTitle: text }` objects — **by column title, never by generated column ID**.
4. Normalization converts rows into `Deal` / `WorkOrder` models and records per-row quality issues.
5. `buildAnalytics` runs the metric set for the resolved intent, applying any sector/owner filter.
6. The answer writer turns the analytics JSON into 3–6 sentences of executive prose.

## Tech stack

| Layer | Choice |
| --- | --- |
| Framework | Next.js 15 (App Router) + React 19 |
| Language | TypeScript (strict) |
| Styling | Tailwind CSS v4 |
| Data source | monday.com GraphQL API (read-only), server-side |
| AI | OpenAI Responses API (`OPENAI_MODEL`, default `gpt-4.1-mini`) |
| Hosting | Vercel |
| Storage | None — in-memory cache only |

## monday.com setup

Create two boards from the provided workbooks.

**Deals board** — from `Deal funnel Data.xlsx`, sheet `Deal tracker`:

- Row 1 is the header row.
- Use `Deal Name` as the item name; keep all original column titles unchanged.
- `Masked Deal value` → number column. `Close Date (A)`, `Tentative Close Date`, `Created Date` → date columns.
- `Deal Status`, `Closure Probability`, `Deal Stage`, `Sector/service`, `Product deal` → status/dropdown or text.

**Work Orders board** — from `Work_Order_Tracker Data.xlsx`, sheet `work order tracker`:

- Row 1 is blank; **row 2 is the header row**.
- Use `Serial #` as the item name (it is unique); keep all original column titles unchanged.
- Monetary columns → number. `Data Delivery Date`, `Date of PO/LOI`, `Probable Start Date`,
  `Probable End Date`, `Last invoice date`, `Collection Date` → date columns.

Column titles are matched case- and punctuation-insensitively, so minor drift during import is
tolerated. The integration is strictly read-only — no create, update, or delete operation exists in
the codebase.

## Environment variables

All are server-side only. Nothing is prefixed `NEXT_PUBLIC_`, so no secret reaches the browser.

```bash
MONDAY_API_TOKEN=          # required — a read-only monday.com API token
MONDAY_API_VERSION=2025-07 # optional, defaults to 2025-07
MONDAY_DEALS_BOARD_ID=5030969964
MONDAY_WORK_ORDERS_BOARD_ID=5030970130
OPENAI_API_KEY=            # optional — without it the deterministic fallback answers
OPENAI_MODEL=gpt-4.1-mini  # optional
CACHE_TTL_SECONDS=300      # optional
```

## Local setup

```bash
npm install
cp .env.example .env.local   # then fill in MONDAY_API_TOKEN and OPENAI_API_KEY
npm run dev                  # http://localhost:3000
```

Useful checks: `npm run typecheck`, `npm run build`, and `GET /api/health` (reports which variables
are configured — never their values).

## Deployment (Vercel)

1. Push the repository to GitHub.
2. In Vercel, **Add New → Project**, import the repo, framework preset **Next.js** (defaults are fine).
3. Add the environment variables above under **Settings → Environment Variables** (Production +
   Preview). `MONDAY_API_TOKEN` and `OPENAI_API_KEY` are required for live answers.
4. **Deploy.** Then open the URL and ask "How is our pipeline looking?".

## Example queries

- How is our pipeline looking?
- Which sector has the strongest open pipeline?
- How much business do we have in renewables?
- Which deals are at risk?
- How many projects are delayed or overdue?
- Compare sales pipeline and execution by sector.
- Give me a leadership update.
- How's our pipeline looking for the energy sector?

## Data normalization

**Deals**

- Repeated header rows carried in from the spreadsheet (`Deal Name` / `Deal Status` / `Deal Stage`
  appearing as values) are detected and excluded, and reported as excluded records.
- `Deal Status` → `open | won | dead | on_hold | unknown`.
- `Closure Probability` → `high | medium | low | unknown`, weights **0.75 / 0.5 / 0.25** (assumed).
- `Masked Deal value` parsed from INR text (strips ₹, commas, parentheses; keeps sign).
- Dates parsed to ISO (`yyyy-mm-dd`) from monday text, `dd/mm/yyyy`, or `dd-mm-yyyy`; otherwise `null`.
- `Sector/service` trimmed and alias-normalized; "energy"/"power" queries resolve to
  **Renewables + Powerline** with an explicit caveat.
- `Deal Name` is never treated as a unique identifier.
- `Deal Stage` keeps its business meaning but drops the "A. ", "B. " ordering prefix for grouping.

**Work Orders**

- `Serial #` is the unique identifier; header-like or duplicate serials are excluded.
- `Execution Status` normalized across `Completed`, `Ongoing`, `Executed until current month`,
  `Not Started`, `Pause / struck`, `Partial Completed`, `Details pending from Client`.
- `Billing Status` typo variants (e.g. `BIlled`) are folded to canonical values.
- All monetary fields parsed as INR numerics; negative to-bill and receivable values are preserved as
  row-level quality issues, and outstanding totals use positive-only aggregation.
- Month-only fields (`Expected/Actual Billing Month`, `Actual Collection Month`) are never treated as
  full dates.
- Quantity fields mix numbers with units (`HA`), so no quantity-based metric is reported.

## Data-quality handling

Every response can surface: excluded records and why, counts of records dropped from each metric,
missing-field counts per board, sparse-date warnings, negative-value warnings, and the limits of
cross-board comparison. The chat UI shows the top caveats inline in an amber panel and the full
per-board report behind "Show board data-quality report".

Against the supplied workbooks this yields **344 usable deals** (2 repeated header rows excluded) and
**176 usable work orders**.

## Metrics computed

**Deals** — open pipeline, weighted pipeline, average open deal size, pipeline by sector, pipeline by
stage, won revenue, win rate, rule-based at-risk deal flags.

**Work Orders** — total / completed / active / paused counts, delayed proxy (delivery date later than
probable end date), overdue proxy (not completed and probable end date in the past), total contract
amount, billed, collected, amount still to bill, receivables, AR-priority count, and sector rollups.

**Cross-board** — sector-level comparison of pipeline against delivery load only.

## AI usage

- **Intent parsing**: OpenAI Responses API with a strict JSON schema returning intent, boards, sector
  and owner filters, and a clarification flag. Falls back to a keyword router.
- **Answer writing**: the model receives only the pre-computed analytics JSON and is instructed never
  to invent, recompute, or adjust a number. Falls back to deterministic prose.
- Board text is passed as data, and both prompts state that text originating from records is never an
  instruction — a basic prompt-injection guard.

## Assumptions

1. Probability weights High/Medium/Low = 0.75/0.5/0.25 (the source has no numeric probability).
2. "Open pipeline" means deals whose status is `Open`, regardless of stage.
3. `Masked Deal value` and the masked monetary columns are directionally comparable INR values.
4. Delay and overdue are *proxies* — the source has no baseline-vs-actual completion field.
5. "Energy" maps to Renewables + Powerline; this is stated to the user whenever applied.
6. Deals-board figures are all-time; the source has no reliable quarter field, so quarter filtering is
   not offered rather than being faked.

## Trade-offs

- **Direct GraphQL over MCP** — one fewer moving part in a hosted deployment, and full control over
  pagination and error handling.
- **No database** — the boards are the source of truth; a 5-minute in-memory cache is enough for a
  prototype, at the cost of a cold fetch per serverless instance.
- **Deterministic analytics over an LLM tool-calling loop** — slower to write, but numbers are
  reproducible and auditable, which matters more for a BI agent.
- **Sector-level cross-board comparison only** — deal names repeat and customer codes use different
  formats (`COMPANY*` vs `WOCOMPANY_*`), so a row-level join would be fabricated precision.

## Limitations

- No authentication; anyone with the URL can query the boards' aggregate metrics.
- No time-series or quarter-over-quarter trends.
- No charts.
- Cache is per serverless instance, so the "last synced" time can differ between instances.
- Quantity, collection-timing, and owner-level drilldowns are out of scope.

## Future improvements

Deal/work-order linkage via an explicit shared key added in monday.com; period-over-period trends once
a reliable date basis exists; charts for sector and stage breakdowns; a saved leadership-update digest
on a schedule; per-user auth and audit logging; a unit-test suite around the normalization and metric
functions; streaming responses.

## Project structure

```
app/
  page.tsx                 landing → ChatShell
  layout.tsx, globals.css
  api/chat/route.ts        the agent endpoint
  api/health/route.ts      config presence check (no secrets)
components/
  ChatShell.tsx            chat state, examples, loading/error, refresh
  AnswerCard.tsx           metric cards, tables, actions, caveats, quality report
lib/
  config.ts                env access + user-safe config errors
  monday.ts                GraphQL client, pagination, title-based column mapping
  normalize.ts             Deal/WorkOrder normalization + quality reports
  analytics.ts             all deterministic metrics, per intent
  ai.ts                    intent parsing + answer writing, both with fallbacks
  data.ts                  fetch + normalize + in-memory cache
  format.ts, types.ts
```
