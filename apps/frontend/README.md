# Frontend — Phase 1A (secure core only)

React 19 + TypeScript + Vite + React Router + Tailwind + CSS
Modules + Motion-ready shell. The browser is UI only: it makes
no auth decisions, holds no session token, and never renders
user content as HTML.

## Pages

Home (illustrated cottage: mailbox → Letters, garden → Memory
Wall, door → destinations), Memory Wall, Letters, Quiet Room
(journals + voice notes), Things I See in You, Our Future,
Secret Arcade, Deleted, Settings, Space setup, Sign in / Register.

The Secret Arcade page in 1A is an explicit "games arrive in
Phase 1B" notice only. There are no game buttons, and nothing
here pretends a game exists.

## Run

From the repo root: `npm run dev:web` (port 5173). `/api` is
proxied to the local API on port 4000, so the session cookie is
same-origin in development. Production cookie/hosting decisions
are R1, UNDECIDED — nothing here is deployed.

The first-visit introduction on Home can be skipped and is
remembered in localStorage, so it does not repeatedly interrupt
returning visitors. That flag is a UI preference only; it is
not authentication and not a substitute for a session.
