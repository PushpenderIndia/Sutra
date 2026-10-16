# PR 05 — App shell: tabs, chat panel, graph bar, i18n

**Branch:** `feat/05-app-shell` · **Depends on:** 04 · **Size:** M

## Why
The whole product lives on one screen: a **graph bar** on top, **four tabs** on the left, and a **chat panel** on the right. Build the frame and reusable primitives once, so feature PRs only fill in content.

## Layout

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ Logo · workspace ▾        <AgentGraphBar/> (PR 17)              ⌘K · locale │  56–160px, expands on hover/click
├──────────────────────────────────────────────────────────────┬───────────────┤
│ [Business] [Prospects] [Campaigns] [Leads]                   │ <ChatPanel/>  │
│                                                              │   (PR 16)     │
│  <TabContent/>                                               │   360px,      │
│                                                              │   resizable,  │
│                                                              │   collapsible │
└──────────────────────────────────────────────────────────────┴───────────────┘
```

- Routes: `/(app)/[tab]` with `tab ∈ business | prospects | campaigns | leads`. URL state holds filters and the selected row, so the chat can read it.
- **Selection context**: a `useSelection()` store (Zustand) holds `{ tab, selectedIds[] }`. The chat panel reads it, so "rewrite this one" knows what "this" is.
- Mobile (≤ 768px): the chat becomes a bottom sheet; the graph bar collapses to a single "running: Prospector · 3 sub-agents" pill.

## Stack
- Tailwind v4 + **shadcn/ui** (Tabs, Card, Table, Dialog, Sheet, Badge, Form, Command, Resizable, Sonner)
- **TanStack Table** (wrapped once as `<DataTable>`) + **TanStack Query** (polling for live data)
- **react-hook-form + zodResolver**, using the same schemas from `@sutra/domain`
- **React Flow** for the graph bar (PR 17)
- **next-intl** for UI strings; `lucide-react` icons; Geist + Noto Sans (covers APAC scripts)
- Light/dark theme via CSS variables

## Visual direction
Calm, editorial and confident:
- Warm off-white / deep ink palette with one accent (saffron `#E8833A`), a nod to the "thread" theme
- Agent nodes glow and pulse in the accent colour while running; completed nodes settle to ink with a check
- Generous whitespace, 14px base, tabular numbers

## Reusable building blocks
| Component | Used by |
|---|---|
| `<DataTable schema columns query>` | prospects, leads, variants, suppressions |
| `<StatCards items>` | Leads tab status cards, Campaigns variant stats |
| `<EditableCard schema value onSave>` | Business tab profile and ICP sections (inline edit) |
| `<Checkpoint title summary onConfirm>` | Checkpoint 1 (Business) and 2 (Campaigns) banners |
| `<Thread messages>` | lead detail sheet |
| `<StatusBadge status>` | one map for every status enum |
| `<EmptyState>` `<PageHeader>` `<LiveDot>` | everywhere |

## i18n
- UI languages: `en, hi, id, ja, zh, th`. Start with `en`, `hi`, `id`; `pnpm i18n:translate` fills missing keys with Gemini.
- UI language (the user's) is separate from content language (each contact's locale).

## Tasks
- [x] shadcn init + theme tokens + fonts
- [x] Shell layout: header slot for the graph bar, tabs, resizable chat slot
- [x] Selection-context store
- [x] Shared components above
- [x] next-intl + locale switcher + translation script
- [x] Empty states for the four tabs

## Acceptance criteria
- Lighthouse accessibility ≥ 95
- Chat panel resizes and collapses; the layout holds at 1280px and 375px
- Selecting rows in any tab updates the selection context (tested)
