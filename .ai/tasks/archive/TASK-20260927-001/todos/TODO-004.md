# TODO-004

## Objective

Switch the participant tagging flow and the admin tag management screen to SUN tags: participants record checkpoints only through verified SUN URLs, and admins register each physical tag from a SUN read and get the values needed to configure the tag in NXP tools.

## Requirement Source

request.md Explicit Requirement 13 (admin mode on `/t` so the baseline refresh works on iPhone), 3 (L4 SUN verification, reused URLs rejected, one tag per checkpoint for all teams), 7 (no separate non-NFC fallback), 9 (user decision: turn off static token / checkpoint QR / manual code / UID-only checkpoint acceptance; keep the join invite QR) and 10 (baseline refreshed manually by the admin tapping each tag right before start).

## Scope

- Participant `/t/[token]` page: read SUN query parameters from a tag-opened URL, submit them to `POST /api/tag`; keep the existing pending-tag behavior (not joined / no team yet → store the pending SUN payload, submit after joining; a pending payload is submitted at most once).
- `/race`: Android Web NFC scan extracts the SUN parameters from the NDEF URL record and submits them; remove the manual tag-code input.
- `src/lib/nfc.ts`: parsing helpers for SUN URLs replace `extractTagToken`-based token extraction where used for checkpoints.
- `POST /api/tag` and `store.recordTag`: stop accepting plain `token` and UID-only payloads (request.md item 9).
- Admin session UI tag tab (`src/app/admin/sessions/[id]/ui.tsx`) + admin tag API:
  - register a physical tag to a checkpoint from a SUN read (paste the URL read from the tag, or Web NFC scan on Android): server verifies it (TODO-003 function), binds the UID, and sets the baseline counter; the same action on an already-registered tag refreshes the baseline ("기준 갱신").
  - show per tag: registration status, UID, baseline counter and time.
  - show the SDM configuration to enter in NXP tools: the SUN URL template with placeholder positions and, per registered-or-entered UID, the diversified file read key (admin-only response).
  - remove the static tag QR, the "NFC에 쓰기" static-URL write, the token copy button, and free-text UID entry.
- Admin mode on `/t` (request.md item 13): when the request carries a valid admin cookie (`isAdmin()`), opening a SUN URL (e.g. an iPhone tapping the tag) never records a participant checkpoint. Instead it shows an admin screen: if the tag UID is already registered, show its session/checkpoint and a "기준 갱신" action that refreshes the baseline from this SUN read; if not registered, let the admin choose a session and checkpoint and register the tag from this SUN read. Same server-side verification and rules as the admin tag tab.
- Session join invite QR stays unchanged.

## Out of Scope

- Writing SDM configuration to tags from the browser.
- Any non-NFC fallback for participants.
- Participant realtime (polling from TODO-002 stays).
- Changes to ranking, ceremony, or announcements.

## Dependencies

- TODO-003 (SUN verification, counter/baseline storage, verify-only function).
- TODO-002 (admin screen refresh mechanism).

## Acceptance Criteria

1. Opening a helper-generated SUN URL (`/t/...?<sun params>`) as a team member in a live session records the next checkpoint and lands on `/race` with the success overlay; reopening the same URL shows the "already used" error and does not advance.
2. Opening a SUN URL before joining a team stores it, and after team join it is submitted once and recorded.
3. A static `/t/{token}` URL, a manual code, or a UID-only payload no longer records a checkpoint (API returns an error; `/race` has no manual input).
4. Admin registers a checkpoint's tag from a SUN URL: UID and baseline counter shown; a SUN URL with a counter ≤ that baseline is then rejected for participants; a newer counter is accepted.
5. Registering a SUN URL with an invalid MAC shows an error and changes nothing.
6. Admin tag tab shows the SDM URL template and the per-UID file read key only to an authenticated admin (admin API returns 401 without `cp_admin`); participant APIs never return keys or UIDs.
7. Tag QR, "NFC에 쓰기", and token copy controls are gone; the join invite QR still renders.
8. With a valid admin cookie, opening a SUN URL on `/t` records no participant tag event and consumes no participant checkpoint; for a registered UID it shows the checkpoint and "기준 갱신", and pressing it sets the baseline to that URL's counter (baseline never decreases); for an unregistered UID the admin can pick session + checkpoint and register it. Without a valid admin cookie, `/t` behaves as the participant flow (criteria 1-3). An invalid-MAC SUN URL in admin mode shows an error and changes nothing.

## Validation

- `./scripts/validate.sh TASK-20260927-001 TODO-004` → `VALIDATE_STATUS=PASSED`.
- `npm run test:sun` still passes.
- Browser validation, report at `.ai/tasks/active/TASK-20260927-001/runtime/web/TODO-004/report.md`, against local Supabase using the SUN URL helper:
  - admin: register tags for a session's checkpoints from generated SUN URLs; baseline shown; bad-MAC registration error; SDM template visible.
  - admin mode on `/t`: signed-in admin opens a generated SUN URL → registration / "기준 갱신" screen, no participant event; refresh raises baseline; unregistered UID registration via session + checkpoint choice.
  - participant: open generated SUN URLs in order → progress; reuse URL → error; pre-baseline URL → error; pending-before-team flow.
  - second team with fresh counters on the same checkpoints advances independently.
  - `/race` has no manual input; admin view shows no tag QR.
- Android Web NFC scan and real NTAG 424 DNA taps cannot be exercised in this environment; record as a limitation (physical-tag rehearsal is an ops step in TODO-007 docs).
- Regression: TODO-002 polling/admin realtime on `/race` and admin UI (same files changed).
