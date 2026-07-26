# MTPL OS — Engineering & Product Design Principles

> **Identity**: MTPL OS is an Executive Control Plane & Business Operating System for industrial steel manufacturing and trading. It is NOT a generic CRM or dense ERP dashboard.

---

## 1. Product & Design Philosophy (Apple HIG + Linear + Stripe)

* **Design Focus over Visual Clutter**: Prefer whitespace, typography, and clear visual hierarchy over dense grids of widgets. If a metric doesn't empower a decision within 5 seconds, do not put it on the primary view.
* **Semantic Color Usage**: Use color ONLY when it conveys operational meaning (🟢 Green = Healthy / On Target | 🟡 Orange = Warning / SLA Risk | 🔴 Red = Critical / Exception). Never use arbitrary accent colors.
* **Layered Information Depth**:
  * **Layer 1 (Executive View)**: Top 10–15 business health metrics, active exceptions ("Today's Attention"), and AI summary.
  * **Layer 2 (Department View)**: Dedicated command centers (Sales, Lead Gen, Purchase, Operations, Inventory, Accounts).
  * **Layer 3 (Deep Dive)**: Granular tables, filters, SLA history, audit logs, and analytics.
* **Apple Motion Physics**: All UI transitions must use spring physics (`cubic-bezier(0.16, 1, 0.3, 1)` over 300–400ms) with GPU-accelerated rendering. Zero harsh layout pops or lag.

---

## 2. Architecture & Data Principles

* **Reuse-First Discipline**: Before building any new component, API route, or database model, trace existing dependencies. Never duplicate existing models or routes.
* **Live Calculation over Delayed Snapshots**: Business health scores, SLA tracking, and priority alerts must be computed live from primary CRM/ERP tables (`Lead`, `Activity`, `Customer`, `Supplier`) with brief edge-caching — do NOT rely on midnight crons for real-time dashboards.
* **Additive Database Migrations**: Never drop live production tables. Always introspect and extend existing models using scalar mappings or additive migrations.
* **Traceable Metrics**: Every percentage, KPI, or Business Health score must have a documented, deterministic formula in `lib/mtpl-os/`. No hardcoded or fabricated numbers.

---

## 3. Definition of "Done"

A feature is considered **Done** only when:
1. **Type Safety**: Passes `npm run type-check` with zero errors.
2. **Linting & Formatting**: Passes `npm run lint` with zero warnings/errors.
3. **Unit Test Coverage**: Non-trivial business logic (scoring, sorting, branching) has accompanying unit tests passing in Jest (`npm test`).
4. **States Covered**: Components handle Loading, Empty, Success, Warning, Error, and Responsive states.
