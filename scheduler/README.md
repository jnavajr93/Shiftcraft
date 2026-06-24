# Shiftcraft

A config-driven shift scheduler. Everything about your business — people, roles,
locations, shifts, and rules — lives in editable data, not code. The solver reads
that data and generates a weekly schedule. Adapt it from an eye clinic to a
restaurant by editing the Setup tab; no code changes needed.

## Run locally
```bash
npm install
npm run dev
```

## Deploy to Vercel
1. Push this folder to a GitHub repo (or run `vercel` from the Vercel CLI).
2. In Vercel, "New Project" → import the repo.
3. Framework preset is auto-detected as **Vite**. Build command `npm run build`,
   output directory `dist`. Click Deploy.
4. You get a live URL. Done.

No backend, no database, no accounts. Your setup auto-saves in the browser and
can be exported/imported as a JSON file from the top bar.

## How it works
- **src/engine/schema.js** — the data model and the 6 constraint types.
- **src/engine/solver.js** — the generic placement engine (knows nothing about
  any specific industry).
- **src/engine/seed.js** — a sample clinic so the app is useful on first open.
- **src/components/** — the UI (Schedule board + Setup editor).

## The 6 rule types
1. **Min staff** — a location needs at least N of a role.
2. **Max staff** — a location allows at most N of a role.
3. **Must pair** — a person follows a specific shift wherever it runs.
4. **Whitelist** — only listed people may staff a location.
5. **Unavailable** — a person is off on given days.
6. **Hour cap** — a person works at most N hours/week.

Almost any real-world scheduling rule is one of these.
