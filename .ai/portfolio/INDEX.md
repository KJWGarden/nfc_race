# Engineering Portfolio

This directory contains evidence-based engineering case studies
generated from APPROVED project work.

Portfolio content must never be used as implementation requirements.

## Case Studies

| Title | Task | Technologies | Key Engineering Competency | Path |
|---|---|---|---|---|
| Moving a single-process JSON store to Supabase Postgres with atomic database functions | TASK-20260927-001 (TODO-001) | Next.js 16, TypeScript, Supabase Postgres, plpgsql, RLS, supabase-js | Concurrency control in the database; API contract preservation | cases/json-store-to-supabase-atomic-postgres.md |
| Replacing in-memory SSE with serverless-safe polling and private Supabase Realtime channels | TASK-20260927-001 (TODO-002) | Next.js 16, React 19, Supabase Realtime Broadcast + Authorization, Postgres triggers, HS256 JWT | Serverless-compatible realtime architecture; least-privilege authorization | cases/serverless-realtime-polling-private-broadcast.md |
| Server-side NTAG 424 DNA SUN verification with single-use counters | TASK-20260927-001 (TODO-003, TODO-004) | Node crypto (AES-CMAC), NXP AN12196, Postgres, Next.js server components, node --test | Applied cryptography against official vectors; atomic replay protection | cases/ntag424-sun-anti-cheat.md |
| Production hardening: secret guard, DB-backed login limiting, participant re-join | TASK-20260927-001 (TODO-005, TODO-006) | Next.js 16 route handlers, Postgres row locks and expression unique index, HMAC cookies | Fail-closed configuration; distributed rate limiting; constraint-backed identity | cases/production-hardening-secret-guard-login-limit-rejoin.md |
| Validating against a live hosted database, and handling a leaked-key incident | TASK-20260927-001 | Supabase hosted/local, Next.js build output, Playwright, SHA-256 digests | Incident response; production-data safety; verification discipline | cases/hosted-db-validation-and-key-incident.md |
| Adding an opt-in static QR/URL tagging mode without weakening the SUN-only anti-cheat path | TASK-20260928-001 (TODO-001, TODO-002) | Next.js 16, React 19, Supabase Postgres (plpgsql, row locks, grants), Web NFC, Playwright, jsQR | Feature flag on a security boundary; byte-identical API contract preservation; deploy-order safety | cases/per-session-static-url-switch.md |
