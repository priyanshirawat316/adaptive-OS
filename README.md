# AdaptiveOS

AdaptiveOS is an operating-systems research workbench for creating CPU workloads, comparing scheduling policies, analyzing saved runs, and voluntarily sharing results. Its local Python agent reads permitted process metadata only and sends opt-in snapshots to the backend. It never changes how the host operating system schedules real processes.

## Product and data boundaries

- **Synthetic/manual/CSV workloads** are user-provided scheduling inputs.
- **PC snapshots** contain process ID, name, creation time, status, observed CPU percentage, and memory usage in MB, with timestamps and a schema version.
- **Estimated simulation inputs** are derived from observations. The application does not recover the OS ready queue or exact future CPU bursts.
- **Simulation metrics** are modeled results from the five built-in policies: FCFS, SJF, SRTF, non-preemptive Priority, and Round Robin.
- Community submissions are private until the user explicitly shares a result. Custom algorithm source is stored for review and is never run by the server.

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

## Workflows

1. **Dashboard**: inspect database-backed counts, recent workloads and runs, local-agent state, and the most recent recommendation.
2. **Simulator**: generate a seeded workload, enter processes manually, import CSV, or preview an agent snapshot and derive an estimated workload. Save workloads, choose one or more policies, compare them on exactly the same processes, and inspect the timeline and per-process results.
3. **Analytics**: filter historical persisted runs by workload and export the selected result data as CSV or JSON.
4. **Community Hub**: explicitly share a completed run, submit source code for unexecuted review, create discussions, and comment or reply.

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
