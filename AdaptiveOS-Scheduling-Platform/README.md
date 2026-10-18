# AdaptiveOS

> **A hands-on lab for exploring CPU scheduling.**

AdaptiveOS lets you build a workload, run several CPU scheduling policies against the same processes, and compare the results. Use generated, manual, or CSV workloads—or optionally collect a read-only snapshot from your own PC and turn observations into estimated simulation inputs. Save experiments, review them in Analytics, and choose whether to share selected results with the Community Hub.

## What you can do

| Workbench | Explore |
| --- | --- |
| **Build workloads** | Generate repeatable, seeded process sets; enter processes manually; import CSV; or derive an estimated workload from an optional PC snapshot. |
| **Compare schedulers** | Run FCFS, SJF, SRTF, non-preemptive Priority, and Round Robin on the same workload. Adjust the Round Robin quantum. |
| **Inspect results** | Review the Gantt-style timeline, per-process outcomes, and waiting, turnaround, response, and utilization metrics. |
| **Track experiments** | Save workloads and runs in PostgreSQL, browse run history, filter Analytics, and export results. |
| **Share and discuss** | Explicitly share a completed result, discuss community posts, and view or download scheduler source. Submit Python source for review. |
| **Observe your PC (optional)** | Run the local read-only agent to collect accessible process metadata and create estimated simulation inputs. |

**Typical workflow:** create or import a workload → compare scheduling policies → inspect and save results → optionally share a selected run.

## How to interpret results and data boundaries

- **This is a scheduling simulator and research workbench.** Metrics describe the modelled workload and scheduler run; they are not measurements of how quickly your operating system or hardware executes real processes.
- **PC monitoring is opt-in and read-only.** The separately started Python agent collects accessible process ID, name, creation time, status, observed CPU percentage, and memory usage. It does not change process priority or control the host operating system's scheduler.
- **Observed activity is not a CPU ready queue.** A snapshot cannot reveal exact future CPU bursts or the operating system's complete scheduling state. AdaptiveOS derives estimates for simulation; estimated inputs and modeled results should be treated as such.
- **Recommendations are rule-based.** The recommendation compares the five supported schedulers using the selected workload and objective. It is not an AI-generated summary or a trained prediction model.
- **Community algorithm submissions are source-only.** Submitted Python code is stored for review and can be viewed or downloaded; the server never executes it, and submissions are not plug-in schedulers or verified benchmarks.
- **Sharing is deliberate, but community posts are public.** A simulation enters the Community results feed only after an explicit share action. Algorithm submissions and discussion posts are visible to the community when submitted.
- **This build has no sign-in or per-user data isolation.** Workloads, runs, recommendations, and agent snapshots are stored at deployment level and are accessible through that deployment's API. Keep the service local or private until account-level authorization is added.

## Technology stack

AdaptiveOS is a **TypeScript and React web application backed by an Express API and PostgreSQL**. PC observation is provided by a separate, optional Python agent.

| Layer | Technologies and role |
| --- | --- |
| **Workspace and runtime** | pnpm workspace monorepo; Node.js 24; TypeScript 5.9. Shared packages hold the database schema, API contract, validators, and generated client. |
| **Web application** | React 19 with Vite 7 and TypeScript. Wouter handles page routing; TanStack Query manages API requests and cached data. Styling uses Tailwind CSS 4 alongside the app's custom CSS, with Radix UI primitives and Lucide icons. |
| **API server** | Express 5 on Node.js, written in TypeScript. It exposes JSON endpoints under `/api`, uses CORS for browser requests, and Pino for structured HTTP and server logs. |
| **API contract and types** | OpenAPI 3.1 defines the API. Orval generates the React Query hooks and Zod schemas used by the client and server, keeping request and response shapes aligned. |
| **Database** | PostgreSQL, accessed through `pg` and Drizzle ORM. Drizzle Kit applies the schema; persisted records include workloads, processes, snapshots, runs, recommendations, shared results, community submissions, discussions, and comments. |
| **Scheduling engine** | TypeScript implementations of FCFS, SJF, SRTF, non-preemptive Priority, and Round Robin run in the API server. |
| **Optional PC agent** | Python with `psutil`. The standalone, read-only script samples accessible process metadata and sends an opt-in snapshot to the API over HTTP. |
| **Build and tests** | Vite builds the web client; esbuild bundles the API. The project uses TypeScript checks, Node's built-in test runner for scheduler tests, and Python `unittest` for agent tests. |

**Request path:** React UI → generated, typed API client → Express JSON API → Drizzle ORM → PostgreSQL. When enabled, the Python agent sends its snapshot to the same API.

## Run in this workspace

This project uses the workspace's React/Vite client, Express API, and PostgreSQL database. Node.js 24 and pnpm are used by the development workspace.

```bash
pnpm install
pnpm --filter @workspace/db run push
```

Start the web client and API using the configured Replit workflows, or run them in separate terminals:

```bash
PORT=5000 pnpm --filter @workspace/api-server run dev
pnpm --filter @workspace/adaptiveos run dev
```

The API binds to `PORT`; its routes are under `/api`. The development server is not intended as a production server. The web client is served at the project root.

## Run locally on Windows

Install Node.js 24 and pnpm, clone this repository, then run the workspace setup above. Use the configured local PostgreSQL connection, or set a PostgreSQL `DATABASE_URL` for the API server before running the database push command. The web client and API need separate terminals.

In PowerShell, start the API on the same port used by the agent example:

```powershell
$env:PORT = "5000"
pnpm --filter @workspace/api-server run dev
```

To prepare the optional local agent:

```powershell
py -m venv .venv
.\.venv\Scripts\Activate.ps1
py -m pip install -r requirements.txt
```

If PowerShell blocks activation, run `py -m pip install -r requirements.txt` without activating the environment, or use Command Prompt:

```bat
.venv\Scripts\activate.bat
python -m pip install -r requirements.txt
```

Start the agent for a local backend:

```powershell
python agent.py --server-url http://127.0.0.1:5000 --interval 2
```

To sample repeatedly until stopped:

```powershell
python agent.py --server-url http://127.0.0.1:5000 --interval 2 --repeat
```

Press Ctrl+C to stop. `--no-upload` collects and prints a local summary without sending it. `--active-only` only changes the summary; the full accessible snapshot is still uploaded so the app can let the user choose which processes to include.

For a hosted server, pass its actual HTTPS origin, for example:

```powershell
python agent.py --server-url https://your-host.example --token YOUR_LOCAL_AGENT_TOKEN
```

The hosted server must be reachable from the PC. `localhost` on the PC refers to that PC, not to a remote web app. Set the same `AGENT_ACCESS_TOKEN` on the API server and the agent when using remote hosting. Production rejects agent snapshot uploads if this token is not configured. Do not expose an unauthenticated agent endpoint to the public internet.

## Explore the workbench

1. **Dashboard** — see database-backed counts, recent workloads and runs, agent status, and the latest recommendation.
2. **Simulator** — create or import a workload, compare supported policies, and inspect the timeline and per-process results.
3. **Analytics** — review saved runs, filter by workload, and export results as CSV or JSON.
4. **Community Hub** — share a completed run, submit algorithm source for unexecuted review, start discussions, and comment or reply.

## CSV format

CSV headers are case-insensitive. `arrival_time` and `burst_time` are required; `pid` (or `process_id`), `priority`, and `memory_mb` are optional. Missing PIDs are assigned in row order; omitted priority and memory values default to zero. At most 500 process rows are accepted.

```csv
pid,arrival_time,burst_time,priority,memory_mb
P1,0,6,2,128
P2,2,3,1,256
```

## API overview

The OpenAPI contract is in `lib/api-spec/openapi.yaml`. JSON endpoints cover dashboard summaries, workload CRUD/import, algorithm listing, simulation execution/history/detail, recommendations, analytics, agent health/snapshots/estimated workloads, explicit result sharing, algorithm submissions, discussions, and comments. API errors use JSON and invalid input returns a client error.

Agent payload contract:

- `GET /api/agent/health`
- `POST /api/agent/snapshots`
- `GET /api/agent/snapshots`
- `DELETE /api/agent/snapshots/{snapshotId}`
- `POST /api/agent/workloads`

## Architecture

- `artifacts/adaptiveos`: responsive React/Vite application.
- `artifacts/api-server`: Express JSON API and scheduling engine.
- `lib/db/src/schema`: PostgreSQL relational schema for workloads, processes, snapshots, simulations, recommendations, shared results, community algorithms, discussions, and comments.
- `lib/api-spec/openapi.yaml`: API contract used to generate client hooks and input validators.
- `agent.py`: independent, read-only psutil client for Windows and other supported desktop platforms.

Community-submitted code is treated as source text. The app does not execute it, and it must not be treated as a verified benchmark.

## Development checks

```bash
pnpm --filter @workspace/api-spec run codegen
pnpm run typecheck
pnpm --filter @workspace/api-server run build
```

Python agent syntax can be checked with:

```bash
python -m py_compile agent.py
python -m unittest discover -s tests -v
```

Do not commit `.env`, process snapshots, credentials, `node_modules`, virtual environments, or local database files.

## GitHub

The repository can be pushed after review:

```bash
git add .
git commit -m "Build AdaptiveOS scheduling research platform"
git remote add origin https://github.com/YOUR-USER/YOUR-REPOSITORY.git
git push -u origin main
```

GitHub is source control, not a Flask/Node application host. Use a Python/Node-capable host with persistent PostgreSQL storage for remote operation, and configure the agent with that host's reachable HTTPS origin.
