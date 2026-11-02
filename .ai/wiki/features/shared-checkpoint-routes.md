---
title: Shared library checkpoints and per-session routes
type: feature
task: TASK-20261102-001
tags: tag-library, shared-checkpoint, route, session-order, static-url, sun, library_id, record_static_tag, reorder, deploy-window, deploy-order, lock-order, no-key-update, admin
related_files:
  - supabase/migrations/20261102100000_shared_tag_library.sql
  - src/lib/db.ts
  - src/lib/types.ts
  - src/app/api/admin/sessions/[id]/tags/from-library/route.ts
  - src/app/api/admin/sessions/[id]/tags/order/route.ts
  - src/app/api/admin/sessions/[id]/tags/[tagId]/library/route.ts
  - src/app/api/admin/library/[libraryId]/release/route.ts
  - src/app/api/admin/library/[libraryId]/route.ts
  - src/app/t/[token]/page.tsx
  - src/app/t/[token]/admin-static-view.tsx
  - src/app/admin/sessions/[id]/ui.tsx
  - src/app/admin/tags/page.tsx
  - README.md
updated: 2026-11-02
---

# Summary

- One tag library entry (SUN or static) can be attached to checkpoints in **many sessions at the same time**, at most **one checkpoint per session**. The entry's link (static URL / SUN tag) never changes.
- Each session has its **own route**: an ordered list of checkpoints created from library entries in the session NFC tab, reorderable with ▲/▼, with per-session hints.
- Static attachment is stored per checkpoint in `tags.library_id`. **Token swapping is gone**: `tags.token` is always the checkpoint's own auto token. This supersedes the swap model in `features/tag-library.md`.
- Static crediting of a library token is resolved **inside the participant's session**.
- Use case (user request): one event split into sessions by department, using the same physical checkpoints in a different order per session.

# Context

The user asked that checkpoint links be registered once, keep the same link everywhere, and be usable by several sessions, each with its own start → finish order (TASK-20261102-001 request). The user chose route setup by "picking from the list in order" and asked that both SUN and static tags be shareable. Other details were MASTER defaults (D1-D13 in the Task plan) confirmed by Codex review.

The previous static model (TASK-20261028-001) swapped the library token into `tags.token` with `tag_library.bound_tag_id` unique, which allowed only one checkpoint per static entry. SUN entries were already multi-session (`tags_session_uid` is per session, `sun_counters` is global per `(uid, ctr)`).

# Current Behavior

## Data model (`20261102100000_shared_tag_library.sql`)

- `tags.library_id text references tag_library(id)` (NO ACTION, so deleting an attached entry is refused at DB level too; 23503 backstop).
- `tags_session_library_key` unique `(session_id, library_id) where library_id is not null` (one checkpoint per session per static entry). `tags_library_idx` on `library_id`.
- SUN attachment is still UID-derived (`tags.uid` = entry uid); SUN never sets `library_id`. A checkpoint may have both a SUN UID and a static attachment.
- `tag_library.bound_tag_id` and `tags.original_token` remain as columns (frozen functions reference them) but are forced null by CHECK constraints `tag_library_bound_tag_unused` and `tags_original_token_unused`.
- The migration converted existing swapped bindings: `library_id = entry`, `token = original_token`, `original_token = null`, `bound_tag_id = null`. It first asserts there is no bound entry without a saved original and no saved original without a bound entry, and raises (aborting the whole migration) otherwise.
- Token-uniqueness invariant now: a token value appears at most once across `tags.token ∪ tag_library.token`; no `tags.token` equals a library token. `tags_token_guard` is unchanged and enforces this (its "library token not bound to this row" check is now unconditional because `bound_tag_id` is always null).

## Static crediting (`record_static_tag`, replaced with the same signature)

Steps 1-4 (participant/session lookup, switch check, team lock, switch re-check) and all messages are unchanged. Tag resolution, inside the participant's session:

1. a library static token → the checkpoint of this session attached to that entry;
2. otherwise an auto token of a checkpoint in this session **with no static attachment** (`library_id is null`);
3. otherwise "등록되지 않은 NFC 태그입니다." with **no event**.

So while a static entry is attached, the checkpoint's own auto URL credits nothing; after detach it credits again. Race rules and messages are unchanged.

SUN crediting is unchanged: `(uid, ctr)` is consumed globally, then the tag is resolved in the participant's session, so one physical SUN tag works in every session that has it in its route, and a counter used in one session is rejected in all others.

## Binding operations (all admin-only, global `cp-library-binding` lock)

- `match_library_static` (attach existing checkpoint): same entry already on this checkpoint → no-op; entry on another checkpoint **of the same session** → 409 `이 태그는 이 세션의 "<name>" 지점에 이미 연결되어 있습니다.` (no confirm); a different static entry already on this checkpoint → 409 `needsConfirm` (replace). Other sessions are never touched and need no confirmation. No token is written.
- `detach_library_tag(session, tag)`: per-checkpoint detach (`DELETE /api/admin/sessions/[id]/tags/[tagId]/library`). The session NFC tab's "연결 해제" uses this.
- `release_library_static(entry)`: **detach from all checkpoints in all sessions**, returns `{released, count}` (`POST /api/admin/library/[libraryId]/release`). SUN entry → 400.
- `delete_library_entry`: a static entry attached anywhere → 409 "연결된 지점이 있는 태그는 삭제할 수 없습니다. 먼저 연결을 해제해 주세요."; SUN entries deletable any time. Deleting a checkpoint or session removes its attachment.
- `get_library()`: both kinds return a `bindings` list (`sessionId, sessionName, sessionStatus, allowStaticUrl, tagId, tagName, order, baselineCtr` — null for static). The single `binding` field was removed (`LibraryBinding` / `LibraryEntry.bindings` in `types.ts`).

## Per-session route builder

- `add_tag_from_library(session, id, token, library, hint, nextHint, locationNote)` → `POST /api/admin/sessions/[id]/tags/from-library` `{libraryId, hint?, nextHint?, locationNote?}`:
  - creates a checkpoint named after the entry, appended at the end through `create_tag` (so `checkpoint_count` is raised when the route grows past it), and attaches it in the same transaction (static: `library_id`; SUN: `register_tag_sun` with the entry uid and the library counter as baseline);
  - one-per-session pre-check (static: 409 with the message above; SUN: 409 "이 세션의 다른 지점에 이미 등록된 태그입니다.");
  - create + attach run in a savepoint; a SUN attach failure raises `CPL01` and returns the 409 JSON with **no checkpoint left**; a token collision returns `{retry:true}` and `store.addTagFromLibrary` retries with a new id/token.
- `reorder_session_tags(session, tagIds[])` → `PUT /api/admin/sessions/[id]/tags/order` `{tagIds}`: the list must equal the session's current checkpoint set exactly (validated **after** locking); otherwise 400 "지점 목록이 현재 경로와 다릅니다. 새로고침 후 다시 시도해 주세요." with no change. Positions are rewritten to 1..n. The UI ▲/▼ sends the swapped full list.
- **D5 lock:** both route actions are allowed only while the session is `draft` or `ready`; `live`/`finished` → 409 "진행 중이거나 종료된 세션은 경로를 바꿀 수 없습니다." The UI disables picker, add and ▲/▼ with that explanation. Existing manual controls (manual "새 NFC 지점" form, delete, hint edit via PATCH, attach/detach, SUN registration, the PATCH `order` field) are **not** restricted.
- NFC tab UI (`NfcPanel` / `SunTagRow` in `ui.tsx`): route-builder picker (`aria-label="경로에 추가할 태그"`) with entries already in this session disabled "(이미 경로에 있음)"; completion line "완주에 필요한 지점 수: min(checkpointCount, 경로 길이) / 경로 N" (computed as `Math.min`, 0 for an empty route); per-row inline hint editor ("안내 편집", existing PATCH); static URL/QR of an attached checkpoint shows the **library** URL (hidden if the library list is not loaded, never the uncredited auto URL).
- `/admin/tags` lists every binding of each entry (session · status · order · name, with a switch-off note for static) or "연결 안 됨".

## `/t/{token}` decision rules (`page.tsx`, server component)

SUN params or a non-10-character token → SUN screens (unchanged). Otherwise `store.resolveStaticToken(token)` (RPC `resolve_static_token`, read-only) returns:

- `{kind:'library', name, bindings[]}` for a library static token;
- `{kind:'checkpoint', …, attached, libraryName}` for a checkpoint auto token;
- null for unknown.

Then:

- **Admin** → `AdminStaticView` (read-only): library entry with every attached session/checkpoint and switch state, or "연결된 지점 없음"; an attached auto token shows "목록 태그(…)가 연결되어 있어 이 URL은 인정되지 않습니다". No participant code mounts, even with `cp_pid`.
- **Library token, participant with a valid `cp_pid`** → `ParticipantStaticLanding` only if the participant's own session has a checkpoint attached to that entry and its switch is on; otherwise the "SUN 정보가 없는 태그입니다…" screen (sends nothing).
- **Library token, no cookie (or participant row gone)** → landing if any attached session has the switch on; the server decides after join (pending flow).
- **Checkpoint token** → attached: no-SUN screen; unattached: the token session's switch (old rule).
- Participant screens receive only the lowercased URL token.

## Deploy-window capability guard (new app, old schema)

- The migration adds `shared_library_schema()` (returns 2, service_role only). `db.ts` `requireSharedLibrary()` calls it; a `LIBRARY_UNAVAILABLE` code (PGRST202 / 42883 / PGRST205 / 42P01) → library list `{available:false}` and every library write → 503 "태그 목록 기능을 사용하려면 DB 업데이트가 필요합니다." **without calling any other RPC**: SUN registration, static issuance, entry delete, release, match, detach, add-from-library, reorder. Success is cached per process; failure is never cached.
- This guard is needed because old-schema functions with the same names (`get_library`, `match_library`, …) exist with old semantics; without it the new app would get `available:true` and old-semantics writes.
- Flows deliberately preserved on the old schema: direct SUN registration (its library auto-add is skipped), `sun/inspect` (`library:null`), `/t` (falls back to the old single-row `getStaticTagInfo`), `/api/tag` (old `record_static_tag`).

# Decision

- **Per-checkpoint attachment column instead of token swapping** (D1/D2): the swap made the library token live in one `tags.token`, which can hold only one checkpoint; a nullable FK plus a per-session unique index expresses "many sessions, one per session" directly.
- **Session-scoped resolution in `record_static_tag`** (D3): the participant's session decides which checkpoint a shared token credits; the auto token of an attached checkpoint is suppressed (earlier user decision: only the library link credits while attached).
- **Route edits limited to draft/ready** (D5): reordering mid-race would change the order rule under teams' existing progress.
- **Reorder takes the full id list** (D6) and validates after locking, so concurrent adds/deletes cause a clean 400 rather than a partial reorder.
- **Capability function instead of relying on missing-RPC errors** (§6 of the analysis), because replaced function names exist on both schemas.
- **`FOR NO KEY UPDATE`** for rows whose key is not changed (see Constraints).

# Why

- Requirement 3 ("a checkpoint registered once can be used by other sessions") was blocked only by the static swap; SUN already worked across sessions.
- Keeping `tags.token` immutable removes the restore-on-release path and the `original_token` uniqueness edge cases.
- Validated locally: 162/162 API/SQL checks, including the migration of real swapped bindings created with the old functions, deploy-window behavior on the eight-migration schema, and concurrency.

# Constraints

- **Deploy order (reverse window):** apply `20261102100000_shared_tag_library.sql` on hosted, then deploy the new app **immediately**, and **never during a live race**. Between apply and deploy, the old app's `/t` cannot find library tokens (they are no longer in `tags.token`), so library URLs show the no-SUN screen and credit nothing; the old NFC tab shows auto-token QR codes for attached checkpoints, and the old library page shows static entries as "연결 안 됨". `/race` Web NFC scans still credit (same `record_static_tag` signature). The old app's match/release calls hit the replaced functions, so it can never re-create swapped bindings. README documents this.
- **Lock order** for every binding/route function: global `pg_advisory_xact_lock(hashtext('cp-library-binding'))` → `sessions` row (only where needed) → `tags` rows by `id` → `tag_library` row → per-token advisory locks in `tags_token_guard`. `sessions` before `tags` matches `create_tag` and the session-delete cascade.
- **`FOR NO KEY UPDATE` finding:** `reorder_session_tags` originally locked `sessions ... FOR UPDATE`. A two-connection check showed a concurrent participant tap waited for the reorder transaction: the `tag_events` insert takes FK `FOR KEY SHARE` on the referenced `sessions` (and `tags`) rows, which conflicts with `FOR UPDATE`. Reorder now uses `sessions FOR NO KEY UPDATE` (still serializes with status PATCHes) and all binding/route functions lock `tags` with `FOR NO KEY UPDATE`; taps no longer wait on attach/detach/reorder. Use `FOR NO KEY UPDATE` for any new lock on `sessions`/`tags` rows whose key is not changed.
- `add_tag_from_library` still takes `sessions FOR UPDATE` (as `create_tag` does), so taps in a draft/ready session can wait briefly during an add; such taps only record "세션이 진행 중이 아닙니다" events.
- **SUN baseline staleness across sessions:** a checkpoint created from a SUN library entry gets `baseline = library counter`, which is updated only by admin reads. After session A's race the physical counter is far ahead, so URLs read but never submitted in between stay valid in session B until B's baseline refresh. Used counters are still rejected globally. **Refresh baselines right before each session's race** (README).
- Participant payloads must not contain `library_id`, library tokens (other than the URL token), UIDs or library-only names. `get_team_race_data` returns `to_jsonb(t)`; only the projections in `buildTeamRaceView` / `toTagSummary` drop `library_id`. Never spread `NfcTag` into a participant view.
- Every new or replaced function is `security invoker`, `search_path=public`, EXECUTE only for service_role. Admin routes: `configGuard()` → `isAdmin()` → 401.
- Do not write `tags.original_token` or `tag_library.bound_tag_id` (CHECK constraints reject it). Do not attach `notify_admin_change` to `tag_library`.
- New library mutation paths must call `requireSharedLibrary()` first.

# Related Files

- `supabase/migrations/20261102100000_shared_tag_library.sql` (sha256 `a15f3ac291ca97aa6b29a759af1e4c3c89d7103de27e15f83f0ccb770302f767`)
- `src/lib/db.ts`: `requireSharedLibrary`, `listLibrary`, `matchLibrary`, `detachLibraryTag`, `releaseLibrary`, `addTagFromLibrary`, `reorderTags`, `resolveStaticToken`, `autoAddLibrarySun`, `toTag` (`libraryId`), `toLibraryEntry`
- `src/lib/types.ts`: `NfcTag.libraryId`, `LibraryBinding`, `LibraryEntry.bindings`, `StaticTokenInfo`
- Routes: `src/app/api/admin/sessions/[id]/tags/from-library/route.ts` (POST), `.../tags/order/route.ts` (PUT), `.../tags/[tagId]/library/route.ts` (POST attach, DELETE detach), `src/app/api/admin/library/[libraryId]/release/route.ts` (detach from all)
- `/t`: `src/app/t/[token]/page.tsx`, `admin-static-view.tsx`
- UI: `src/app/admin/sessions/[id]/ui.tsx` (`NfcPanel`, `SunTagRow`), `src/app/admin/tags/page.tsx`
- `README.md`: "태그 목록" and "세션별 경로 만들기"

# Validation

- Codex FINAL_REVIEW APPROVED: `.ai/tasks/archive/TASK-20261102-001/reviews/final-20261102-113826.json`.
- Static gate PASSED on the integrated tree (`.ai/tasks/archive/TASK-20261102-001/runtime/static/FINAL/summary.txt`); `npm run test:sun` 11/11.
- Final runtime regression (local stack, hosted not touched), `.ai/tasks/archive/TASK-20261102-001/runtime/web/FINAL/report.md`: API/SQL 162/162 (PRE on the eight-migration schema, then `migration up`, then POST: swapped-binding migration, shared crediting, SUN sharing and replay, binding rules, route rules, D5, privileges, leak scan, concurrency with no deadlocks), TODO-001 browser 28/28, TODO-002 browser 45/45.
- The eight earlier migrations stayed byte-identical (`runtime/web/FINAL/migrations-sha256-before.txt` / `-after.txt` in the archived Task).
- Hosted: the migration was **not** applied or tested by agents during this Task. A read-only, count-only pre-check was prepared (`.ai/tasks/archive/TASK-20261102-001/evidence/TODO-001/hosted-precheck.sql`) and run only locally.

# Future Considerations

- **Not done:** hosted application of the ninth migration and a hosted check (needs the user; follow `conventions/hosted-supabase-operations.md`).
- **Known limitation:** cross-session staleness in the admin UI — attaching in session B pushes only `cp-admin:B`, so an admin viewing A sees B's change late; the server's 409 stays authoritative and its message is shown.
- **Known limitation:** the pre-existing PATCH `order` path is not guarded by session status (out of scope); the UI does not use it for reordering. Hint editing is allowed during a live race (existing PATCH behavior).
- **Known limitation:** `requireSharedLibrary()` caches success per process; rolling the DB back to the old schema under a running process would need a restart.
- **Accepted:** one-bit oracle — a participant of an unattached session sees a different `/t` screen than one of an attached switch-on session (same class as `features/static-url-switch.md`).
- **Not requested:** copying a route between sessions, route templates, live-race reordering, dropping `bound_tag_id` / `original_token` / `record_tag`.

# Related Tasks

- TASK-20261102-001 (TODO-001 DB/store/API/`/t`, TODO-002 route builder UI and README)
- TASK-20261028-001 (tag library, superseded static swap model)
