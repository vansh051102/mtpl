# MTPL OS Design System

Source of truth for every component under `components/dashboards/`.

## Color
Monochrome canvas, semantic accents only — never decorative color.
- Canvas: `#F5F5F7` (`bg-canvas`)
- Card: existing `bg-card` (white / theme-aware)
- Border: existing `border-border` (`#E8E8ED` light)
- Text: existing `text-foreground` / `text-muted-foreground`
- Healthy: `apple-green` `#30D158`
- Warning: `apple-orange` `#FF9F0A`
- Critical: `apple-red` `#FF453A`
- Interactive/secondary: `apple-blue` `#0A84FF`

## Materials
Glass (top nav, command palette, floating drawers only): `backdrop-blur-md bg-white/75 dark:bg-black/40`.

## Radius
Cards `rounded-3xl` (20px), inputs/badges `rounded-xl` (12px), modals/sheets `rounded-[28px]`.

## Motion
`transition-spring` = `cubic-bezier(0.16,1,0.3,1)`, 300-400ms. Card hover: translate up 2px, `shadow-apple-card` → `shadow-apple-float`. Button press: `active:scale-[0.98]`. No `framer-motion` — CSS transitions only (not an installed dependency, not needed at this scale).

## Typography
Existing `font-display` for headings, `font-sans` for body. Large numbers (hero metrics) use the display family at bold weight, generous line-height.

## Layout rules
Generous whitespace over borders. Cards over tables where the content is a handful of fields. Lists over grids for department/employee rows (Finder-style). Only exceptions get color weight — a healthy row stays visually quiet.

## Interaction rules
Every metric is a link to its drill-down route. Every list has an empty state with a positive message, not a blank box. Every async boundary shows a skeleton shaped like the real content (see `components/ui/skeleton-variants.tsx`), never a spinner or "Loading..." text, per CLAUDE.md.
