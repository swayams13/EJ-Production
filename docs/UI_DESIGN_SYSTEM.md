# Frontend Design System — Technical Reference

Canonical reference for the enterprise UI redesign (started 2026-07-05). Read this
before adding new frontend pages or components — most of what you need already
exists in `next-frontend/src/components/ui/`.

## Design tokens

Defined in `next-frontend/src/app/globals.css` via Tailwind v4's `@theme` block.
Deliberately **not** the generic AI-default palette (no Inter font, no indigo/purple
primary, no pure black/white) — see `mistakes.md` #6 and `projectprogress.md`
(2026-07-05, Session 2) for the reasoning.

- **Colors**: `ink` (warm charcoal, not black), `paper`/`paper-raised` (soft, not
  stark white), `brand` (muted petrol teal), `success`/`warning`/`critical`
  (desaturated — these appear dozens of times per screen, so they're tuned to not
  read as alarms for routine states). All colors were softened once already after
  user feedback about all-day operator eye strain — don't re-saturate them.
- **Type**: `font-display` (condensed, uppercase headings), `font-body` (system
  sans), `font-data` (monospace, paired with `tabular-nums` for any column of
  numbers — this app is full of feet/qty/percentage figures).
- **Radius**: `radius-sm/md/lg` (4/6/8px) — intentionally tighter than the old
  `rounded-lg`/`rounded-xl`/`rounded-2xl` overuse found in the original UI.

## Component library (`next-frontend/src/components/ui/`)

`Button` (primary/secondary/danger/ghost), `Card`/`CardHeader`/`CardBody`, `Badge`
(brand/success/warning/critical/neutral tones), `Table`/`THead`/`TBody`/`Tr`/`Th`/`Td`
(pass `numeric` on **both** a `Th` and its matching `Td` — they must agree, this was
a real bug once), `Alert` (success/warning/critical/info), `Modal`, `useConfirm`
(replaces `window.confirm()`), `useToast` (replaces `window.alert()`), `Spinner`,
`EmptyState`, `Input`/`Select`/`Textarea`/`Label`, `MetricCard`, `ProgressBar`.

Import from the barrel: `import { Button, Card, ... } from "@/components/ui";`

## Rules for new pages

1. **Never build a Tailwind class name by string interpolation**
   (`` className={`bg-${x}-500`} ``) — Tailwind's production build can't see it and
   silently drops it. Map runtime values to a fixed literal lookup instead (see
   `mistakes.md` #5, and `dashboard/executive/page.tsx`'s `KPI_COLOR_TO_TONE` for
   the pattern).
2. **Never use `alert()`/`confirm()`/`prompt()`** — use `useToast`/`useConfirm`/`Modal`.
3. **`Th numeric` and `Td numeric` must be set together** on the same column, or the
   header and its values won't align.
4. Don't add a `p-8 max-w-7xl mx-auto`-style wrapper inside a page — the `(main)`
   layout (`next-frontend/src/app/(main)/layout.tsx`) already provides it.
5. Sidebar nav lives in `next-frontend/src/components/Sidebar.tsx`, grouped into
   5 domains (`NAV_GROUPS`) — add new routes to the right group rather than
   appending to a flat list.

## Migration status (as of 2026-07-05)

All pages migrated: Progress/Executive/Planning/WIP/Hold dashboards, Projects
List/Add/Edit, Shop Floor Entry, Visual Tracking, Workforce Intelligence,
Daily Scheduler, Master Data, Inventory, Operators, Audit, the root Login
page, and the Dispatch/Inspection placeholder pages (now proper `EmptyState`
"coming soon" screens) — plus the Sidebar and root layout/tokens. No more
`alert()`/`confirm()`/`prompt()` calls remain anywhere in the app; all
destructive/informational dialogs go through `useConfirm`/`useToast`.
