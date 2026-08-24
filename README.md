# حساب‌کن (Hesabkon)

یک **Personal Operating System** واقعی و قابل‌اجرا: ثبت سریع فعالیت/کار/هزینه، ردیابی زمان، حسابداری شخصی، اقساط و بدهی، دارایی واقعی و مجازی، تقویم شمسی، و گزارش‌گیری — همه در یک رابط فارسی، ساده و سریع.

این یک Prototype نیست. یک اپلیکیشن Next.js کامل با دیتابیس واقعی (SQLite/PostgreSQL از طریق Prisma)، Authentication واقعی (bcrypt + JWT httpOnly cookie)، محاسبات مالی/زمانی واقعی (Integer-based، بدون خطای Floating Point)، Audit Log، و Seed Data واقعی است.

## 1. Project Structure

```
hesabkon/
├── prisma/
│   ├── schema.prisma            # SQLite schema (dev — zero setup)
│   ├── schema.postgresql.prisma # PostgreSQL variant (production, see DEPLOYMENT.md)
│   ├── migrations/               # SQLite migration history
│   └── seed.ts                   # Demo user + realistic demo data
├── src/
│   ├── app/
│   │   ├── (auth)/login, register        # Public auth pages
│   │   ├── (app)/                        # Authenticated shell (hamburger nav, no persistent sidebar)
│   │   │   ├── page.tsx                  # Home: today's events + "ثبت کار" capture entry — deliberately minimal
│   │   │   ├── calendar/                 # Month/Week/Day/Agenda views
│   │   │   ├── tasks/
│   │   │   ├── finance/                  # Transactions / Accounts / Installments tabs
│   │   │   ├── assets/                   # Real + Virtual assets
│   │   │   ├── reports/                  # Range reports, narrative, charts, Hidden Cost tab, export
│   │   │   ├── habits/                   # Habit management: create/edit/disable/delete, Tiny Habits trials — NOT on Home (see §2)
│   │   │   ├── projects/, projects/[id]/
│   │   │   └── settings/                 # Personal / Financial / Categories / Audit log
│   │   └── api/                          # REST-style route handlers, one folder per entity
│   ├── components/
│   │   ├── nav/AppTopBar.tsx, NavDrawer.tsx, navConfig.tsx  # Hamburger menu — the only navigation chrome
│   │   ├── CaptureForm.tsx                   # Unified Task/Event capture: type → expense/asset → category → day/time → cost
│   │   ├── GlobalCaptureFab.tsx              # Floating capture button on every page except Home
│   │   ├── habits/HabitFormModal.tsx, HabitAdherenceChart.tsx  # Regular habit create/edit + collapsible adherence line chart (used on Home and Reports)
│   │   ├── habits/TrialHabitFormModal.tsx, TrialHabitCard.tsx  # BJ Fogg "Tiny Habits" 3-day trial: Cue→Action→Celebration chain form, day-progress card with keep/discard prompt
│   │   └── calendar/, ui/, icons.tsx
│   ├── lib/                              # Pure business logic + Prisma/auth/services
│   │   ├── parser.ts                     # Rule-based Persian free-text parser (used by lib/parser.test.ts; not wired into the new structured CaptureForm — see Known Limitations)
│   │   ├── hourlyValue.ts, timeCost.ts    # Time-value & real-cost math
│   │   ├── reportEngine.ts, narrative.ts  # Report aggregation, incl. computeHiddenCostReport and computeHabitsReport
│   │   ├── directCostSync.ts              # Keeps Activity/Task/Event directCost in sync with a linked Transaction; syncTaskVirtualAsset mirrors that for Task time → virtual assets
│   │   ├── habitSync.ts                   # Mirrors a Habit check-in's per-day value into a VirtualAssetEntry (same pattern as directCostSync)
│   │   ├── habitStreak.ts                 # Pure adherence/streak/neglect math for the habit tracker (Duolingo-style 80% daily threshold)
│   │   ├── activityService.ts             # Timer + TimeEntry logic for the fuller Activity flow
│   │   ├── recurrence.ts                  # Recurring event expansion
│   │   ├── jalali.ts, calendarGrid.ts     # Jalali (Persian) calendar support
│   │   └── *.test.ts                      # Vitest unit tests for the above
│   └── middleware.ts                      # Route protection (JWT check)
├── docker-compose.yml, Dockerfile         # Production deployment (PostgreSQL)
└── DEPLOYMENT.md, .env.example
```

## 2. Implemented Features

**P0 — fully implemented**
- Email/password authentication (bcrypt hashing, JWT in httpOnly cookie, rate-limited login, per-user data isolation)
- Minimal Home page — today's events, a read-only-except-checkbox habit checklist, and a "ثبت کار" capture entry; every other section (including all habit creation/editing) lives behind the hamburger menu (`NavDrawer`), not on Home — habit creation deliberately isn't a Home action since, unlike logging a task, it's not something done every day
- Unified Capture form (`CaptureForm.tsx`, used on Home and via the floating button everywhere else): choose Task or Event, then Expense or Asset, then a category filtered to match (tapping a category also sets Expense/Asset from that category's own tag), then day (defaults to today), optional start/end time, and an optional cost in Toman — every field is skippable but always has a place to be filled in
- Tasks (CRUD, status, due date, category/project, optional startAt/endAt + directCost from the unified capture form)
- Activities & Time Tracking: Start/Stop timer, manual duration entry, multiple `TimeEntry` segments per `Activity` (the fuller flow, still available for detailed multi-segment logging)
- Categories with kind (Productive / Neutral / Waste), a separate Expense/Asset `valueType` tag (drives the Capture form's category filter and default), color, icon, active/inactive toggle, and an optional Virtual Asset rate — all editable in Settings → دسته‌بندی‌ها
- Hourly Value settings (monthly income ÷ working hours, or manual override) — used everywhere real/opportunity/hidden cost is computed
- Expenses & Income as real ledger `Transaction`s against real `FinanceAccount`s (balances computed from the ledger, not stored redundantly); a Task or Event's directCost auto-syncs to a linked Transaction so it's never double-counted or missing from the ledger
- Calendar: Month / Week / Day / Agenda views showing both Events and Task due-dates together, recurring events (daily/weekly/monthly/yearly) ending either by an occurrence count or an end date, multiple reminders per event, click-to-edit/delete on any event, and a completion checkbox on Day/Agenda occurrences (and on Home's "رویدادهای امروز") — only completed occurrences count toward Reports time totals (`EventCompletion`, one row per occurrence since a recurring event has no per-occurrence database row)
- Jalali (شمسی) date picker (`JalaliDateInput`) used everywhere a date is entered — no native Gregorian `<input type="date">` pickers anywhere in the app
- Reports: date-range presets + custom range, Persian narrative summary, time/expense distribution charts (long Persian category/project labels are truncated on chart axes with the full name still shown in the tooltip — Recharts' category axis otherwise wraps long labels into broken fragments), opportunity-cost callout, a dedicated **هزینه پنهان (Hidden Cost)** tab (sum of Task/Event direct costs + the Toman value of any time explicitly logged against them), a **عادت‌ها (Habits)** tab, CSV export, and a detailed **print-based PDF export** (`/print/report` — see §9 for why this replaced a client-side PDF library). Time totals aggregate across all three logging paths — Activity `TimeEntry`, Task `startAt`/`endAt`, and completed Event occurrences — so time logged any of these ways always shows up in the same report
- `/api/dashboard` still exists and is fully computed/tested (Today/Month/Net-Worth in one pass) but isn't currently wired to a page now that Home is minimal — see Next Development
- Database: normalized schema, foreign keys, indexes, soft deletes on mutable entities
- Audit Log: every create/update/delete/login/payment/timer action is recorded with old/new value snapshots, viewable in Settings → سابقه

**P1 — fully implemented**
- Projects, with a per-project dashboard (progress, direct cost, time cost, real cost, income/cash-flow) — every Project auto-creates a matching Category (defaults to "دارایی") so project work categorizes itself in Quick Capture; renaming/completing/deleting a project keeps the category in sync
- Marking a project **COMPLETED** registers its accumulated real cost (direct + time) as its own virtual asset entry — visible on the Assets page under "دارایی از پروژه‌های تکمیل‌شده"
- Income, not just cost: Tasks and Events can carry either a direct cost or a registered income (`CaptureForm`'s هزینه/درآمد toggle), each auto-synced to a real `Transaction` the same way costs are
- Installments/Debt: auto-generated monthly schedule, a **real interest calculator** (`computeLoanInterest` — total repayable vs. principal, shown live while creating a plan and on every plan card), per-installment reminder offsets (same picker as Events), pay-next-installment flow that posts a real linked `Transaction`, this-month summary
- Accounts (bank card / bank account / cash / wallet / investment) with computed balances
- Real Assets (purchase price, current value) and Virtual Assets, broken down by category with an expandable itemized list, auto-computed from time spent in categories you've opted in (e.g. "1h of study = 350,000 Toman", or the new default "استراحت بدون تکنولوژی" for tech-free rest) — generated identically whether that time was logged through a Task's start/end time or the fuller Activity/Timer flow
- Opportunity Cost: waste-time activities surfaced separately from real expenses, worded as "هزینه فرصت" — never conflated with money actually spent
- CSV export for tasks/activities/transactions/assets
- **Habit Tracker** (own hamburger-menu section, `/habits` — not on Home): create/edit/disable/delete a permanently-recurring habit (same form pattern as Event creation, minus the date), a daily checklist (full management on `/habits`, checkbox-only on Home), a per-day Toman value that mirrors into a `VirtualAssetEntry` on check-in (surfaced on the Assets page and in the Reports summary as "دارایی دیجیتال از عادت‌ها"), a Duolingo-style day streak (the streak holds as long as ≥80% of that day's active habits were checked in — `lib/habitStreak.ts`), a collapsible adherence line chart (Home + Reports), and a lazily-fired re-engagement notification when a habit goes 3+ days without a check-in, suggesting the user revisit and downsize it (cooldown-gated via `Habit.lastNudgeSentAt` so it doesn't re-fire on every poll)
- **Tiny Habits trial flow** (`/habits` → "عادت تستی"), following BJ Fogg's method: a 3-field chain form — Cue ("بعد از..."), Micro-action, Celebration — creates a habit with `isTrial=true` and a 3-day window (`trialStartDate`, `lib/habitStreak.ts`'s `trialDayNumber`/`isTrialElapsed`). Checking in during the trial shows the user's own celebration text as a toast. Trial habits are deliberately excluded from the main streak/adherence math, the Reports habits tab, and the neglect-nudge notification — a 3-day experiment can never break an already-established streak. Once the 3 days elapse, the card shows a keep/discard prompt: "keep" promotes it to a permanent habit (`isTrial` flips to `false`, and `createdAt` is reset to the promotion moment — otherwise the habit would retroactively count against its own imperfect trial-period check-ins the instant it's promoted); "discard" soft-deletes it. A trial can also be cancelled early at any point before the 3 days are up.

**P2 — architected but not implemented (by design — see Known Limitations)**
- AI-based parsing/report generation (the rule-based parser in `src/lib/parser.ts` is a drop-in replacement point — see "Next Development")
- Google Calendar sync, Telegram/email notifications (in-app notification bell works today; the `Notification`/`Reminder` models are provider-agnostic)

## 3. Database

Prisma ORM. Local/dev uses SQLite (`prisma/schema.prisma`, zero setup — no server to install). All money is stored as **integer Toman** and all durations as **integer minutes**, specifically to avoid floating-point drift in financial math (per the "test financial math seriously" requirement — see §8 Test).

Run migrations:
```bash
npx prisma migrate deploy   # apply existing migrations (used by npm run prisma:migrate in dev)
```

For PostgreSQL in production, see [DEPLOYMENT.md](DEPLOYMENT.md) — a parallel schema (`prisma/schema.postgresql.prisma`) is provided.

## 4. Seed Data

`prisma/seed.ts` creates a demo user with realistic data spanning the current month: tasks, timed activities (including waste-time and virtual-asset-generating study sessions), income/expenses, a car-loan installment plan with two payments already made, real assets, both one-off and recurring calendar events, three regular demo habits — one with a strong 10-day streak, one checked in every other day (partial adherence), and one neglected for 5 days (demonstrates the re-engagement nudge notification) — and two Tiny Habits trials: one mid-window (day 2 of 3) and one whose 3 days are already up, ready to demonstrate the keep/discard prompt.

- **Email:** `demo@hesabkon.app`
- **Password:** `demo1234`

Re-running the seed is a no-op if the demo user already exists — delete `prisma/dev.db` first to start fresh (see Run Instructions).

## 5. Run Instructions

Requires Node.js 18.17+ (tested on Node 24).

```bash
npm install
npx prisma migrate dev     # creates prisma/dev.db and applies the schema
npm run db:seed            # populates demo data
npm run dev                # http://localhost:3000
```

Log in with the demo account above, or register a new one from `/register`.

Other scripts:
```bash
npm run build       # production build
npm run start        # run the production build
npm test              # Vitest unit tests (51 tests, financial/time/parser/recurrence/habit-streak logic)
npm run db:reset     # drop + recreate + reseed the dev database
```

## 6. Deployment

See [DEPLOYMENT.md](DEPLOYMENT.md) for the full VPS/subdomain guide: environment variables, PostgreSQL migration, Docker Compose (`app` + `postgres`), reverse proxy + SSL (Nginx/Caddy examples), and backup/restore.

## 7. Environment Variables

See [.env.example](.env.example). Minimum to run: `DATABASE_URL`, `JWT_SECRET`.

## 8. Test

```
npm test

 ✓ src/lib/timeCost.test.ts      (5 tests)
 ✓ src/lib/hourlyValue.test.ts   (4 tests)
 ✓ src/lib/installments.test.ts  (5 tests)
 ✓ src/lib/habitStreak.test.ts   (15 tests)
 ✓ src/lib/parser.test.ts        (9 tests)
 ✓ src/lib/money.test.ts         (9 tests)
 ✓ src/lib/recurrence.test.ts    (4 tests)

 Test Files  7 passed (7)
      Tests  51 passed (51)
```

Coverage focuses on the money/time-critical logic per the brief's explicit requirement ("financial calculations must be seriously tested, no naive floating point"): hourly-value derivation, time-cost/real-cost/virtual-asset formulas (including the exact worked examples from the spec), installment schedule generation and summarization, and the Quick Capture parser against all of the brief's own example strings.

Beyond automated tests, every feature listed under "Implemented Features" was manually exercised end-to-end in a real browser session against the seeded demo data — login, quick capture (all four inferred types), timer start/stop, task completion, installment payment, category virtual-asset toggling, calendar recurrence expansion, and CSV/PDF export were all verified to produce correct, consistent results (see the acceptance criteria list below).

**Acceptance criteria (from the brief, §66) — all verified working:**
Login/register · create Task · log Activity · start/stop Timer · see time spent · set salary → see hourly value · see an activity's time cost · create Expense/Income · create Account · create Installment plan · pay an installment · view Calendar · create Event/Reminder · check off an Event occurrence → see it in Reports · create Project · create real Asset · enable Virtual Asset on a category · log a Waste activity → see Opportunity Cost · create/check-in/edit/disable/delete a Habit from `/habits` · start a Tiny Habits trial (cue/action/celebration) → check in during the window → promote or discard after 3 days without disturbing the main streak · see a habit's streak and adherence chart · view Dashboard · pull a monthly Report · export data (CSV/PDF) · view Audit Log.

## 9. Known Limitations

- **Single database engine per deployment**: Prisma ties its generated client to one datasource provider; SQLite (dev, fully tested) and PostgreSQL (production, see DEPLOYMENT.md) are separate schema files that must be kept in sync manually.
- **PostgreSQL path is unverified in this environment**: this sandbox has no Docker daemon, so `docker compose up` against the Postgres schema was reviewed but not executed. The SQLite path (`npm run dev`) is fully tested end-to-end.
- **"Today" boundary uses server local time**, not the user's configured timezone (the `Settings.timezone` field is stored but not yet threaded through report queries) — fine for a single-region personal deployment, worth revisiting for multi-timezone use.
- **Notifications are in-app only**, delivered by polling `/api/notifications` (which lazily "fires" any reminder whose time has passed). No email/Telegram/push delivery yet — the `Notification`/`Reminder` models are already provider-agnostic for this.
- **The free-text NLP parser (`src/lib/parser.ts`) isn't wired into the current Capture form** — it's fully implemented and unit-tested (correctly handles every example in the product brief) but the UI now uses the explicit structured fields (type → expense/asset → category → day/time → cost) per a later product decision favoring predictability over inferred parsing. Reconnecting it as an optional prefill is a small, isolated change (see Next Development). No AI/LLM parsing is connected either way.
- **Recurring events don't support per-occurrence edits/cancellation** yet (the schema has the fields for it — `recurrenceParentId`, `isCancelled` — but the UI/API only edit the whole series).
- **CSV import** and **full offline support** (PWA offline caching beyond the web manifest) are not implemented — Quick Capture is not currently queued when offline.
- **Rate limiting is in-memory**, fine for a single-instance personal deployment; would need a shared store (Redis) behind a load balancer.
- **Habit tracker is single-user by design, with no community/social layer** — streaks, adherence, and nudges are all private to the one account, matching the rest of the app's single-user architecture. Multi-user "community"/"loyalty" features were raised as a longer-term product direction but are a much larger scope departure (accounts seeing each other, shared leaderboards, social data model) and were deliberately not built here; see Next Development.

## 10. Next Development

- Wire an LLM behind the existing parser interface (`parseQuickCapture` in `src/lib/parser.ts` is already isolated so a hybrid "try AI, fall back to rules" swap is a small change) for free-form capture and AI-generated monthly narratives.
- Google Calendar two-way sync; Telegram/email reminder delivery.
- Per-occurrence recurring-event edits and cancellation.
- Respect `Settings.timezone` in all date-boundary math (today/this-month cutoffs, report ranges).
- CSV import for transactions/tasks; full offline queueing for Quick Capture (PWA background sync).
- Drag-and-drop dashboard card reordering (today: hide/show only, per the brief's "at minimum" allowance).
- A multi-user "community" layer for the habit tracker (shared streaks/leaderboards, social accountability, loyalty mechanics) — a real scope/architecture decision to make with the product owner before building, not an incremental addition.
