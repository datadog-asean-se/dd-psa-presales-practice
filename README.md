# Datadog Presales Practice Simulator

![DPN Presales Practice Simulator](assets/dpn_presales_practice.png)

An AI-powered practice simulator for Datadog DPN presales engineers to sharpen their skills through realistic customer meeting simulations and coaching quizzes — before the real thing.

Built with **Next.js 16**, **Google Gemini**, and full **Datadog observability** (APM, RUM, LLM Observability). Deployed on **Google Cloud Run** with a two-container architecture.

---

## Exercises

| # | Exercise | Type |
|---|---|---|
| 1 | **Objective 1: Scope the Initial POV** — Discovery conversations to scope a POV for M-Pay | Meeting Room Simulation |
| 2 | **Objective 2: Scope Creep Challenge** — Handle a curveball mid-evaluation without derailing the POV | Meeting Room Simulation |
| 3 | **Technical Fit Qualification** — Practice qualifying prospects using the 7 Signs of Technical Fit | Coaching Quiz |
| 4 | **Value Selling Practice** — Practice the value-selling sequence end-to-end | Coaching Quiz |

**Features:**
- Realistic customer persona simulation with natural pushback and tangents
- Multi-language support (English, Japanese, Korean, Thai, Spanish, Vietnamese, French, German, Chinese)
- Multiple Gemini models (2.5 Pro, 2.5 Flash, 3.1 Pro with Deep Thinking)
- Structured debrief at end of each session — continue the conversation after the debrief
- Export session transcript as Markdown

---

## Architecture

```
Internet
    │
    ▼
nginx-container (port 8080)       ← AI Studio proxy, receives external traffic
    │  forwards to localhost:3000
    ▼
app-container (port 3000)         ← Next.js app (this repo)
    │
    ├── /api/chat                  ← Streaming API route → Gemini API (server-side)
    ├── dd-trace (APM + LLM Obs)   ← Server-side observability
    └── Datadog Browser RUM        ← Client-side observability
```

Both containers run as a **Cloud Run multi-container (sidecar) service**. API keys are never baked into images — they are injected at runtime from **GCP Secret Manager**.

---

## Local Development

### Prerequisites

- Node.js 22+
- A [Google Gemini API key](https://aistudio.google.com/apikey)
- A Datadog API key (optional — app works without it locally)

### Setup

```bash
# 1. Clone the repo
git clone https://github.com/datadog-asean-se/dd-psa-presales-practice.git
cd dd-psa-presales-practice

# 2. Install dependencies
npm install

# 3. Set environment variables
cp .env.example .env
# Edit .env — set GEMINI_API_KEY (required) and optionally DD_API_KEY + RUM tokens

# 4. Start the dev server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### Environment Variables

Copy `.env.example` to `.env` and fill in the values for your environment:

```bash
cp .env.example .env
```

> `.env` is git-ignored. Never commit real secrets.

#### GCP / Cloud Run deployment target

These variables control where `deploy.sh` builds and deploys the Cloud Run service. Not needed for local development.

| Variable | Default | Description |
|---|---|---|
| `GCP_PROJECT_ID` | *(required)* | GCP project to deploy into |
| `GCP_REGION` | `us-west1` | Cloud Run region |
| `CR_SERVICE_NAME` | `datadog-presales-practice-simulator` | Cloud Run service name |
| `ARTIFACT_REPO` | `cloud-run-source-deploy` | Artifact Registry repository name (created automatically if missing) |

#### Application

| Variable | Default | Description |
|---|---|---|
| `APP_URL` | *(auto-derived from project number + region)* | Public URL of the deployed service. Leave blank — `deploy.sh` derives it automatically. |
| `APPLET_ID` | *(required)* | AI Studio applet ID used by the nginx sidecar container — create your own at [aistudio.google.com](https://aistudio.google.com) |

#### Datadog

| Variable | Default | Description |
|---|---|---|
| `DD_ENV` | `prod` | Datadog environment tag applied to all APM spans, logs, and RUM sessions |

#### API keys

These are only needed when running **locally** (`npm run dev`). In Cloud Run they are injected at runtime from **GCP Secret Manager** and do not need to be set here.

| Variable | Required locally | Description |
|---|---|---|
| `GEMINI_API_KEY` | **Yes** | Google Gemini API key — get one at [aistudio.google.com/apikey](https://aistudio.google.com/apikey). Server-side only; never exposed to the browser. |
| `DD_API_KEY` | No | Datadog API key for APM and LLM Observability. App works without it locally; traces will simply not be sent. |

#### Datadog RUM tokens

These are **browser-safe write-only tokens** — they are baked into the client bundle and it is safe to expose them. Find them in **Datadog → UX Monitoring → RUM Applications → your app → Setup**.

| Variable | Required | Description |
|---|---|---|
| `DD_RUM_APP_ID` | No | RUM Application ID. Without it, session replays and RUM data will not be sent. |
| `DD_RUM_CLIENT_TOKEN` | No | RUM Client Token. |

---

## Deployment (Cloud Run)

### Prerequisites

- [Docker](https://docs.docker.com/get-docker/) with `linux/amd64` support  
  (Apple Silicon: `docker buildx install`)
- [gcloud CLI](https://cloud.google.com/sdk/docs/install) authenticated: `gcloud auth login`
- GCP secrets created in Secret Manager:
  - `GEMINI_API_KEY`
  - `DD_API_KEY`
- Compute service account has `roles/secretmanager.secretAccessor` on both secrets

### Deploy

```bash
bash deploy.sh
```

The script will:
1. Resolve the GCP project number automatically via `gcloud projects list`
2. Enable required GCP APIs
3. Build a `linux/amd64` Docker image tagged with the git SHA + timestamp
4. Push the image to Artifact Registry
5. Render `service.yaml` with the image tag, project number, and all runtime values
6. Deploy via `gcloud run services replace` (required for multi-container)

**Optional overrides via environment variables or `.env`:**

```bash
DD_ENV=staging APP_URL=https://my-custom-url.run.app bash deploy.sh
```

> The deployed service URL follows the pattern:  
> `https://<CR_SERVICE_NAME>-<GCP_PROJECT_NUMBER>.<GCP_REGION>.run.app`

---

## Testing

```bash
# Run all tests once (CI mode)
npm test

# Watch mode (re-runs on file change)
npm run test:watch

# With coverage report
npm run test:coverage
```

**74 tests across 4 suites:**

| Suite | What's covered |
|---|---|
| `src/lib/__tests__/utils.test.ts` | `cn()` utility: class merging, conditionals, Tailwind conflict resolution |
| `src/services/__tests__/geminiService.test.ts` | `classifyGeminiError()` and `isRetryableGeminiError()` for all Gemini error codes |
| `src/services/__tests__/chatClient.test.ts` | Stream chunk delivery, null-byte error sentinel → thrown `Error`, request body shape |
| `src/app/api/chat/__tests__/route.test.ts` | All input validation rules (exerciseId, modelId, language, messages, teamName, sessionId), boundary values, happy-path streaming |

---

## Datadog Observability

The app is fully instrumented out of the box.

| Signal | What's collected |
|---|---|
| **APM** | All Next.js API routes, Gemini API call spans, retry attempts |
| **LLM Observability** | Every Gemini call tracked as an LLM span with prompt template, input/output, model name, session ID |
| **RUM** | Full session replay, page load, user actions, APM–RUM correlation |
| **Logs** | Structured JSON logs via Winston, injected with trace/span IDs |

**LLM Observability span hierarchy:**

```
task: exercise.debrief          (debrief only — enables independent evaluation)
  └── llm: exercise.debrief     (the actual Gemini call)
  
llm: gemini.generateContent     (regular chat turns)
```

Every span is tagged with `team_name`, `practice_name`, `exercise_id`, `language`, and linked to the RUM session via `sessionId`.

---

## Project Structure

```
├── src/
│   ├── app/
│   │   ├── api/chat/
│   │   │   ├── route.ts            # POST /api/chat — validates input, streams Gemini response
│   │   │   └── __tests__/
│   │   │       └── route.test.ts   # Input validation tests
│   │   ├── page.tsx                # Main chat UI (client component)
│   │   ├── layout.tsx
│   │   └── globals.css
│   ├── services/
│   │   ├── geminiService.ts        # Gemini API client, retry logic, LLMObs spans
│   │   ├── chatClient.ts           # Browser-side fetch wrapper for /api/chat
│   │   └── __tests__/
│   │       ├── geminiService.test.ts
│   │       └── chatClient.test.ts
│   ├── constants/
│   │   └── knowledge.ts            # Customer profile, exercise reference data
│   ├── lib/
│   │   ├── llmobs.ts               # dd-trace LLM Observability re-export
│   │   ├── logger.ts               # Winston structured logger
│   │   ├── utils.ts                # cn() (clsx + tailwind-merge)
│   │   └── __tests__/
│   │       └── utils.test.ts
│   ├── instrumentation.ts          # dd-trace init (Next.js instrumentation hook)
│   └── types.ts                    # Shared types, EXERCISES, AI_MODELS, LANGUAGES
├── Dockerfile                      # Multi-stage build (deps → builder → runner)
├── service.yaml                    # Cloud Run Knative service definition (template)
├── deploy.sh                       # Build + push + deploy script
├── vitest.config.ts                # Vitest test runner config
├── next.config.mjs
└── .env.example
```

---

## Key Implementation Notes

### Streaming & Error Handling

- The API route streams Gemini responses as plain text chunks via `ReadableStream`
- On error, a null-byte sentinel (`\x00<message>`) is enqueued and the stream is closed cleanly — preventing the AI Studio nginx proxy from returning a 502 Bad Gateway
- The client (`chatClient.ts`) detects the sentinel and throws it as an `Error` so the UI shows a friendly `⚠️` message
- Gemini 503/overloaded/rate-limit errors are automatically retried up to 3 times with exponential backoff (1.5s → 3s → 6s + up to 1s jitter), but only if no chunks have been streamed yet

### Input Validation

All user-controlled fields in `POST /api/chat` are validated against allowlists before reaching the Gemini service layer:

- `exerciseId`, `modelId`, and `language` are validated against the `EXERCISES`, `AI_MODELS`, and `LANGUAGES` arrays in `src/types.ts`
- Adding a new exercise/model/language automatically expands the allowlist — no changes needed in `route.ts`
- `messages` is bounded at 200 items; `teamName` at 80 chars; `sessionId` at 128 chars

### Cloud Run Scaling

```yaml
minScale: 1          # Always-on: no cold starts
maxScale: 30         # Handles concurrent users during group sessions
containerConcurrency: 160
timeoutSeconds: 600  # Long timeout for extended LLM conversations
```

### Commit Signing

Commits to this repo require GPG-verified signatures. Ensure `commit.gpgsign = true` is set and `pinentry-mac` is configured:

```bash
brew install pinentry-mac
echo "pinentry-program $(which pinentry-mac)" >> ~/.gnupg/gpg-agent.conf
gpgconf --kill gpg-agent
git config --global commit.gpgsign true
```

---

## Datadog LLM-as-a-Judge Evaluation: `practice-scoring`

This evaluation automatically scores each debrief using GPT-4o as a judge. It reads the `exercise.debrief` span output and produces a **0–1000 final score** weighted by topic coverage.

Reference: [Datadog Custom LLM-as-a-Judge Evaluations](https://docs.datadoghq.com/llm_observability/evaluations/custom_llm_as_a_judge_evaluations/?tab=boolean)

### Setup in Datadog

Navigate to **LLM Observability → Evaluations → Create Evaluation → Create your own** and configure as follows.

| Field | Value |
|---|---|
| **Name** | `practice-scoring` |
| **Model** | GPT-4o |
| **Application** | `presales-practice-simulator` |
| **Evaluate On** | All Spans |
| **Span Name Filter** | `exercise.debrief` |
| **Output Type** | Score (0–1000) |

### System Prompt

```
You are an evaluation engine. Your job is to evaluate the user's practice performance using ONLY the provided AI Coach Debrief and Session Summary text.

INPUTS
- You will receive a single variable:
  - span_output: the "AI Coach Debrief and Session Summary" text

SCOPE AND EVIDENCE RULES
- Use ONLY evidence explicitly stated in span_output.
- Do NOT assume missing behaviors occurred.
- Do NOT invent extra context, dialogue, metrics, or outcomes.
- If something is not mentioned, treat it as NOT demonstrated.

GOAL
- Produce a conservative performance evaluation with a numeric score and clear reasoning.
- Apply topic coverage weighting so partial sessions cannot score high.

OPEN TOPICS (NOT A FIXED LIST)
- Topics are open-set labels you extract from span_output (short names).
- A topic counts as "covered" ONLY if the span_output indicates it was practiced or meaningfully discussed with evidence (not merely named in passing).
- Deduplicate topics: topics_covered must not include duplicates; keep one instance per topic label.
- topic_scores must include at most one entry per topic label.

TOPIC COVERAGE SOURCE OF TRUTH
1.  If span_output explicitly contains a coverage ratio in the form X/Y (examples: "2/6", "3/8", "หัวข้อที่ได้ฝึกฝน: 2/6"):
    -   Set topics_covered_count = X
    -   Set topics_total = Y
    -   Set coverage_ratio = X / Y
    -   Do NOT override these values with your own estimate.
    -   topics_covered list should still be extracted from the text (deduplicated), but the numeric coverage must match X/Y.

2.  If span_output does NOT include X/Y:
    -   Infer topics_covered by extracting distinct topics that were clearly practiced.
    -   Set topics_covered_count = number of extracted topics (after dedup).
    -   Set topics_total using a conservative default baseline of 6:
        -   topics_total = max(6, topics_covered_count)
    -   coverage_ratio = topics_covered_count / topics_total

SCORING OVERVIEW (0–1000)
You must compute two scores:
1.  raw_score (0–1000): quality score for what was demonstrated within the session
2.  final_score = round(raw_score * coverage_ratio)

CONSERVATIVE RAW SCORE RULES
-   Be conservative. Missing depth or missing key elements must reduce raw_score.
-   Start from a modest baseline (e.g., 450–550) if the performance shows some strengths, then add small bonuses and apply clear penalties.
-   Prefer penalties over bonuses when gaps are identified.
-   Penalize especially when span_output explicitly says "needs improvement" or implies a key gap.

QUALITY DIMENSIONS (Use these to form raw_score)
Evaluate using evidence from span_output:
-   Structure and clarity: did the user drive a coherent sequence?
-   Question quality: open-ended, targeted, follow-up depth
-   Impact exploration: breadth and depth of business impact
-   Quantification: converting qualitative pain to numbers (if missing, penalize)
-   Value linkage: connecting pain → value/ROI narrative (if weak/missing, penalize)
-   Action orientation: next-step plan, commitments (if missing, penalize)
-   Coach feedback alignment: if coach calls out gaps, they must impact score

PENALTIES (MANDATORY WHEN APPLICABLE)
-   For each notable gap mentioned in span_output (or clearly absent), add a penalty item:
    -   penalties[].points must be negative (e.g., -30 to -200 depending on severity)
    -   penalties[].reason must reference what span_output indicates
        Examples of common penalties (apply only if supported by span_output):
-   Missing quantification (no numbers, no frequency, no counts)
-   Narrow impact exploration (e.g., only infra cost; missing people cost)
-   Shallow follow-up questions (stops early)
-   No mutual plan / next steps / timeline / stakeholders
-   Weak value narrative (problem not connected to outcomes)

TOPIC-LEVEL SCORING
-   Provide per-topic scores (0–1000) only for the topics you extracted.
-   For topics not covered (or only barely referenced), assign a low score (commonly 0–200).
-   Each topic_scores entry must include:
    -   topic: short label
    -   score: integer 0–1000
    -   evidence: 1–4 short bullet-like strings paraphrased from span_output

OUTPUT FORMAT (STRICT JSON ONLY)
-   You MUST return ONLY valid JSON matching the response schema named "content_evaluation_open_topics".
-   No markdown, no extra commentary, no leading/trailing text.
-   Fields must be internally consistent:
    -   coverage_ratio == topics_covered_count / topics_total
    -   final_score == round(raw_score * coverage_ratio)
    -   topics_covered_count and topics_total follow the coverage rules above
-   strengths and improvements must be short, actionable, and grounded in span_output.
-   reasoning must be concise and evidence-based.

REMINDER
-   Conservative scoring + mandatory topic coverage weighting is non-negotiable.
-   Use only what span_output provides as evidence.
-   Return JSON only.
```

### User Prompt

```
span_output: {{span_output}}
```

### Structured Output Schema

Output type: **Score (0–1000)**

```json
{
    "name": "score_eval",
    "schema": {
        "type": "object",
        "required": [
            "score_eval",
            "reasoning"
        ],
        "properties": {
            "reasoning": {
                "type": "string",
                "description": "Explain how the score was determined using ONLY evidence from span_output. Must (1) state whether an explicit topic coverage ratio X/Y was found and how it affected the final score via coverage_ratio, (2) summarize key observed strengths and key gaps, (3) mention the most important penalties applied (e.g., missing quantification, narrow impact), and (4) avoid assumptions or invented details. Keep it concise and actionable."
            },
            "score_eval": {
                "type": "number",
                "maximum": 1000,
                "minimum": 0,
                "description": "Topic coverage weighting rules:\n\nTOPIC COVERAGE SOURCE OF TRUTH\n1) If span_output explicitly contains a coverage ratio in the form X/Y (examples: \"2/6\", \"3/8\", \"หัวข้อที่ได้ฝึกฝน: 2/6\"):\n- Set topics_covered_count = X\n- Set topics_total = Y\n- Set coverage_ratio = X / Y\n- Do NOT override these values with your own estimate.\n- topics_covered list should still be extracted from the text (deduplicated), but the numeric coverage must match X/Y.\n\n2) If span_output does NOT include X/Y:\n- Infer topics_covered by extracting distinct topics that were clearly practiced.\n- Set topics_covered_count = number of extracted topics (after dedup).\n- Set topics_total using a conservative default baseline of 6:\n  - topics_total = max(6, topics_covered_count)\n- Set coverage_ratio = topics_covered_count / topics_total\n\nSCORING OVERVIEW (0–1000)\nYou must compute two scores:\n1) raw_score (0–1000): quality score for what was demonstrated within the session\n2) final_score = round(raw_score * coverage_ratio)\n\nCONSERVATIVE RAW SCORE RULES\n- Be conservative. Missing depth or missing key elements must reduce raw_score.\n- Start from a modest baseline (e.g., 450–550) if the performance shows some strengths, then add small bonuses and apply clear penalties.\n- Prefer penalties over bonuses when gaps are identified.\n- Penalize especially when span_output explicitly says \"needs improvement\" or implies a key gap.\n\nQUALITY DIMENSIONS (Use these to form raw_score)\nEvaluate using evidence from span_output:\n- Structure and clarity: did the user drive a coherent sequence?\n- Question quality: open-ended, targeted, follow-up depth\n- Impact exploration: breadth and depth of business impact\n- Quantification: converting qualitative pain to numbers (if missing, penalize)\n- Value linkage: connecting pain → value/ROI narrative (if weak/missing, penalize)\n- Action orientation: next-step plan, commitments (if missing, penalize)\n- Coach feedback alignment: if coach calls out gaps, they must impact score\n\nPENALTIES (MANDATORY WHEN APPLICABLE)\n- For each notable gap mentioned in span_output (or clearly absent), add a penalty item:\n  - penalties[].points must be negative (e.g., -30 to -200 depending on severity)\n  - penalties[].reason must reference what span_output indicates\nExamples of common penalties (apply only if supported by span_output):\n- Missing quantification (no numbers, no frequency, no counts)\n- Narrow impact exploration (e.g., only infra cost; missing people cost)\n- Shallow follow-up questions (stops early)\n- No mutual plan / next steps / timeline / stakeholders\n- Weak value narrative (problem not connected to outcomes)\n\nTOPIC-LEVEL SCORING\n- Provide per-topic scores (0–1000) only for the topics you extracted.\n- For topics not covered (or only barely referenced), assign a low score (commonly 0–200).\n- Each topic_scores entry must include:\n  - topic: short label\n  - score: integer 0–1000\n  - evidence: 1–4 short bullet-like strings paraphrased from span_output"
            }
        },
        "additionalProperties": false
    },
    "strict": true
}
```

### How the scoring works

```
final_score = round(raw_score × coverage_ratio)

coverage_ratio = topics_covered / topics_total
  → If the debrief includes an explicit "X/Y" ratio, that is used directly.
  → Otherwise, inferred from extracted topics with a conservative baseline of 6.

raw_score = quality score (0–1000) penalised for:
  - Missing quantification
  - Narrow impact exploration
  - Shallow follow-up questions
  - No next steps / mutual plan
  - Weak value narrative
```

Query results in LLM Observability with: `@evaluations.custom.practice-scoring`

---

## Datadog Dashboard: Presales Practice Leaderboard

The dashboard JSON is stored at [`dashboards/presales-practice-leaderboard.json`](dashboards/presales-practice-leaderboard.json).

### Sections

| Section | Description |
|---|---|
| **DPN - Presales Practice Leaderboard** | Top scoring team table grouped by `practice_name` and `team_name`, ranked by max `practice-scoring` evaluation |
| **LLM Observability** | Event stream of all `exercise.debrief` spans with score, duration, and output |
| **User Analytics** | Messages per session, average session length, error rate per session, input/output sentiment trends |
| **Custom Evals** | Score and categorical custom evaluation timeseries charts |
| **Quality Evaluations** | Out-of-the-box evaluations: Topic Relevancy, Failure to Answer, Language Mismatch, Toxicity, Hallucination |

### Template Variables

| Variable | Facet | Default |
|---|---|---|
| `$team_name` | `team_name` | `*` (all teams) |
| `$practice_name` | `practice_name` | `*` (all exercises) |

### How to import

1. In Datadog, go to **Dashboards → New Dashboard → Import dashboard JSON**
2. Paste or upload the contents of `dashboards/presales-practice-leaderboard.json`
3. Click **Yes, Replace** to confirm

> **Note:** The leaderboard widget queries the `presales-practice-simulator` ml_app and requires the `practice-scoring` custom evaluation to be active (see section above).

---

## Contributing

1. Create a feature branch: `git checkout -b feat/your-feature`
2. Make changes
3. Type-check: `npm run lint`
4. Run tests: `npm test`
5. Commit with a signed commit: `git commit -S -m "your message"`
6. Push and open a PR against `main`

Direct pushes to `main` are blocked — all changes go through PRs.
