
# CLAUDE.md

Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

## 5. Dependency Tracking

**AI tools routinely miss the cascading web of dependencies around a change. Trace it before editing, not after.**

Before any non-trivial modification, state three things:

- **Current State** — the exact logic/shape today.
- **Future State** — what it becomes.
- **Output Shift** — what downstream consumers see differently: response shape, DB writes, permission results, rendered UI.

Then find who depends on it. Grep every caller of the function/route/field you're touching before you edit it — a change with no listed callers usually means you haven't looked yet.

Applies especially to:
- **API response shapes** — every route returns the `lib/api-response.ts` envelope; changing `data` breaks callers in `lib/api-client.ts` and the components below them.
- **`prisma/schema.prisma`** — a field change ripples into routes, Zod schemas in `lib/validation.ts`, CSV import/export columns, and requires a migration (see `docs/database-migrations.md`).
- **`lib/permissions.ts`** — adding or renaming a permission string affects `ROLE_PERMISSIONS`, every `requirePermission()` call site, and `PermissionGate` in the UI.
- **`lib/lead-creation.ts`** — the shared path for all ingestion channels; a change here hits all five (IndiaMart, TradeIndia, Email, WhatsApp, JustDial) at once.
- **`lib/lead-stages.ts`** — stage names are referenced by SOP checklists, SLA rules, dashboards, and analytics.

Fix at the shared choke point, not per-caller. One guard in the common function beats a guard in each of five callers — and patching only the path in the ticket leaves the siblings broken.

## 6. Loading States & Async UI

**Skeleton loaders, never spinners. One skeleton container per async boundary.**

- **Text Strings**: Never use "Loading...", "Saving…", "Creating…" text toggles. Replace with layout-shaped skeleton loaders.
- **Buttons**: During submission, keep original action text ("Create lead", "Save changes"). Apply `disabled opacity-60 disabled:cursor-not-allowed` muted state. Wrap async handlers in `try...catch...finally` to prevent perpetually muted buttons on errors.
- **Accessibility**: Top-level async boundary (modal, drawer, page) gets `role="status" aria-live="polite" aria-busy="true"`. Child skeleton components stay presentational (no role attributes). Single `<span className="sr-only">Loading...</span>` per container.
- **Containers**: Use `<Skeleton />` from `components/ui/skeleton.tsx`. Compose with `FormFieldSkeleton`, `DrawerHeaderSkeleton`, `ModalContentSkeleton`, `PageSkeleton` from `components/ui/skeleton-variants.tsx`. Skeleton dimensions must exactly match real content (no Cumulative Layout Shift).
- **Tables**: Render skeleton rows matching `pageSize` (not single row). Show skeletons ONLY for user-initiated fetches (e.g., `isPending`), not background revalidation.
- **Client Components**: Client-side tab/view transitions wrap content in `<Suspense fallback={<TabSkeleton/>}>`. Server-side navigations use Next.js `app/*/loading.tsx` files.
- **Modals**: Mount `<DialogContent>` shell immediately on open. Render skeleton inside body. Avoid duplicate `<DialogTitle>` components (unmount skeleton title when data mounts).
- **ESLint**: Blocks `Loader2` imports and `animate-spin` class (including `cn({ 'animate-spin': flag })` conditional syntax).

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.
