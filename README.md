# WasteVision AI — team platform

A private, login-only web platform for a small team building a computer-vision waste sorter:
dataset management, image annotation, YOLO training, evaluation, model registry, documentation and a shared Kanban board.

```
web/      Next.js app (UI + API). Deploys to Vercel.
worker/   Python worker. Runs training, evaluation, prediction and exports on a machine you control.
docs/     Guides (start here ↓)
```

| Guide | For |
|---|---|
| [docs/LOCAL_DEV.md](docs/LOCAL_DEV.md) | Run everything on your own computer |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | Put the website on Vercel + Supabase + object storage |
| [docs/WORKER.md](docs/WORKER.md) | Set up the machine that trains models |
| [docs/SECURITY.md](docs/SECURITY.md) | How access is controlled, and what is verified |
| [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) | Common problems |
| [docs/MIGRATION_FROM_STREAMLIT.md](docs/MIGRATION_FROM_STREAMLIT.md) | Relationship to the earlier Streamlit tool |

## How it fits together

```
 browser ──► Vercel (Next.js: pages + API) ──► Postgres  ◄── worker (Python, your PC/GPU box)
                         │                                        │
                         └────────────► object storage ◄──────────┘   (images, checkpoints, exports)
```

The website never trains models. It queues jobs in Postgres; a worker claims them, reports progress and
heartbeats, and stores results. With no worker running, jobs wait and the UI says so.

## What is in the app



# WasteVision AI

A collaborative computer-vision workspace for managing waste-image
datasets, annotating objects, training and evaluating models, testing
predictions, tracking experiments, and coordinating project work.

> **Project status:** This README describes the intended platform based
> on the project specification. Actual feature availability depends on
> the current repository and backend configuration. Do not treat a
> feature as production-ready until it has been implemented and tested.

## Contents

-   [Overview](#overview)
-   [Project goals](#project-goals)
-   [Planned workflow](#planned-workflow)
-   [Core modules](#core-modules)
-   [Technology and architecture](#technology-and-architecture)
-   [Getting started](#getting-started)
-   [Environment variables](#environment-variables)
-   [Authentication and privacy](#authentication-and-privacy)
-   [Dataset and annotation guidance](#dataset-and-annotation-guidance)
-   [Training and evaluation](#training-and-evaluation)
-   [Deployment](#deployment)
-   [Troubleshooting](#troubleshooting)
-   [Development guidelines](#development-guidelines)
-   [Roadmap](#roadmap)
-   [Contributing](#contributing)
-   [License](#license)

## Overview

WasteVision AI is designed to help a project team build and manage a
computer-vision system for identifying waste, including small and
fragmented waste pieces. The workspace brings dataset preparation, image
annotation, model training, evaluation, prediction testing, experiment
records, model versions, documentation, and team task management into
one application.

The broader project objective is to investigate identifying small waste
fragments---potentially around **1--2 cm**---such as pieces of plastic,
glass, metal, paper, and other waste. Actual minimum detectable size and
accuracy depend on image resolution, camera distance, lighting, object
visibility, dataset quality, and the trained model. These capabilities
must be validated experimentally; they should not be assumed from the
interface alone.

## Project goals

-   Organize image datasets and dataset versions.
-   Label images and, where supported, draw object bounding boxes.
-   Validate annotations and prepare data for training.
-   Configure and monitor computer-vision training jobs.
-   Evaluate models with task-appropriate metrics.
-   Test predictions on new images or videos when supported.
-   Keep model checkpoints and experiment results associated with their
    training runs.
-   Coordinate work through a shared team workspace and Kanban board.
-   Restrict project data to authenticated, authorized team members.
-   Provide a web interface that can be deployed independently of
    long-running model-training workloads.

## Planned workflow

**Create dataset → Import images → Annotate → Validate dataset →
Configure training → Train → Evaluate → Test predictions → Register
model**

Each step should use actual backend data and report clear loading,
success, empty, and error states. A training job must not be shown as
running unless the backend confirms it.

## Core modules

The following modules are part of the intended product scope. Confirm
each module in the current repository before describing it as fully
implemented.

  -----------------------------------------------------------------------
  Module                              Purpose
  ----------------------------------- -----------------------------------
  Overview                            Summarize real dataset, training,
                                      model, and task activity.

  Datasets                            Organize image collections,
                                      versions, classes, splits, and
                                      data-quality checks.

  Annotation                          Assign labels and draw or review
                                      bounding boxes for object-detection
                                      datasets.

  Training                            Configure model runs and view job
                                      status, logs, metrics, and
                                      checkpoints.

  Evaluation                          Review metrics appropriate to the
                                      model task and dataset split.

  Test & Predict                      Run inference on new supported
                                      inputs and inspect actual
                                      predictions.

  Experiments                         Compare runs, dataset versions,
                                      configurations, and results.

  Models                              Track checkpoints, model versions,
                                      and their associated training runs.

  Team Kanban                         Create, assign, prioritize, and
                                      track project tasks.

  Documentation                       Keep dataset instructions,
                                      experiment notes, and team
                                      decisions.

  Team & Settings                     Manage membership, roles,
                                      permissions, and workspace
                                      preferences.
  -----------------------------------------------------------------------

### Classification versus object detection

-   **Image classification** predicts a category for an entire image. It
    does not identify the location of each object within that image.
-   **Object detection** predicts both a category and a location,
    commonly represented by a bounding box, for each detected object.

If the goal is to locate several small waste fragments in one image, an
object-detection approach and suitable bounding-box annotations are
generally required. The final choice depends on the existing training
pipeline and project requirements.

## Technology and architecture

The project specification calls for a web application with a persistent
backend and a separate execution environment for long-running training
jobs.

The exact stack must be confirmed from the repository. The current
project may use technologies such as:

-   **Frontend:** Next.js / React and TypeScript, if present in the
    repository.
-   **Authentication and database:** Supabase or the existing configured
    provider.
-   **Image storage:** A persistent object store or an explicitly
    configured shared storage integration.
-   **Model training and inference:** The existing Python/ML pipeline or
    a dedicated worker.
-   **Deployment:** Vercel for compatible web application components,
    with training performed by suitable external compute when required.

Do not assume that all of these integrations are already configured.
Check `package.json`, environment-variable usage, database migrations,
API routes, and training scripts before relying on them.

## Getting started

### Prerequisites

Install the tools required by the actual repository. For a typical
Next.js application, these commonly include:

-   Git
-   Node.js LTS and npm
-   Access to the configured database/authentication provider, if the
    application requires one
-   Python and the ML dependencies only if running the training pipeline
    locally

### 1. Clone the repository

Replace `<YOUR_GITHUB_USERNAME>` with the GitHub account or organization
that owns the repository.

``` bash
git clone https://github.com/<YOUR_GITHUB_USERNAME>/WasteVision-AI.git
cd WasteVision-AI
```

If you choose a different repository name on GitHub, use that URL
instead.

### 2. Install dependencies

For an npm-based JavaScript project:

``` bash
npm install
```

### 3. Configure environment variables

Create a local `.env.local` file if the application uses environment
variables. Use `.env.example` as the reference when one is provided.

``` bash
# Example only — use the exact variable names required by this repository.
# Never paste real credentials into README.md or commit them to Git.
```

The application may not start correctly until the required database and
authentication values are configured. Do not invent missing values;
obtain them from the project's actual provider settings.

### 4. Run the development server

For a typical Next.js application:

``` bash
npm run dev
```

Open the local URL printed by the terminal (commonly
`http://localhost:3000`).

### 5. Run checks before publishing

Use the scripts that actually exist in `package.json`. Common commands
may include:

``` bash
npm run lint
npm run build
```

If a script is not defined, npm will report that it is missing. Check
`package.json` rather than adding commands blindly. Test login,
protected pages, dataset access, annotation saving, and any training
workflow that is available.

## Environment variables

Create `.env.example` with **variable names and safe placeholders
only**. The list below is illustrative; use the exact names expected by
the codebase.

``` dotenv
# Public client configuration (only values explicitly designed to be public)
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=YOUR_PUBLIC_ANON_KEY

# Server-only secrets (never expose these through NEXT_PUBLIC_* variables)
DATABASE_URL=YOUR_DATABASE_CONNECTION_STRING
SUPABASE_SERVICE_ROLE_KEY=YOUR_SERVER_ONLY_SERVICE_ROLE_KEY

# Add other variables only after confirming they are used by the application.
```

Important:

-   Do not commit `.env`, `.env.local`, private setup files, passwords,
    access tokens, service-role keys, or production credentials.
-   A service-role key and database password must remain server-side.
-   Only include variables that the actual application needs. Remove
    unused examples before treating this file as the project's
    definitive configuration guide.
-   If the project uses another provider, replace these examples with
    the correct provider's variable names.

## Authentication and privacy

The intended deployment is a **private team workspace**, not an open
public dashboard.

Before production use, verify that:

-   Login is required before private project pages can be accessed.
-   Backend APIs independently enforce authentication and authorization.
-   Database policies prevent one workspace from reading or changing
    another workspace's records.
-   Image files, annotations, model checkpoints, and logs are not
    exposed through public URLs unintentionally.
-   Team roles are enforced on the server, not only by hiding interface
    controls.
-   Account creation is restricted to the project owner or authorized
    administrators.
-   Passwords are handled by a secure authentication provider and are
    never stored in plain text.
-   Secrets and private setup instructions are excluded from Git and
    public build assets.

A login screen alone does not make an application private. Validate
access control on both the frontend and backend before sharing the
deployed URL.

## Dataset and annotation guidance

For reliable small-object detection:

1.  Collect representative images under varied lighting, backgrounds,
    angles, and camera distances.
2.  Ensure the smallest target fragments are large and clear enough in
    the source image to label consistently.
3.  Use consistent class definitions and annotation rules.
4.  Draw tight, valid bounding boxes around each target object when
    training an object-detection model.
5.  Review labels and resolve missing, duplicate, or invalid
    annotations.
6.  Separate training, validation, and test data carefully to reduce
    data leakage.
7.  Record the dataset version used for every training run.
8.  Evaluate performance specifically on small objects and on images
    representative of real use.

A model's minimum detectable object size is not guaranteed by a project
requirement alone. Report measured performance and test conditions when
results become available.

## Training and evaluation

A training record should ideally include:

-   Run ID and status
-   Dataset version and split
-   Model architecture and pretrained weights
-   Image size, epochs, batch size, and learning rate
-   Compute device
-   Start and completion timestamps
-   Logs, metrics, and checkpoint paths

Use metrics appropriate to the task:

**Classification:** accuracy, precision, recall, F1-score, per-class
metrics, and a confusion matrix.

**Object detection:** precision, recall, mAP@50, mAP@50--95, per-class
metrics, inference latency, and error analysis when supported by the
evaluation pipeline.

Always label whether a result comes from the training, validation, or
final test split. Validation performance must not be presented as final
test performance.

Long-running training jobs generally need a persistent worker or
suitable compute service rather than relying on a browser session or a
short-lived web request. The frontend should display the actual status
reported by the training backend.

## Deployment

Vercel may be suitable for the frontend and compatible API routes. Model
training and other long-running jobs may need a separate worker or GPU
environment.

Before deploying:

1.  Push the repository to GitHub.
2.  Import the repository into Vercel.
3.  Configure the framework and build settings based on the repository.
4.  Add required environment variables in Vercel's project settings.
5.  Configure authentication callback URLs and allowed origins for the
    production domain.
6.  Apply required database migrations using the project's documented
    procedure.
7.  Configure persistent image and model-artifact storage.
8.  Deploy and verify the production build.
9.  Test both authorized and unauthorized access.
10. Test dataset operations and any actual training/inference
    integrations.

Do not assume Vercel can run an entire ML training job within a web
request. Confirm execution limits and use a separate worker when
required. A deployment is complete only after it has been deployed and
tested.

## Troubleshooting

### `DATABASE_URL is not set`

The application expects a database connection string but it is missing
from the local or deployment environment. Check the code and
`.env.example`, configure the required value in your local environment
or hosting settings, and restart the development server. Never commit
the real connection string.

### Database authentication fails

Check that the database URL is correct, the password is current, the
database is reachable, and the required schema/migrations have been
applied. Do not paste database credentials into issue reports or public
repositories.

### Login works locally but not after deployment

Check production environment variables, authentication callback/redirect
URLs, cookie/session configuration, and provider allowed origins.
Confirm that the production build uses the correct provider project.

### Images or model files disappear after deployment

Do not rely on temporary local filesystem storage for persistent uploads
or model artifacts. Configure a persistent storage provider and save
references to stored objects in the database.

### Training does not continue after closing the browser

The training process may be tied to a web request or local session. Use
a persistent background worker or job service and have the frontend poll
or subscribe to backend job status.

### Build or npm script fails

Check the exact error, Node.js version, dependency lockfile, and scripts
declared in `package.json`. Run the project's documented lint, test, and
build commands rather than assuming every standard script exists.

## Development guidelines

-   Inspect existing code before replacing working components.
-   Keep secrets out of source control.
-   Do not add mock metrics or fake model runs to production.
-   Preserve existing datasets, annotations, tasks, and checkpoints
    during schema changes.
-   Validate input and enforce permissions on the server.
-   Make loading, empty, success, and error states explicit.
-   Test save operations after refreshing the page.
-   Keep model artifacts associated with their correct training runs.
-   Document known limitations and incomplete integrations honestly.

## Roadmap

The intended implementation sequence is:

1.  Audit the repository and protect existing data.
2.  Establish a stable responsive application shell.
3.  Complete persistent Kanban task management and assignment.
4.  Verify team membership, roles, and workspace isolation.
5.  Improve dataset management and annotation reliability.
6.  Connect training jobs to persistent execution and accurate status
    reporting.
7.  Verify evaluation, prediction, experiment tracking, and model
    versioning.
8.  Complete onboarding and project documentation.
9.  Run end-to-end checks and validate the production deployment.

This roadmap describes planned work, not a statement that every item is
already complete.

## Contributing

If this is a team project:

1.  Create a feature branch for each change.
2.  Keep changes focused and reviewable.
3.  Do not commit credentials, datasets containing private information,
    or large model checkpoints unless the team has explicitly chosen an
    appropriate storage and versioning approach.
4.  Test affected workflows before opening a pull request.
5.  Document new environment variables and setup steps.
6.  Report incomplete features and known limitations accurately.

## License

No license has been specified yet. Add a `LICENSE` file only after the
project owner decides how the code may be used, modified, and
redistributed. Without a license, default copyright restrictions
generally apply.





Private login (email + password only; no public sign-up, no email verification) · five server-enforced roles ·
team Kanban with real multi-assignee tasks, subtasks, dependencies, saved views and workload · datasets with
duplicate/blur/brightness checks · annotation canvas (boxes or class labels) with review · frozen, leakage-aware
dataset versions · training wizard · per-epoch curves · evaluation labelled by split (train/val/test) ·
confusion matrix and error analysis · Test & Predict · experiment comparison · model registry ·
Markdown documentation with templates · in-app guide and glossary.



## Tests

```
cd web    && npm test              # 61 unit/service tests (real Postgres)
cd web    && npm run e2e           # 55 browser tests incl. a real worker training a model
cd worker && python -m pytest      # real tiny CPU training, evaluation, prediction, export
```
