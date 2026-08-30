# Decision Log — Skylark BI Agent

## 1. Architecture

One deployable Next.js App Router application: a React chat UI, a single `POST /api/chat` agent
endpoint, and server-side modules for monday.com access, normalization, deterministic analytics, and
LLM interaction. No database, queue, or separate service.

**Why:** the assignment is a 6-hour take-home whose deliverable is a hosted, testable prototype. One
app that a reviewer can deploy with four environment variables removes every operational failure mode
that isn't the actual problem being assessed. All state that matters lives in monday.com.

## 2. Stack

Next.js 15 + TypeScript + Tailwind on Vercel. Next.js gives colocated UI and server routes so API keys
never cross to the client; TypeScript makes the normalization and metric layer legible and safe to
change under time pressure; Vercel is a one-click deploy for this framework. Tailwind keeps the UI
polished without a component library.

## 3. monday.com: direct GraphQL API, not MCP

Chose the REST/GraphQL API called server-side over the monday MCP server.

**Why:** MCP adds a runtime dependency and an auth surface that has to survive a serverless cold start
for no functional gain here. Direct GraphQL gives explicit control over `items_page` /
`next_items_page` pagination, retry, and error mapping. Columns are mapped **by column title**, not by
generated column ID, so a reviewer who re-imports the workbooks gets a working app without editing
code. The token is only ever used for read queries; no mutation exists anywhere in the codebase.

## 4. Deterministic analytics, LLM only at the edges

Every number is computed in `lib/analytics.ts`. The LLM does two narrow jobs: classify the question
into one of eight intents (strict JSON schema) and turn the resulting analytics JSON into prose, under
an explicit instruction never to invent or recompute a figure.

**Why:** a BI agent that hallucinates a pipeline number is worse than no agent. This also makes the
system testable — the metric layer runs and can be verified without any API key. Both LLM calls have
deterministic fallbacks (a keyword intent router and prose assembled directly from the analytics), so
the app degrades to a still-correct answer rather than an error if OpenAI is unavailable.

## 5. Normalization

Normalization is explicit and reported, never silent. Deals: repeated spreadsheet header rows are
detected and excluded (2 rows; 344 usable of 346); status and closure probability are mapped to
canonical values with assumed weights High/Medium/Low = 0.75/0.5/0.25; INR values parse from text;
dates parse to ISO or `null`; sector aliases resolve, with "energy" expanding to Renewables +
Powerline and saying so. Work Orders: `Serial #` is the unique key (176 usable); execution statuses
and `Billing Status` typo variants (`BIlled`) fold to canonical values; month-only fields are never
treated as dates; negative to-bill and receivable values are kept as row-level quality issues while
outstanding totals use positive-only aggregation; quantity fields mix units (`HA`) so no
quantity-based metric is reported.

**Key assumption:** the masked monetary columns are directionally comparable INR figures. Delay and
overdue are stated as *proxies* — the source has no baseline-vs-actual completion field, so delay
means "delivered after the probable end date" and overdue means "not completed and past the probable
end date". Records missing either date are excluded and counted.

## 6. Cross-board comparison is sector-level only

Deal names repeat, and customer codes use different formats on the two boards (`COMPANY*` on Deals vs
`WOCOMPANY_*` on Work Orders). Any row-level deal→work-order join would be invented precision, so the
agent compares the boards by normalized sector and says explicitly that this is directional, not a
conversion funnel.

## 7. "Leadership update" interpretation

Interpreted as a **conversational executive briefing**, not a report-generation or export product.
Asking for a leadership update returns one compact briefing built entirely from deterministic metrics:
a headline, a key-metric block (open and weighted pipeline, won revenue, win rate, work-order counts,
billing coverage, receivables), a positive highlight, a major risk, an operational concern,
recommended actions, and the data caveats that qualify all of it. A founder can read it aloud or paste
it into a board email. No PDF/slide export, no scheduling, no storage — those would be a reporting
system, which the assignment did not ask for.

## 8. Data-quality transparency as a feature

Rather than cleaning problems away quietly, the agent surfaces them: excluded records and reasons,
per-metric exclusion counts, missing-field counts per board, sparse-date and negative-value warnings,
and the cross-board caveat. The UI shows the relevant caveats inline and the full per-board report on
demand. This was treated as a scored feature of the assignment, not a nicety.

## 9. Omitted features and why

| Omitted | Why |
| --- | --- |
| Database / Redis / vector DB / RAG | monday.com is the source of truth; a 5-min in-memory cache is sufficient for a prototype. |
| Authentication | Not required by the brief; adding it would cost demo time and block the reviewer. |
| Charts and a full dashboard | The brief asks for a conversational agent; metric cards and small tables carry the same information at a fraction of the build cost. |
| Row-level board joins | The data cannot support them honestly (see §6). |
| Quarter/period filtering | The Deals board has no reliable period basis; a fake quarter filter is worse than an honest all-time figure. |
| Quantity metrics | Mixed units in the source. |
| Automated test suite | Verification was done by running the full normalization + analytics pipeline against fixtures derived from the supplied workbooks; a unit suite is the first thing I would add next. |

## 10. AI tools used

Claude (Anthropic) was used as the implementation assistant for scaffolding, normalization rules, and
documentation drafting; all business rules, assumptions, and metric definitions were reviewed against
the actual workbook contents. OpenAI's Responses API is the runtime model provider inside the product
itself.

## 11. What I would do differently with more time

Add an explicit linkage key between Deals and Work Orders in monday.com so the funnel can be measured
end to end; build period-over-period trends once a trustworthy date basis exists; add a unit-test suite
around parsing and metric functions; stream the answer for better perceived latency; add charts for
sector and stage breakdowns; add per-user auth with query audit logging; and replace the single-shot
intent classifier with a small tool-calling planner so multi-part questions ("pipeline in mining *and*
overdue projects there") can be answered in one turn.
