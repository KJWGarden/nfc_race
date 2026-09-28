# TODO-003

## Objective

Add server-side NTAG 424 DNA SUN verification with single-use enforcement to `POST /api/tag`: decrypt PICCData, verify the SDM MAC, resolve the checkpoint from the tag UID, reject any SUN URL whose counter was already used or is not above the tag's baseline, and record the checkpoint through the existing atomic path.

## Requirement Source

request.md Explicit Requirement 3 (L4: SUN dynamic URL verified on the server, used URLs rejected, one tag per checkpoint shared by all teams) and 4 (one member's tag counts for the team).

## Scope

- Pure crypto module (e.g. `src/lib/sun.ts`, only `node:crypto` and relative imports) implementing per NXP AN12196: AES-128 decryption of encrypted PICCData with the SDM meta read key (extract PICCDataTag, UID, SDMReadCtr), SV2-based session MAC key derivation, AES-CMAC and truncated 8-byte SDMMAC over the configured MAC input, constant-time comparison.
- Key handling (decided here): one deployment-wide SDM meta read key and a per-tag SDM file read (MAC) key diversified from a server master key by tag UID, both from server-only env vars (e.g. `SUN_META_KEY`, `SUN_MASTER_KEY`), so no key material is stored in the database and one physical tag can be reused across sessions. Analysis confirms the diversification function (NXP AN10922 or an HMAC-based KDF) and documents it.
- Migration: tag table gains the data needed for SUN (UID already exists; add baseline counter and baseline timestamp), plus a used-counter table with a unique constraint on (tag UID, counter). Recording a SUN attempt inserts the counter in the same transaction as the tag event so a replay is rejected even under concurrency, while two different fresh counters submitted concurrently are both accepted as SUN-valid (race rules then decide the outcome, e.g. second member of the same team gets "이미 태깅한 지점입니다.").
- Counter rule: counter must be strictly greater than the tag's baseline counter; counter is consumed for every cryptographically valid submission (including ones rejected by race rules) so a URL can never be retried.
- `POST /api/tag` accepts a SUN payload (PICCData hex + CMAC hex, parameter names fixed in analysis) and returns distinct Korean errors for: invalid MAC / undecryptable data, unregistered UID in this session, already-used URL, URL older than baseline.
- A server function (used by TODO-004 admin registration) that verifies a SUN payload and returns UID + counter without recording a race event.
- Node built-in test (`node --test`, TS type stripping on Node 24) for the crypto module using the NXP AN12196 published SUN vectors (e.g. zero keys, PICCData `EF963FF7828658A599F3041510671E88`, SDMMAC `94EED9EE65337086` → UID `04DE5F1EACC040`, SDMReadCtr 61 — UID corrected per AN12196 Table 2/4 during analysis) plus negative cases (flipped MAC byte, wrong key). Exposed as an npm script (e.g. `npm run test:sun`). No test-runner dependency is added.
- A dev/validation helper (script under `scripts/`, not shipped to the client) that generates valid SUN URLs for a given UID/counter/keys, to drive browser and API validation without a physical tag.

## Out of Scope

- UI changes on `/t`, `/race`, and admin screens (TODO-004).
- Removing plain-token acceptance from `/api/tag` (TODO-004, request.md item 9).
- Programming physical tags.
- L2 travel-time checks; relay of freshly tapped URLs (documented residual risk).

## Dependencies

- TODO-001 (schema, atomic recording function to extend).

## Acceptance Criteria

1. `npm run test:sun` passes: AN12196 vector decrypts to the published UID and counter and the published SDMMAC verifies; tampered MAC and wrong key fail.
2. `POST /api/tag` with a fresh valid SUN payload for the team's next checkpoint records a valid event and returns the same success shape as today.
3. Re-submitting the identical SUN payload (same or another participant/team) is rejected with the "already used" error and creates no valid event.
4. Two different fresh counters for the same tag submitted concurrently by two different teams are both accepted (each team advances).
5. 20 concurrent submissions of the same SUN payload yield exactly one accepted submission.
6. A payload with counter ≤ the tag's baseline is rejected; a payload with a bad MAC or a UID not registered in the participant's session is rejected with its specific error.
7. SUN keys are read only from server-only env vars; no key or master key appears in the client bundle, API responses, or database rows.
8. Existing race rules (order, duplicate, not-live, finish, team-level credit) behave as in TODO-001 for SUN submissions.

## Validation

- `./scripts/validate.sh TASK-20260927-001 TODO-003` → `VALIDATE_STATUS=PASSED`.
- `npm run test:sun` output.
- API-level checks against local Supabase using the SUN URL helper (curl/script with participant cookies), outputs recorded for AC2-AC6.
- Runtime Validation: NOT_APPLICABLE for browser (no UI change in this Todo; API behavior is covered by the recorded API checks). Browser coverage of the SUN flow happens in TODO-004.
