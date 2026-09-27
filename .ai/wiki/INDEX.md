# Project Wiki

This directory contains reusable project knowledge for CHECKPOINT (nfc-walk-race).

The Master Agent must inspect this index before planning new work.

Entries marked `bootstrap` were written when the AI workflow was installed.
Later entries must come from an APPROVED Task.

## Architecture

- **CHECKPOINT app map** — `architecture/checkpoint-app.md`
  Next.js App Router app. JSON file store, cookie auth, participant vs admin routes, NFC tag URLs.
  tags: nextjs, json-store, auth, nfc, realtime, bootstrap

## Conventions

- **Validation gate** — `conventions/validation-gate.md`
  `./scripts/validate.sh` for lint and tsc. Existing lint findings are baselined. Browser evidence for UI changes.
  tags: lint, tsc, browser, review, bootstrap
