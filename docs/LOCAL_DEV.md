# Local development

Needs: Node 20+, PostgreSQL 14+ (16 tested), Python 3.10+ (only for the worker).

## 1. Database
```bash
createdb wv_dev
```

## 2. Website
```bash
cd web
cp .env.example .env.local        # then edit: DATABASE_URL, APP_SECRET (openssl rand -hex 32)
npm install
npm run migrate                   # creates tables
npm run create-owner              # prompts for email, name, password (hidden), workspace name
npm run dev                       # http://localhost:3000
```
`STORAGE_DRIVER=local` keeps images in `web/.local-storage/` (git-ignored). Sign in at `/login`.

## 3. Worker (to train)
```bash
cd worker
python -m venv .venv && source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -r requirements.txt                           # large: installs PyTorch
cp .env.worker.example .env.worker                        # same DATABASE_URL; STORAGE_DRIVER=local;
                                                          # LOCAL_STORAGE_DIR=../web/.local-storage
python -m wvworker check
python -m wvworker run
```
The **Jobs & workers** page turns “Online” within a minute.

## 4. Tests
```bash
cd web
createdb wv_test && createdb wv_e2e
npm test                                    # unit/service tests (drops and recreates schema in wv_test!)
npx next build && npm run e2e               # browser tests; needs Playwright's Chromium and the worker venv
WORKER_PYTHON=/path/to/.venv/bin/python npm run e2e      # if the worker venv is elsewhere
cd ../worker && createdb wv_worker_test && DATABASE_URL=... npm --prefix ../web run migrate  # once
TEST_DATABASE_URL=postgresql://.../wv_worker_test python -m pytest
```
Tests reset their own databases — never point them at data you care about.
Optional S3 checks run when `TEST_S3_ENDPOINT` points at an S3-compatible server (e.g. `moto_server`, MinIO).
