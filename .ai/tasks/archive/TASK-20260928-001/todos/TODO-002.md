# TODO-002

## Objective

Let admins turn the per-session static-URL switch on and off, with a clear warning, and get each checkpoint's static URL and QR while it is on. Make static `/t/{token}` URLs credit checkpoints for participants in switch-on sessions: directly, through the pending-tag flow, and through the in-app NFC scan. A switch-off session and an admin device behave as specified below.

## Requirement Source

request.md:

- Explicit Requirement 1: the per-session switch; static QR and NFC URLs are credited only when it is on.
- Explicit Requirement 2: mixed use in a switch-on session.
- Explicit Constraints: switch-off sessions unchanged.

MASTER defaults 3 (URL/QR display instead of in-app writing), 4 (read-only admin view on static `/t/{token}`) and 5 (protection warning).

## Scope

- **Admin NFC tab** (`src/app/admin/sessions/[id]/ui.tsx`, `NfcPanel`):
  - A labeled switch control ("고정 QR/URL 허용" or similar) that PATCHes the TODO-001 field.
  - Next to it, a visible warning that turning it on removes copy/share protection for this session, because a photographed or shared QR/URL credits the checkpoint without anyone being there.
  - When on, each checkpoint row shows its static URL `<origin>/t/{token}`, a copy button, and a QR (existing `QrImage`), so the URL can be printed or written to an NTAG213 with any NFC app.
  - When off, no static URL or QR is shown, as today.
  - The intro text states that SUN tags keep working when the switch is on.
- **`/t/[token]` server page** (`page.tsx`):
  - With valid SUN `e`/`c`, the current behavior is unchanged: the admin SUN panel or the participant SUN landing.
  - Without SUN params and without an admin cookie:
    - If the token belongs to a switch-on session, render a participant static landing. It submits `{token}` to `/api/tag` and uses the same `pendingTag` flow (JSON `{token}`) when the user has no team or no participant cookie.
    - Otherwise (unknown token, or a switch-off session), render today's "SUN 정보가 없는 태그입니다…" screen and send nothing.
  - Without SUN params and with a valid admin cookie: render a read-only admin view.
    - It shows the checkpoint name, the session name, and whether the session's switch is on, or "등록되지 않은 태그" for an unknown token.
    - It never mounts the participant component: no `/api/tag`, no `pendingTag`.
    - It offers the same admin logout and back links as the SUN admin panel.
- **`/race`** (`src/app/race/page.tsx`, `src/lib/nfc.ts`):
  - The pending handler also accepts a JSON `{token}` payload, submits it exactly once, and still discards non-JSON legacy values.
  - The Web NFC scan also accepts a static `/t/{token}` URL when the participant's session switch is on (read from the TODO-001 boolean in `/api/me`). Otherwise it shows today's "SUN 태그가 아닙니다." error.
- **README:** a short operator note in the NFC section:
  - what the switch does;
  - the protection trade-off;
  - that the new migration file must be applied in the SQL Editor before use.

## Out of Scope

- DB/API contract changes beyond consuming TODO-001.
- Manual code entry on `/race`; in-app NFC writing (Android "NFC에 쓰기").
- Changes to SUN admin panel registration or baseline behavior, the SDM template, or key lookup.
- Token rotation; printable batch-QR sheets; ceremony or ranking UI.

## Dependencies

- TODO-001 APPROVED: the switch field, admin PATCH, the `/api/tag` `{token}` path and the participant boolean.
- Existing: `QrImage`, `originFromWindow`, `PENDING_TAG_KEY`/`saveTagFlash`/`overlayFor`, `isAdmin()`, and `AdminSunPanel` (unchanged).

## Acceptance Criteria

1. **Admin switch**
   - The admin can toggle the switch in the NFC tab, and the state persists across reload.
   - The warning text about removed copy/share protection is visible next to the switch.
2. **Static URL and QR display**
   - When the switch is on, every checkpoint row shows `<origin>/t/{token}`, a working copy control and a QR that encodes exactly that URL.
   - When the switch is off, no static URL or QR is rendered.
3. **Switch-on participant flow**
   - A participant with a team opening `/t/{token}` of the live switch-on session sees the success overlay on `/race`, and the checkpoint is credited.
   - A wrong-order or duplicate token shows the server message.
4. **Pending flow**
   - Opening a switch-on `/t/{token}` with no participant cookie stores `pendingTag` = `{"token":…}` and goes to `/`.
   - After joining a team, `/race` submits it exactly once. Exactly one POST is sent and the checkpoint is credited.
   - Opening it with a cookie but no team goes to `/race` and submits after the team is joined.
5. **Switch-off session**
   - Opening `/t/{token}` of a switch-off session shows today's "SUN 정보가 없는 태그입니다…" text.
   - It sends 0 `/api/tag` requests and writes no `pendingTag`.
6. **Admin device**
   - With `cp_admin` (and also with `cp_pid` present), opening a static `/t/{token}` shows the read-only admin view with the checkpoint and session names and the switch state.
   - It sends 0 `/api/tag` POSTs and writes no `pendingTag`.
7. **Mixed mode, SUN unaffected**
   - In a switch-on session, `/t/s?e&c` SUN URLs still credit through the existing SUN landing.
   - The admin SUN panel on a SUN URL behaves as before.
8. **No token in participant UI or data:** the participant `/race` page and `/api/me` responses contain no tag tokens.
9. **Static gate:** `./scripts/validate.sh TASK-20260928-001 TODO-002` prints `VALIDATE_STATUS=PASSED`.

## Validation

- `./scripts/validate.sh TASK-20260928-001 TODO-002`.
- Browser validation on the local stack (dev server `127.0.0.1:3000`, local Supabase 554xx):
  - a scripted Playwright (Chromium) run for AC 1-8, with admin and participant contexts and `[TEST]` sessions cleaned up by id;
  - network assertions for the `/api/tag` POST counts and `pendingTag` checks;
  - `report.md` at `.ai/tasks/active/TASK-20260928-001/runtime/web/TODO-002/report.md` with `BROWSER_STATUS`, and screenshots of the admin switch, warning and QR, and of the admin static view.
- The Web NFC scan cannot run in headless Chromium. Verify the static-URL parsing through the shared `nfc.ts` parser used by the scan handler, and record the unexercised device path under Known Limitations.
- Regression: rerun the TODO-001 API check if TODO-002 touches any TODO-001 file.
