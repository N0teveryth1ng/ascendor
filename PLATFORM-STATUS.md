# THE FORGE — Platform Overview & Complete Change Record

**Status draft.** Compiled from the repository itself (7 commits, 107 tracked files, ~27,000
lines) rather than from memory, so every number below is verifiable against the code.

- **Repository:** `https://github.com/N0teveryth1ng/ascendor`
- **Live URL:** `https://the-forge-amber-eight.vercel.app` (the `the-forge.vercel.app` alias returns 404)
- **Branch:** `main`, tracking `origin/main`, clean
- **Head commit:** `a794485`

---

## 1. What the platform is

THE FORGE is an adaptive high-rigor language acquisition system. A candidate is calibrated
once, then drilled in short daily sessions whose difficulty, time pressure and stimulus rate
are continuously retuned from their own measured performance. Five hidden metrics track
progress; the candidate never sees a raw score.

The distinguishing design commitment: **failure costs progress, never capability or access.**
A bad day resets a streak and can force a repeat. It can never cut baseline stats, and it can
never lock a candidate out. This is encoded structurally, not just by convention — see §6.3.

---

## 2. Repository at a glance

| | |
|---|---|
| Commits | 7 |
| Tracked files | 107 |
| TypeScript | ~100% (server + web + api entry) |
| Workspaces | `server`, `web` (npm workspaces, root `forge-v2`) |
| Server framework | Express 4 on Node ≥22.5 |
| Database | **Neon Postgres** (was SQLite) |
| Frontend | React 18.3 + Vite 6 + Tailwind 3.4 + Zustand 5 + Recharts 3.10 |
| Build | `tsc -b` strict, Vite production bundle, 4 manual chunks |
| Tests | 117 smoke checks, 60 e2e checks, 2 Playwright specs, 29 unit tests |
| Production | Vercel serverless (`api/index.ts`), auto-deploy from `main` |

### Line counts per commit

| Commit | Files | +/- | Change |
|---|---|---|---|
| `92153bf` | 89 | +20,046 | Initial build: engine, auth API, candidate UI |
| `556797e` | 7 | +150 / −38 | Demo teacher account made opt-in |
| `eb27c36` | 37 | +2,799 / −797 | SQLite → Neon Postgres port |
| `d7fe4fe` | 9 | +527 / −72 | Self-contained verification suites + gap closure |
| `8fb2292` | 4 | +135 / −8 | Fixed accounts converge to environment on cold start |
| `943c9bc` | 5 | +478 / −140 | Drill-kind drift fix (production bug) |
| `a794485` | 4 | +672 / −1 | Glicko-2 rating core |

---

## 3. Architecture

```
Browser (React SPA)
   │  same-origin /api, httpOnly cookie, no CORS
   ▼
Vercel: api/index.ts  ── ensureReady() → migrate() + seed(), memoised per cold start
   │                    ── on failure: HTTP 503 {"error":"DATABASE UNAVAILABLE"}
   ▼
Express app (app.ts)
   ├─ /api/auth     → auth routes
   ├─ /api          → data routes + session-scoped user routes
   ├─ /api/teacher  → observer routes (admin only)
   └─ /api          → api routes + legacy candidate-scoped mirrors
   ▼
Service layer  →  core/ (pure engine)  +  db/ (repository)
   ▼
Neon Postgres via @neondatabase/serverless (Pool, max 8)
```

The client **never** puts a candidate id in a URL. History, stats, profile, and calibration are
all resolved from the session cookie. The Playwright suite explicitly asserts the retired
`/api/candidates/...` surface receives zero calls.

---

## 4. The calibration system (Section 1.3)

A five-vector battery, each vector run **twice** — untimed, then timed. The rationale is
structural: the untimed pass measures capability ceiling; the timed pass measures how much
speed degrades that ceiling. Only the second number is what the adaptive engine needs.

| Vector | Name | What it measures | Derivation |
|---|---|---|---|
| C1 | LEXICAL RANGE | Vocabulary ceiling | 12 bands, weighted per-band, band reached while accuracy ≥ 90 |
| C2 | SYNTAX CEILING | Grammar ceiling | 8 levels, ceiling advances while accuracy ≥ 90 |
| C3 | AURAL PROCESSING SPEED | Speech throughput | **max** WPM rung still ≥ 90% accurate |
| C4 | ARTICULATION BASELINE | Vocal clarity | Scored against the candidate's **own** mean, never a native ideal |
| C5 | ORTHOGRAPHIC REFLEX | Typo vulnerability | TVI = normalised speed-induced accuracy collapse, 0–1 |

**C4 is deliberately scale-invariant.** Classes scoring below 85% of the candidate's own mean
are flagged weak. A candidate with uniformly quiet diction is not penalised; only *relative*
weakness is surfaced.

**Entry rank** is derived from four floors — all must be met for RANK 02, else RANK 03:
TVI ≤ 0.06 and untimed ≥ 98, untimed ≥ 95, ceiling ≥ S5, and max WPM ≥ 200.

**Phase-1 entry difficulty seed** then sets the starting conditions:

```
latency_threshold_ms = clamp(baseline_reflex_latency × 1.15 × (1 + TVI × 0.5), 900, 4000)
speed_multiplier     = clamp(0.9 + max(0, maxWPM − 110) / 100,            0.7, 1.8)
wpm_ceiling          = clamp(maxWPM − 20,                                  90, 400)
flash_duration_ms    = clamp(2400 − (bandIndex / 12) × 700,                1200, 2500)
phase1_sublevel      = max(subFromSyntax, subFromAccuracy)  per module
```

The resulting **PCP** (Personalized Calibration Profile) is written with `locked = 1` and can
only be re-finalised via an explicit `recalibrate` flag. Raw passes are retained separately so
the profile stays auditable.

---

## 5. The nine modules

| ID | Title | Phase | Block | Target band | Threshold clamp | Speed clamp | Feeds PTI |
|---|---|---|---|---|---|---|---|
| P1_VD | VECTOR DISAMBIGUATION | 1 | VECTOR | 95–100 | 900–4000 | 0.7–1.8 | **yes** |
| P1_VSF | VISUO-SPATIAL FLASH | 1 | VISUOSPATIAL | 88–100 | 2500–12000 | 0.6–1.6 | no |
| P1_VM | VOCAL MECHANICS | 1 | VOCAL | 90–100 | 1500–5000 | 0.7–1.7 | no |
| P2_RDI | RAPID DICTATION INTERCEPT | 2 | DICTATION | 92–100 | 700–3500 | 0.8–2.0 | no |
| P2_FCM | FLOWCHART COMPREHENSION MAPPING | 2 | VISUOSPATIAL | 88–100 | 2000–10000 | 0.6–1.5 | no |
| P3_SSM | SLOT-SUBSTITUTION MATRIX | 3 | VECTOR | 95–100 | 800–4500 | 0.6–1.6 | **yes** |
| P3_HVS | HIGH-VELOCITY STREAM PROCESSING | 3 | DICTATION | 92–100 | 700–4000 | 0.7–2.2 | no |
| P4_PC | THE PRESSURE CHAMBER | 4 | DICTATION | 96–100 | 600–3000 | 0.8–1.9 | no |
| P4_VDS | VOCAL DEXTERITY STRESS RUN | 4 | VOCAL | 92–100 | 1200–4500 | 0.7–1.6 | no |

**Clamps exist so the engine cannot tune a candidate into impossibility.** The widest clamp is
P2_FCM (2000–10000 ms, 5×); the fastest stimulus is P3_HVS (up to 2.2×).

**Item count scales with sublevel:** `min(24, 12 + (sublevel − 1) × 2)` → 12 items at
sublevel 1, 22 at the APE's maximum sublevel 6.

### Phase gating

| Phase | Required rank |
|---|---|
| 1 | always open |
| 2 | RANK 02: OPERATOR |
| 3 | RANK 02: OPERATOR |
| 4 | RANK 01: STRIKER |

Gating is enforced on **both** the plan request and the session submit — a client cannot skip it
by posting directly.

---

## 6. The adaptive engine

### 6.1 Rolling window and threshold recalculation

An 8-session rolling window per candidate per module. After each session, least-squares slopes
over the window produce two trends, and a factor is selected:

| Condition | Factor | Effect |
|---|---|---|
| Fewer than 3 sessions | HOLD (1.00) | reason `INIT` |
| Accuracy trend ≥ +5 pts **and** latency improving | **TIGHTEN 0.93** | shorter deadline |
| Accuracy trend ≤ −8 pts | **LOOSEN 1.08** | longer deadline |
| \|trend\| ≤ 2 and inside band | HOLD (1.00) | "correctly calibrated" |
| otherwise | HOLD (1.00) | "no qualifying trend" |

The load-bearing detail is an **asymmetry in how the factor is applied**:

```
threshold_after = threshold_before × factor        // time budget   — multiply
speed_after     = speed_before     ÷ factor         // stimulus rate — divide
```

`speed_multiplier` is a delivery *rate*, not a budget, so >1 means faster. TIGHTEN shortens the
deadline, so the delivered stimulus must rise by the same proportion. The content layer mirrors
this with explicit `timeBudget(base, f) = base × f` and `deliveryRate(seed, f) = seed ÷ f`
helpers, because getting the direction wrong is a silent pacing bug. A regression test guards it.

Every adjustment is logged with before/after thresholds, the trend that caused it, and which
clamp bound. The log retains the last 40 entries and is surfaced to the teacher view.

### 6.2 Structural Locks

The engine distinguishes a *transient* error from a *structural* one.

- A category recurring in **4 distinct sessions** opens a Structural Lock.
- **3 sessions** does not (regression-tested).
- An already-locked category does not re-trigger.
- Fewer than **2** occurrences in the window clears the lock and deletes its counter.
- Locks divert **15%** of subsequent sessions (minimum 2 items) to the locked category, moved
  to the front of the item list and flagged.
- Locks grant **1.15× speed relief** — a *wider* threshold and a *lower* rate — so remediation
  is genuinely easier, not just differently ordered.
- Locks block escalation, but never block access to the module.
- The lock that a session itself triggers is **not** billed against its own budget.

### 6.3 Failure tiers — structurally incapable of punitive outcomes

| Daily aggregate | Tier | Streak | Forced repeat |
|---|---|---|---|
| ≥ 95% | NONE | preserved, multiplier +0.1 (cap 2.0) | no |
| 85–95% | BELOW_95 | reset to 0 | no |
| < 85% | BELOW_85 | reset to 0 | **yes**, failed modules re-run |

`lockout_applied` and `baseline_stats_cut` are typed as the literal `false` in every branch, so
returning `true` is a compile error rather than a code review question. The database write
hardcodes both to `0` in SQL as a second layer.

A streak counts consecutive **days**, not sessions — three sessions in one day is one streak
day, and this is regression-tested.

### 6.4 Escalation

Three **new** consecutive in-band sessions (accuracy at/above band minimum *and* mean latency
within the current threshold) with zero active locks advance the sublevel, capped at 6.

The `last_escalated_session_id` marker is what makes this correct. Without it the same three
sessions would re-trigger on every subsequent session forever. Regression-tested: two new
sessions are insufficient, three re-escalate.

### 6.5 The Pressure Chamber bound

P4_PC is capped at a 5% window reduction per correct answer, and reduction **halts entirely**
if rolling accuracy is below 98%. The APE caps escalation here; it does not guarantee failure.

---

## 7. The five hidden metrics

| Metric | Formula | Direction |
|---|---|---|
| **Precision Index (PI)** | `Σ correct_chars / Σ counted_chars × 100` | higher better |
| **Reflex Latency (RL)** | `mean_latency / candidate's OWN baseline × 100` | **lower better** |
| **Retention Density (RD)** | `(fresh × 1 + delayed × 2) / 3` | higher better |
| **Vocal Clarity Delta (VC)** | `clarity_current − baseline_vocal_clarity` | higher better |
| **Pattern Intuition (PTI)** | correct eligible slot-items / eligible × 100 | higher better |

**RD weights 24-hour-delayed recall double.** Same-session recall measures short-term buffer;
delayed recall measures learning. The metric is flagged `rd_provisional` while no delayed data
exists yet.

**RL is always a percentage of the candidate's own baseline**, never raw milliseconds — a fast
candidate and a slow one are both judged against themselves.

**PTI only draws from P1_VD and P3_SSM**, the two slot-substitution modules, and **excludes
items whose slot category is currently locked** — otherwise the engine would penalise a
candidate for content they are actively being remediated on.

**Baseline immutability** is the core invariant. `applyFailureTierToStats` is a deliberate
no-op that exists purely to make the invariant auditable rather than implied. The only sanctioned
downward path requires a **strictly monotonic three-session decline** *and* a negative fitted
slope, and is then clamped to the calibration floor.

**Averaging:** PI, RL, PTI and VC are averaged across the window's sessions so one session
cannot zero the dashboard or fake mastery. RD uses the delayed-weighted pool directly.

---

## 8. Error taxonomy and feedback protocol

### 6 error tags

| Tag | Meaning |
|---|---|
| `ACCEPTED` | Target met within threshold. Stat incremented. |
| `LATENCY_FAIL` | Correct but outside threshold. **No accuracy penalty**; RL only. |
| `PATTERN_MISMATCH` | Wrong syntax/word choice. Category + expected shown. |
| `TYPO_DETECTED` | Orthographic error at speed. **Position flagged, not the word retyped.** |
| `STRUCTURAL_LOCK_TRIGGERED` | 4th recurrence. Remediation scheduled, shown **once**. |
| `STREAK_TERMINATED` | Daily threshold missed. Rank progress reduced. |

**Correct-but-slow is not a failure.** It is `LATENCY_FAIL` with `correct: true`, and it never
cuts a stat. This is the single most consequential grading decision in the system.

The raw format is one line, one tag, no prose, no encouragement, no positive framing — for
example `[PATTERN_MISMATCH: third_person_s] input="he run" expected="he runs" → RETRY IN 3s`.
The countdown is suppressed on repeat occurrences.

### 30 error categories

Spanning tense markers, voice/third-person/article/plural agreement, prepositions, **5
homophone pairs**, lexical selection, 4 syntax constructions, **4 slot-substitution slots**,
anomaly detection, sequence ordering, 3 scene-binding errors, phoneme substitution, consonant
clusters, clarity deficit, spelling, and hesitation onset.

### Two-layer copy separation

The raw tag and category are what get written to the database and shown to the teacher. A
separate plain-language map is what the candidate reads — one short line, never more than one
sentence. Ranks and modules are likewise mapped ("RANK 03: DECODER" → "Level 3: Decoder").

A Structural Lock renders as *"We are spending extra time on this topic — that is normal, keep
going."* The diagnostic stays silent; the candidate is reassured without being told anything
diagnostic.

---

## 9. Ranks

Ordered weakest-first (note the inverse numbering):

| Rank | Requirement |
|---|---|
| RANK 03: DECODER | Starting rank. Always assigned at calibration. |
| RANK 02: OPERATOR | 3-consecutive-session escalation trigger met on **all** Phase 1 modules |
| RANK 01: STRIKER | Phase 2+3 escalation triggers met **and** zero active locks for 14 consecutive days |
| RANK 00: MASTER | ≥ 98% mean across a 30-day rolling window, ≥ 10 sessions, floor ≥ 95% |

Promotion only — there is no demotion path. A documented past bug (`slice(0, currentIndex)`)
would have found only demotions; the current code searches the ranks above and returns the
**strongest** satisfied one.

---

## 10. Daily schedule

Five blocks totalling exactly 45 minutes:

| Block | Base |
|---|---|
| VOCAL | 5 min |
| VECTOR | 10 min |
| DICTATION | 15 min |
| VISUOSPATIAL | 12 min |
| LOGGING | 3 min (immovable) |

Blocks owning an active Structural Lock gain **+5 min**, capped at doubling their base, then
the total is rebalanced to 45:00 by draining in priority order (DICTATION → VISUOSPATIAL →
VECTOR → VOCAL), never below a 2-minute floor and never giving more than 2 minutes back per
block per pass.

**The candidate is never told which block was extended.** That is written into the schedule's
own notes — remediation routing is deliberately invisible.

The smoke suite sweeps all **2⁵ = 32** combinations of simultaneous locks and asserts
`total_s === 2700` with no block under 120 s in every case.

---

## 11. Content library

| Bank | Count | Detail |
|---|---|---|
| Vocabulary | **816 words** (812 unique) | 12 bands, frequency-ranked V1 (50 words) → V12 (68) |
| Syntax tasks | **48** | 8 levels × exactly 6, 3 options each, 48 unique constructions |
| Pattern items | **44** | 29 unique confusable pairs, band-gated V1–V6 |
| Slot items | **12** | 4 slot categories |
| Scenes | **10** | 36 actions, 30 distractors, 27 actors |
| Dictation | **36** + 12 aural probes | 16 typo-mode, 20 pattern-mode, 12 WPM rungs (70→340) |
| Microtexts | **10** | 30 sentences, 40 flowchart steps, 40 options |
| Streams | **12** | 156 tokens, each with an injected anomaly |
| Vocal passages | **10** | 5 tier-1, 5 tier-2; 35 targets, 19 hesitation targets |
| Burst groups | **15** phoneme classes | 132 tokens |
| **Total discrete records** | **~230** | |

**Deterministic generation.** Sessions are seeded by `FNV-1a(candidate_id | module_id |
session_index)` feeding **mulberry32**. A rebuilt drill for the same inputs is byte-identical,
which is a correctness requirement — it is what guarantees item sets never silently duplicate
within a window. Smoke-tested: same inputs → identical JSON; different session index → different
items; no duplicate `item_id`s.

`takeRepeatable` draws exactly the requested count, re-shuffling and never repeating a key
back-to-back, releasing the seen-set when the pool is exhausted — so a session is **never
silently shortened** even when a V1 candidate is served 22 items from a 14-item pool.

**Vocal exclusions.** A phoneme class under active remediation is stripped from
`hesitation_targets` and recorded in `excluded_from_scoring`, so a candidate is never failed on
a sound they are actively being remediated on.

---

## 12. Data model — 19 tables

| Group | Tables |
|---|---|
| Candidate state | `candidates`, `pcp`, `calibration_passes`, `metrics`, `metric_floors` |
| Sessions | `sessions`, `session_attempts`, `session_items` |
| Adaptation | `rolling_windows`, `error_counters`, `structural_locks` |
| Progression | `streaks`, `daily_log`, `rank_history`, `pending_remediation`, `metric_history` |
| Auth | `users`, `auth_sessions` |
| Archive | `exercise_attempts` |

16 indexes, including a functional unique index on `lower(email)` for case-insensitive
uniqueness. `GENERATED BY DEFAULT AS IDENTITY` (never `ALWAYS`, which would block explicit id
inserts). `CREATE TABLE IF NOT EXISTS` throughout, so migration is idempotent.

`exercise_attempts` is the **append-only archive** — the teacher dashboards read from it and
nothing ever updates or deletes a row. It stores the raw prompt shown, the answer given, the
correct answer, the error tag, and `hidden_metrics_delta` recording which metric the attempt fed
and by how much.

**A candidate user's id IS their candidate_id**, so the whole calibration/APE/metrics engine is
reused with no key remapping. An admin has no candidates row and therefore no track.

### Deliberate dialect choices
- **JSON stored as TEXT, not JSONB** — so no value is silently reordered or reformatted in transit.
- **Booleans as INTEGER 0/1** — matching how the engine already read and wrote them.
- **Timestamps as ISO TEXT** — with explicit `::timestamptz` casts only where arithmetic is needed.
- **No CHECK constraints, ENUMs, triggers or views** — enforced in application code.
- The rolling-window column is named `window_json` because `WINDOW` is reserved in Postgres.

---

## 13. API surface — 34 handlers, 23 GET

| Group | Endpoints |
|---|---|
| Auth | `GET/PATCH /api/auth/me`, `POST /api/auth/{signup,signin,signout}` |
| Candidate data | `GET /api/{dashboard,onboarding,practice,history,stats}` |
| Session-scoped | `GET /api/{calibration,calibration/battery,calibration/probe,profile,schedule,session/next}` |
| Writes | `POST /api/calibration/passes`, `POST /api/calibration/finalise`, `POST /api/session` |
| Teacher | `GET /api/teacher/candidates`, `GET /api/teacher/candidates/:id` |
| Meta | `GET /api/meta` (public) |
| Legacy mirrors | `/api/candidates/:id/{daily-log,windows,locks}` + the 9 session routes |

Auth: scrypt password hashing (`scrypt$N$salt$key`), SHA-256-hashed session tokens (the raw
token is never stored), httpOnly cookies, role-based authorisation with candidates unable to
read each other's data and unable to reach any teacher route.

The e2e suite walks the **live Express router stack**, reflecting mount prefixes out of the
route regexes, then hits every discovered GET as both a candidate and an admin, failing on any
5xx or on error-shaped bodies. This exists because `/api/history` and `/api/stats` once shipped
with latent 500s (a nonexistent `created_at` column; `AVG()` arriving as a string) that neither
suite caught.

---

## 14. Web client

Seven screens plus auth, with a Zustand store whose `view` field is the entire navigation state
machine. No router library.

| Screen | Purpose |
|---|---|
| **Auth** | Sign in / create account. Registration tab hides entirely on fixed-account deployments. |
| **Onboarding** | The 5×2 calibration wizard. Untimed pass has no timer; timed pass does. |
| **Home** | Single today CTA, level + progress, streak, heatmap. |
| **Practice** | Nine module cards with rank gates, session counts, accuracy bars. |
| **SessionRunner** | Item presentation, mic capture, live feedback, deadline auto-commit, summary. |
| **Progress** | Heatmap, metric trends, per-module breakdown, green/red split, strengths/weaknesses, rank timeline. |
| **History** | Paged, expandable log of every session with its full per-attempt record. |
| **Teacher** | Observer roster → per-candidate diagnostic record with 4 tabs. |

Client grading mirrors the server taxonomy for instant feedback, but **the server recomputes
every attempt on submit and is authoritative**.

Speech uses the Web Speech API for playback and `getUserMedia` for mic capture, with graceful
degradation to typing. Typo detection uses word-count check → single-divergence check →
Levenshtein ≤ 1, so a one-character slip inside an otherwise correct utterance is a TYPO rather
than a wrong word.

Charts: `Heatmap`, `MetricTrendChart`, `ModuleBreakdownChart`, `GreenRedPie`, `StatsCharts`.
Bundle is split into `charts` / `react` / `vendor` / `index` chunks with sourcemaps.

---

## 15. Glicko-2 rating system *(new — implemented, not yet wired)*

Replaces the fixed per-module multipliers (0.93 / 1.0 / 1.08) over a rolling window. Those
were a step function: they ignored how far the candidate sat from the content, so someone far
below a band was nudged up as hard as someone on it.

`server/src/core/glicko.ts` implements a pure, dependency-free Glicko-2 engine carrying a
**rating, deviation and volatility** per candidate per module. It includes the structural-lock
RD floor (120) the spec requires, outcome→score mapping, confidence bands (RD <100 high,
100–200 medium, >200 low), closest-rating item selection with ties breaking toward easier, and
a confidence-aware difficulty step.

**Validated against Glickman's published worked example.** Pinning it caught three real errors
in the first draft, all of which produced plausible-looking but wrong numbers:

| Bug | Was | Correct |
|---|---|---|
| Variance reciprocal | `v = 1/(1 + Σ)` | `v = 1/Σ` |
| Deviation update | `φ' = √(φ² + σ'²)` | `φ' = 1/√(1/(φ²+σ'²) + 1/v)` |
| Volatility prior | omitted entirely | `−(x − ln σ²)/τ²` included |

Without the τ prior the volatility diverges and drags the deviation with it. The canonical
vector `(1500, 200, 0.06)` vs `(1400/30 W, 1550/100 L, 1700/300 L)` now reproduces
`1464.06 / 151.52 / 0.059996` (the paper's own rounding makes 1464.05 equally defensible).

**29 unit tests**, covering the canonical vector, direction of travel, confidence behaviour,
the lock floor, purity/determinism/order-independence, hostile input, volatility bounds, and
three **simulation-convergence** tests that play a known true ability (1100 / 1500 / 1900)
against a spread of content and land within 11–33 points after 400 sessions.

Two of my own test expectations were wrong rather than the code, and are recorded in the commit
message because they are the kind of thing that silently rots:
- Empty results legitimately **widen** the deviation; the invariant that matters is
  one-directional — absence must never *narrow* confidence.
- The simulation's generator injected draws as `P(0.5) = (1−p)/2`, making a total loss score
  0.25 instead of 0. Measured against that model the estimator looks 180–290 points biased.

---

## 16. Test & verification infrastructure

| Suite | Count | Runtime | Coverage |
|---|---|---|---|
| **Unit** | 29 | ~0.15 s | Glicko-2 engine, pure |
| **Smoke** | 117 checks / 15 sections | ~10 s | Full engine against a real database |
| **E2E** | 60 checks | ~60 s | Every HTTP route, auth, isolation, archive |
| **Playwright** | 2 specs | ~60 s | Real browser onboarding flow |
| **Promise audit** | 91 async fns / 50 files | ~1 s | Discarded-promise detection |
| **Typecheck** | 3 projects | ~10 s | server, web, api entry |

`npm run verify` = typecheck → **unit tests** → promise audit → production build.

Smoke sections: calibration hard gate, PCP, factor selection, escalation, structural locks,
error protocol, session flow, phase gating, failure tiers, metrics, Pressure Chamber bound,
deterministic generation, candidate independence, daily schedule, and **16 named regression
guards** for defects found during the build.

The floating-promise auditor exists because the Postgres port turned many functions `async`, and
TypeScript cannot catch a dropped Promise. It parses the source with a hand-rolled scanner that
tracks string and comment literals, so `name(` inside prose is not a false positive, and skips
`await`/`return`/`void`/`Promise.all`/assignment positions.

### Database safety

Two independent guards, because the e2e and Playwright suites run against a real database:

1. **Namespace guard** — fixture cleanup throws before running any SQL if a candidate id does
   not start with `smoke-`. This exists because the fixtures *used to* be the real production
   ids `billi` and `anik`.
2. **Name-pattern guard** — a full `TRUNCATE` only runs against a database whose name contains
   test/tests/smoke/ci. A production database named `forge` or `neondb` cannot be truncated by
   a mistyped `DATABASE_URL`.

---

## 17. Optimisations and hardening *(much of this was not explicitly asked for)*

**Postgres port engineering**
- `AsyncLocalStorage` pins a single client per transaction, so nested repository calls join the
  open transaction instead of escaping to the pool.
- A central `?` → `$n` positional rewriter, so the repository layer stays dialect-agnostic.
- A `node:sqlite`-shaped compatibility interface, which is why the port touched 37 files but
  left every SQL statement readable.
- Type parsers registered for `int8` and `numeric` — without them every `COUNT(*)`/`AVG()`
  arrives as a string and `Number(x.toFixed(2))` throws.
- A hand-written SQL statement splitter that understands line comments, nestable block
  comments, string literals, quoted identifiers and dollar-quoting. `split(';')` shipped English
  prose to the server, because the schema's own `--` comments contain semicolons.
- Idempotent migration that swallows only three specific Postgres error codes (duplicate table,
  duplicate object, undefined table) and rethrows everything else.
- `GREATEST(0, n − 1)` instead of SQLite's two-argument `MAX()`, which has no Postgres equivalent.
- Date windows computed in JS because SQLite's `datetime('now', '-7 days')` does not exist here.

**Client performance**
- Vite `manualChunks` splitting charts / React / vendor, so the 352 kB charting library is not
  in the main bundle and is cached independently.
- Sourcemaps enabled in production.
- Dev server pinned to `127.0.0.1` because on Windows `localhost` resolves to `::1` only and
  silently broke local API probes.
- Same-origin `/api` proxy in dev, so the httpOnly cookie needs no CORS at all.
- Playwright uses ports 5193/5194, deliberately off the dev ports, so a suite can never collide
  with a running dev server.

**Reliability**
- Deterministic seeded generation throughout, so any drill is reproducible.
- `ensureReady()` memoises migration per cold start **and clears the memo on failure**, so a
  transient database outage does not poison a warm instance.
- Playwright timeouts are set from a measured ~270 ms India→Neon `us-east-2` RTT, so a slow
  network is not misread as a broken flow.
- Fixed accounts converge to the environment on every cold start — a rotated password takes
  effect, a superseded one stops working, and rotation invalidates existing sessions.

---

## 18. Bugs found and fixed

| Bug | Impact | Status |
|---|---|---|
| **Drill-kind drift** — the web `DrillItem` union carried 5 kinds the server never emits and was missing 2 it does | `expectedOf()` returned `''` for dictation/pressure, so those items scored a guaranteed 0% as `PATTERN_MISMATCH`. Wrote **20 phantom remediation rows** and **2 structural locks** on the live database | Code fixed & deployed (`943c9bc`). **Database rows still need cleanup.** |
| **Glicko variance / deviation / volatility** (3 bugs) | Ratings would have run away — simulated 1500 → −394 | Fixed, canonical-vector tested (`a794485`) |
| `/api/history` nonexistent `created_at` column | Latent 500 | Fixed |
| `/api/stats` `AVG()` returned as string | Latent 500 | Fixed |
| Fixed accounts not converging on cold start | Stale credentials in the deployed environment | Fixed (`8fb2292`) |
| Onboarding "Start" hit the PCP-gated drill route → 423, stored in an unrendered field, looked inert | Calibration appeared broken | Fixed; Playwright now asserts zero calls to the retired route |
| Session submit not enforcing the phase gate | A client could post Phase-4 work without the rank | Gate now enforced on submit, not just on plan |

---

## 19. Known gaps — not yet done

**Sections 14–15 remain outstanding:**
- The single daily routine CTA. Architecture is decided (option **b**: per-module sessions run
  back-to-back behind one button, preserving the existing sessions / attempts / APE / locks data
  model rather than inventing a parallel one) but nothing is implemented.
- Glicko rating persistence — schema, per-session updates, band-derived item ratings,
  lock-elevated RD, confidence-aware difficulty limits. The engine exists; nothing calls it.
- Candidate module/difficulty choice has not been removed from the Practice screen.
- Teacher "Control point" still renders raw key/value pairs; the spec wants readable fields plus
  a Rating & Confidence table.
- Production data reset for the two fixed accounts (fake calibration, sessions, attempts, locks,
  remediation, rolling windows, rank state, ratings) — **not executed, awaiting approval**.

**Known defects, found during this audit and not yet fixed:**

| Issue | Detail |
|---|---|
| **Practice gates read the wrong field** | `g.id` instead of `g.module_id`, so all module cards render as locked regardless of rank. **This is the next thing to fix.** |
| **`modules_failed` round-trip mismatch** | Written as `JSON.stringify(array)`, read with `.split(',')` — so failed modules come back as `["P1_VD"]` with literal brackets and quotes |
| **`created_at` is wrong in the profile** | A helper ignores its argument and returns today's date instead of the candidate's real creation date |
| **Errors are silently invisible** | The store's `fault` field is set by ~8 call sites but **no screen renders it** — API failures produce no user-visible message |
| **`excluded_from_scoring` is computed and never read** | Declared, populated for 2 modules, consumed by nothing |
| **`syntax` drill kind never emitted** | In the type union, but no module constructs one — only calibration uses those tasks |
| **Dead client surface** | `updateProfile`, `meta`, `calibrationStatus`, `calibrationBattery` are never called; `profile` and `lastResult` are fetched/stored and never read; `clearFault` is never called |
| **Unused declarations** | `IMPROVEMENT_SESSIONS_REQUIRED`, `canUnlockPhase`'s `phase` argument, `deriveFloorsFromCalibration`'s two parameters, `AdjustmentLogEntry.reason: 'CLAMPED'`, `date-fns` as a dependency |
| **Test isolation is still unsafe** | e2e and Playwright run against whatever `DATABASE_URL` points at. The guards prevent catastrophic truncation, but they do not prevent test rows landing in production |
| **`.gitignore` gap** | Only `.env` and `.env.local` are ignored — a `.env.production` would be committed |
| **Named-constant collision** | `CALIBRATION_MANIFEST` exists in both `calibration.ts` (5 vectors) and `calibrationCopy.ts` (a version string) with unrelated shapes |

---

## 20. Deployment

| | |
|---|---|
| Host | Vercel (project `the-forge`, auto-deploy from `main`) |
| Build | `npm run build` → `tsc -b && vite build` |
| Output | `web/dist` |
| Function | `api/index.ts`, 30 s max duration |
| Routes | `/api/(.*)` → function; `/(.*)` → `index.html` (SPA) |
| Database | Neon Postgres, pooled, max 8 connections |
| Env | `DATABASE_URL` (or `POSTGRES_URL`), `PORT`, `HOST`, `SEED_DEMO`, `FIXED_ACCOUNTS` |

Per-deployment preview URLs are behind Vercel login; the public alias is the working URL.
Credentials live in an environment-only file outside the repository and are untracked.
