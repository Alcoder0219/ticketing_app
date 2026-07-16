# Deploying to Google Cloud Run

This app deploys as **two Cloud Run services** from one repository:

| Service | Source | Serves | Container port |
|---|---|---|---|
| `ticketing-backend` | `server/` (`server/Dockerfile`) | Express + Socket.IO API | `8080` |
| `ticketing-frontend` | root (`Dockerfile.frontend`) | Static React build via nginx | `8080` |

The frontend talks to the backend over HTTPS using `VITE_API_URL`, which is **baked into the frontend bundle at build time** (Vite inlines `VITE_*`). Deploy the **backend first**, note its URL, then build the frontend with that URL.

---

## 0. Prerequisites (one-time)

```bash
# Set your project and enable APIs
gcloud config set project YOUR_PROJECT_ID
gcloud services enable run.googleapis.com cloudbuild.googleapis.com \
  artifactregistry.googleapis.com secretmanager.googleapis.com

# Create an Artifact Registry Docker repo (region of your choice)
gcloud artifacts repositories create ticketing \
  --repository-format=docker --location=europe-west1
```

**Region recommendation:** pick the region closest to your users and your **MongoDB Atlas** cluster to minimize latency (e.g. `europe-west1` Belgium, `me-central1`/`me-central2` for the Gulf, or `asia-south1` Mumbai). Keep both Cloud Run services and Atlas in the same region/continent.

---

## 1. Store secrets in Secret Manager

Never put secrets in the repo or in plain env vars. Create them once:

```bash
printf '%s' 'mongodb+srv://USER:PASS@cluster/ticketing?retryWrites=true&w=majority' | gcloud secrets create MONGODB_URI --data-file=-
printf '%s' "$(openssl rand -hex 48)"                                              | gcloud secrets create JWT_SECRET --data-file=-
printf '%s' 'sk-...'                                                               | gcloud secrets create OPENAI_API_KEY --data-file=-
printf '%s' 'your_cloud_name'                                                      | gcloud secrets create CLOUDINARY_CLOUD_NAME --data-file=-
printf '%s' 'your_api_key'                                                         | gcloud secrets create CLOUDINARY_API_KEY --data-file=-
printf '%s' 'your_api_secret'                                                      | gcloud secrets create CLOUDINARY_API_SECRET --data-file=-
```

Grant the Cloud Run runtime service account access:

```bash
PROJECT_NUMBER=$(gcloud projects describe YOUR_PROJECT_ID --format='value(projectNumber)')
SA="$PROJECT_NUMBER-compute@developer.gserviceaccount.com"
for S in MONGODB_URI JWT_SECRET OPENAI_API_KEY CLOUDINARY_CLOUD_NAME CLOUDINARY_API_KEY CLOUDINARY_API_SECRET; do
  gcloud secrets add-iam-policy-binding $S --member="serviceAccount:$SA" --role=roles/secretmanager.secretAccessor
done
```

---

## 2. Deploy the BACKEND

Build, push, and deploy (first deploy uses a placeholder `CORS_ORIGIN`; you'll update it in step 4):

```bash
REGION=europe-west1
REPO=europe-west1-docker.pkg.dev/YOUR_PROJECT_ID/ticketing

gcloud builds submit ./server --tag $REPO/backend:latest -f server/Dockerfile

gcloud run deploy ticketing-backend \
  --image $REPO/backend:latest \
  --region $REGION \
  --platform managed \
  --allow-unauthenticated \
  --port 8080 \
  --cpu 1 --memory 512Mi \
  --concurrency 80 \
  --min-instances 1 --max-instances 10 \
  --session-affinity \
  --timeout 3600 \
  --set-env-vars STORAGE_DRIVER=cloudinary,JWT_EXPIRES_IN=7d,NODE_ENV=production \
  --set-secrets MONGODB_URI=MONGODB_URI:latest,JWT_SECRET=JWT_SECRET:latest,OPENAI_API_KEY=OPENAI_API_KEY:latest,CLOUDINARY_CLOUD_NAME=CLOUDINARY_CLOUD_NAME:latest,CLOUDINARY_API_KEY=CLOUDINARY_API_KEY:latest,CLOUDINARY_API_SECRET=CLOUDINARY_API_SECRET:latest
```

Note the printed URL, e.g. `https://ticketing-backend-abc123-ew.a.run.app`. Then set `PUBLIC_BASE_URL` to it:

```bash
gcloud run services update ticketing-backend --region $REGION \
  --update-env-vars PUBLIC_BASE_URL=https://ticketing-backend-abc123-ew.a.run.app
```

- `--session-affinity` + `--timeout 3600` are needed for **Socket.IO** (long-lived WebSocket/polling). See the note in the checklist about multi-instance scaling.
- The app already reads `process.env.PORT` — no code change required.

---

## 3. Deploy the FRONTEND

Build with the backend URL baked in, then deploy:

```bash
REGION=europe-west1
REPO=europe-west1-docker.pkg.dev/YOUR_PROJECT_ID/ticketing
BACKEND_URL=https://ticketing-backend-abc123-ew.a.run.app

gcloud builds submit . \
  --config=cloudbuild.frontend.yaml \
  --substitutions=_REGION=$REGION,_AR_REPO=ticketing,_SERVICE=ticketing-frontend,_VITE_API_URL=$BACKEND_URL
```

…or manually with Docker + a build arg:

```bash
docker build -f Dockerfile.frontend --build-arg VITE_API_URL=$BACKEND_URL -t $REPO/frontend:latest .
docker push $REPO/frontend:latest
gcloud run deploy ticketing-frontend \
  --image $REPO/frontend:latest \
  --region $REGION --platform managed --allow-unauthenticated \
  --port 8080 --cpu 1 --memory 256Mi --concurrency 300 \
  --min-instances 0 --max-instances 5
```

Note the frontend URL, e.g. `https://ticketing-frontend-abc123-ew.a.run.app`.

---

## 4. Point the backend CORS at the frontend

```bash
gcloud run services update ticketing-backend --region $REGION \
  --update-env-vars CORS_ORIGIN=https://ticketing-frontend-abc123-ew.a.run.app
```

(If you add a custom domain later, include it here too — comma-separated.)

---

## 5. GitHub Continuous Deployment

Two clean options:

### Option A — Cloud Build triggers (recommended; supports the frontend build arg)
1. **Connect the repo:** Cloud Build → *Triggers* → *Connect repository* → GitHub → `Alcoder0219/ticketing_app`.
2. **Backend trigger:** push to `main` → config file `cloudbuild.backend.yaml`, substitutions `_REGION`, `_AR_REPO`, `_SERVICE=ticketing-backend`.
3. **Frontend trigger:** push to `main` → config file `cloudbuild.frontend.yaml`, substitutions as above **plus `_VITE_API_URL=<backend URL>`**.
4. Grant the Cloud Build service account the **Cloud Run Admin** and **Service Account User** roles.

Now every push to `main` rebuilds and redeploys both services.

### Option B — Cloud Run "Deploy from repository"
Cloud Run → *Create Service* → *Continuously deploy from a repository* → select the repo and set the Dockerfile path (`server/Dockerfile` for backend, `Dockerfile.frontend` for frontend). Works out of the box for the backend; for the frontend you must still inject `VITE_API_URL` at build — use Option A (Cloud Build) for that service.

---

## 6. Cloud Run settings reference

| Setting | Backend | Frontend | Why |
|---|---|---|---|
| Region | `europe-west1` (near Atlas) | same as backend | latency |
| CPU | 1 | 1 | sufficient for Node/nginx |
| Memory | 512Mi | 256Mi | Node needs more than static nginx |
| Concurrency | 80 | 300 | static serving handles more per instance |
| Min instances | **1** | 0 | avoid cold starts + keep Socket.IO warm |
| Max instances | 10 | 5 | cap cost; tune to load |
| Session affinity | **On** | off | sticky sessions for Socket.IO |
| Request timeout | 3600s | default (300s) | long-lived WebSockets |
| Ingress | All | All | public app |
| Auth | Allow unauthenticated | Allow unauthenticated | public app; app-level JWT still enforced |

---

## 7. Environment variables

**Backend** (secrets via Secret Manager, the rest as env vars):

| Var | Source | Example |
|---|---|---|
| `PORT` | auto-injected by Cloud Run | `8080` |
| `MONGODB_URI` | secret | `mongodb+srv://…/ticketing` |
| `JWT_SECRET` | secret | 96-hex random |
| `JWT_EXPIRES_IN` | env | `7d` |
| `CORS_ORIGIN` | env | frontend URL(s), comma-separated |
| `STORAGE_DRIVER` | env | `cloudinary` |
| `PUBLIC_BASE_URL` | env | backend URL |
| `CLOUDINARY_CLOUD_NAME/_API_KEY/_API_SECRET` | secret | — |
| `OPENAI_API_KEY` | secret | `sk-…` |

**Frontend** (build time only): `VITE_API_URL` = backend URL. See `.env.example` (root) and `server/.env.example`.

---

## 8. Custom domain + HTTPS

- Cloud Run serves **HTTPS by default** on its `*.run.app` URL (managed certificate).
- To map a custom domain: Cloud Run → service → *Manage custom domains* → *Add mapping* (or `gcloud beta run domain-mappings create --service ticketing-frontend --domain app.example.com --region $REGION`). Add the shown DNS records at your registrar; Google auto-provisions a managed TLS cert.
- Recommended: custom domain on the **frontend** (e.g. `app.example.com`) and a subdomain on the **backend** (e.g. `api.example.com`). If you use `api.example.com`, rebuild the frontend with `VITE_API_URL=https://api.example.com` and add it to the backend `CORS_ORIGIN`.

---

## 9. Local Docker sanity check (optional)

```bash
# Backend
docker build -f server/Dockerfile -t adt-backend ./server
docker run --rm -p 8080:8080 --env-file server/.env adt-backend   # open http://localhost:8080/health

# Frontend
docker build -f Dockerfile.frontend --build-arg VITE_API_URL=http://localhost:8080 -t adt-frontend .
docker run --rm -p 8080:8080 adt-frontend                          # open http://localhost:8080
```

---

## 10. Production-readiness checklist

- [x] Backend listens on `process.env.PORT` (no hardcoded port) — verified.
- [x] Backend start = `npm start` → `node dist/index.js`; build = `npm run build` (tsc) — verified emits `dist/index.js`.
- [x] Frontend has no `localhost` assumptions — uses `VITE_API_URL` (build-time) everywhere.
- [x] SPA deep-link routing handled by nginx (`try_files … /index.html`).
- [x] `.dockerignore` files exclude `node_modules`, `.git`, `dist`, `coverage`, `.env*`, logs.
- [x] No secrets committed (`.env` gitignored; only `.env.example` placeholders).
- [ ] **Atlas Network Access:** allow Cloud Run egress. Cloud Run uses dynamic IPs, so either allow `0.0.0.0/0` (relies on DB auth) **or** set up a **Serverless VPC connector + Cloud NAT** with a static IP and allowlist that. Recommended: VPC connector + NAT.
- [ ] **Socket.IO horizontal scaling:** the server keeps socket state **in memory**. With `min/max-instances > 1`, enable **session affinity** (done above) so a client sticks to one instance. For true multi-instance fan-out you would need a shared adapter (e.g. Redis via `@socket.io/redis-adapter`) — *not implemented*; fine for single/low-instance setups.
- [ ] **Local-disk storage fallback:** `STORAGE_DRIVER` must be `cloudinary` in production — Cloud Run's filesystem is ephemeral, so local-disk uploads would be lost. (Cloudinary is already wired; just keep the env var set.)
- [ ] Set `CORS_ORIGIN` to the exact frontend URL(s) after first deploy.
- [ ] Rotate any credentials that were shared during development.

Nothing in the application code blocks deployment — the only required actions are the infrastructure items above (Atlas network access, secrets, CORS origin).
