# syntax=docker/dockerfile:1
# ─────────────────────────────────────────────────────────────────────────────
# Backend (Node + Express + TypeScript) for Cloud Run.
# Multi-stage: compile TypeScript, then run only the built output with prod deps.
# ─────────────────────────────────────────────────────────────────────────────

# ---- Stage 1: build (npm run build → tsc → dist/) ----
FROM node:22-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# ---- Stage 2: runtime (npm start → node dist/index.js) ----
FROM node:22-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production
# Cloud Run overrides PORT at runtime (defaults to 8080); the app already reads
# process.env.PORT (see src/config/env.ts), so no code change is needed.
ENV PORT=8080

# Install production dependencies only.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Copy the compiled output from the build stage.
COPY --from=build /app/dist ./dist

EXPOSE 8080
CMD ["npm", "start"]
