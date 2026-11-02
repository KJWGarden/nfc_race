---
title: Tag library (pre-registered tags matched to checkpoints)
type: feature
task: TASK-20261028-001
tags: nfc, sun, static-url, tag-library, matching, original_token, advisory-lock, trigger, deploy-window, admin
related_files:
  - supabase/migrations/20261028100000_tag_library.sql
  - src/lib/db.ts
  - src/lib/types.ts
  - src/app/api/admin/library/route.ts
  - src/app/api/admin/library/[libraryId]/route.ts
  - src/app/api/admin/library/[libraryId]/release/route.ts
  - src/app/api/admin/sessions/[id]/tags/[tagId]/library/route.ts
  - src/app/api/admin/sessions/[id]/tags/[tagId]/sun/route.ts
  - src/app/api/admin/sun/inspect/route.ts
  - src/app/admin/tags/page.tsx
  - src/app/admin/page.tsx
  - src/app/admin/sessions/[id]/ui.tsx
  - src/app/t/[token]/admin-sun-panel.tsx
  - README.md
updated: 2026-11-02
---

> **Superseded in part by TASK-20261102-001 (`features/shared-checkpoint-routes.md`).** Static entries are no longer bound by swapping `tags.token`. They are attached per checkpoint through `tags.library_id`, to many sessions at once (one checkpoint per session). `tags.original_token` and `tag_library.bound_tag_id` are always null (CHECK constraints), there is no move/restore, "연결 해제" is per checkpoint, `release` means "detach from all checkpoints", and `get_library()` returns `bindings` for both kinds (the `binding` field is gone). Statements below about the swap, `original_token`, `bound_tag_id`, single binding, move confirmation and restore-on-release describe the TASK-20261028-001 state and are kept as history. The SUN rules, issuance, auto-add, the token trigger and the advisory locks still apply.

# Summary

- The tag library ("태그 목록") is a session-independent list of physical tags that the admin registers in advance. The admin then matches a library entry to a checkpoint of any session, and that checkpoint is credited by that physical tag.
- Two kinds of entries, in one table `public.tag_library`:
  - **SUN** (NTAG 424 DNA): created only from a server-verified SUN read plus a name. The verified UID and the counter of that read are stored.
  - **Static** (QR / NTAG213): created from a name. The app issues a new 10-character token; its URL is `<origin>/t/{token}`. NTAG213 tags are written with a separate NFC writer app.
- Matching:
  - SUN: binds the UID to the checkpoint through the existing `register_tag_sun` rules, with the library counter as the baseline.
  - Static: the checkpoint's `tags.token` is replaced by the library token while matched. The checkpoint's own auto token is saved in `tags.original_token` and restored on release or move. One checkpoint at a time per static entry. **(Superseded: now attached via `tags.library_id`, shared across sessions, no token change — see `features/shared-checkpoint-routes.md`.)**
- Direct SUN registration (NFC tab and `/t` admin mode) still works and also adds the tag to the library.

# Context

The user asked to register NFC tags in advance and then link them to checkpoints created in a session (request.md). The user chose:

- SUN registration by "SUN read + name" (no typed-UID path);
- the stored library counter as the starting baseline (refresh before the race stays recommended);
- keep direct registration, and auto-add directly registered tags to the library;
- include static URL tags, issued by the app, bound to one checkpoint at a time;
- save the checkpoint's original auto URL while matched and restore it on release, so printed checkpoint QR codes work again.

Defaults chosen by the MASTER and approved through Codex review: no backfill of existing bindings; a separate `/admin/tags` page; no rename UI (re-registering renames); move of a bound static entry needs confirmation; "연결 해제" only for static entries.

# Current Behavior

(Static matching, release, delete-while-bound, crediting-while-matched, list shape and Realtime notes in this section are the TASK-20261028-001 behavior; their current form is in `features/shared-checkpoint-routes.md`.)

- **Pages**
  - `/admin/tags` ("태그 목록", linked from the `/admin` header; covered by the `/admin/*` proxy gate):
    - SUN registration by pasted URL + name ("NFC로 읽기" only where `NDEFReader` exists);
    - static issuance by name, showing the URL, a copy button and a QR code;
    - each entry's current bindings or "연결 안 됨";
    - delete with `confirm()`. The page reloads after each action; it has no polling or Realtime.
  - `/t` admin mode (`AdminSunPanel`): shows "태그 목록: <name>" with the stored counter, or "태그 목록에 없음", and a "목록에 등록" form (name prefilled from the entry).
  - Session NFC tab (`NfcPanel` / `SunTagRow`): per checkpoint a "목록에서 연결" select and "연결" button, a per-row confirm ("확인하고 연결") for SUN replace and static move, the matched library name, "연결 해제" for a matched static entry, and a note. The library list is refetched whenever `live.tags` changes and after each action.
- **Admin API** (all: `configGuard()` then `isAdmin()` → 401):
  - `GET /api/admin/library` → `{available, entries}` (`Cache-Control: no-store`);
  - `POST /api/admin/library` → `{kind:"sun", url | e,c, name}` or `{kind:"static", name}`. A `uid` field is ignored; a body without a SUN read returns 400 "유효하지 않은 태그 URL입니다.". A missing name returns "태그 이름을 입력해 주세요.";
  - `DELETE /api/admin/library/[libraryId]`;
  - `POST /api/admin/library/[libraryId]/release`;
  - `POST /api/admin/sessions/[id]/tags/[tagId]/library` → `{libraryId, replace}`. Errors are `{ok:false, error, needsConfirm}` with the function's status, like the direct SUN route.
- **SUN entries**
  - `upsert_library_sun(p_id, p_uid, p_ctr, p_name, p_rename)`: one row per `upper(uid)`. The counter is `greatest(stored, new)` and never decreases; `ctr_at` moves only when the counter goes up. The name changes only when `p_rename` is true (explicit registration). It writes nothing to `sun_counters`.
  - The library counter is updated only by admin SUN reads: library registration, direct registration and baseline refresh. Participant taps and read-only inspect do not update it.
- **Static entries**
  - `issue_library_static(p_id, p_name, p_token)` takes the per-token advisory lock, checks `tags.token`, `tags.original_token` and `tag_library.token` (all `lower`), and returns `{retry:true}` on a hit or a `unique_violation`. `store.issueLibraryStatic` retries with a new `createTagToken()` up to 5 times.
- **Matching (`match_library` dispatcher)**
  - Reads the entry without a lock. Not found → 404.
  - SUN → returns `register_tag_sun(session, tag, entry.uid, entry.ctr, replace)` unchanged (Decision A). So: session-unique UID (409), different UID on the checkpoint → 409 `needsConfirm`, lower counter for the same UID → 409 "더 최근에 읽은 태그 URL로 갱신해 주세요.".
  - Static → `match_library_static`:
    - already bound to this checkpoint → no-op success;
    - bound to another checkpoint and no `replace` → 409 `needsConfirm`, message names the old session and checkpoint;
    - otherwise, in this order: unbind any other entry bound to the target; set `bound_tag_id = target`; restore the previous checkpoint (`token = original_token, original_token = null`); set the target `original_token = coalesce(original_token, token), token = entry.token`.
    - The target's saved original always holds its auto token, never a library token, even when a second entry replaces the first.
    - A `unique_violation` inside is caught and returned as 409 "태그 토큰이 충돌했습니다. 다시 시도해 주세요.".
- **Release (`release_library_static`)**: restores the original token and unbinds. An unbound entry returns `{ok:true, released:false}`. A SUN entry returns 400.
- **Crediting while matched** (static rules themselves are unchanged):
  - the library URL credits the checkpoint when the session switch is on;
  - the saved original credits nothing: `/t/{original}` shows the existing "SUN 정보가 없는 태그입니다…" screen and sends nothing; `/api/tag {token}` returns "등록되지 않은 NFC 태그입니다." with 0 events;
  - a switch-off session may hold a static match; the URL credits nothing until the switch is on;
  - an unbound library token is unknown everywhere (admin `/t` view: "등록되지 않은 태그입니다.").
- **Delete rules (`delete_library_entry`)**: SUN entries can be deleted at any time, and the checkpoint binding is not changed. A static entry can be deleted only when unbound; a bound one returns 409 "연결된 지점이 있는 태그는 삭제할 수 없습니다. 먼저 연결을 해제해 주세요.". Deleting a checkpoint or its session unbinds the entry (FK `on delete set null`); the saved original is deleted with the row.
- **Auto-add after direct registration (Decision B)**: after `register_tag_sun` succeeds, the direct SUN route calls `store.autoAddLibrarySun({uid, ctr, name: checkpoint name})` with `p_rename = false`. A new entry is named after the checkpoint; an existing one keeps its name. The call never throws, and the route response is unchanged. A failed registration writes no library row.
- **Inspect**: `POST /api/admin/sun/inspect` adds `library: {id, name, counter} | null` (`get_library_entry_by_uid`).
- **List read**: `get_library()` returns one jsonb. SUN `bindings` are all checkpoints with the same UID (session, checkpoint, order, `baselineCtr`); static `binding` is the bound checkpoint with `allowStaticUrl`, or null.
- **Admin Realtime**: the library table has no notify trigger. Static match, move and release update `tags` rows, so `tags_notify_admin` refreshes the affected sessions (both sessions on a cross-session move). Library-only changes (registration, rename, delete) send no push.

# Decision

- **Decision A: SUN matching calls `register_tag_sun`** instead of reimplementing its rules, so the rules and Korean messages live in one place and the frozen migration is not edited.
- **Decision B: auto-add is a second, separate app call** after a successful registration, not a wrapper function. It is swallowed on failure.
- **(Superseded by TASK-20261102-001: no token swap; per-checkpoint `tags.library_id`.)** **Static matching swaps `tags.token`** and saves the auto token in `tags.original_token`, so every existing static path (`record_static_tag`, `getStaticTagInfo`, NFC tab URL/QR) keeps reading one column and needed no change.
- **Token-uniqueness invariant** (current form since TASK-20261102-001: a token appears at most once across `tags.token ∪ tag_library.token`, no `tags.token` equals a library token, `original_token` always null): originally, a token value appears at most once across `tags.token`, `tags.original_token` and `tag_library.token`; the only allowed pair is a library token equal to the `tags.token` of its bound checkpoint. Enforced by:
  - `tags_original_token_key` (unique `lower(original_token)` where not null) and the existing `tags_token_key`;
  - the issuance check in `issue_library_static`;
  - trigger `tags_token_guard` (`BEFORE INSERT OR UPDATE OF token, original_token ON tags`), which raises `unique_violation` (23505) when the new token is another row's saved original or a library token not bound to this row, or when a newly saved original is already used anywhere. The frozen `create_tag` maps 23505 to `{retry:true}`, so it needed no edit.
- **Advisory locks (Risk 2a)**: the trigger takes `pg_advisory_xact_lock(hashtext('cp-token:' || lower(value)))` for both `NEW.token` and `NEW.original_token`, in ascending hash order (once when equal). Issuance takes the same lock. This serializes a match that saves token X with a concurrent `create_tag` inserting X: the later one sees the committed row and gets 23505 → retry.
- **Lock order for static binding functions** (match, release, delete; since TASK-20261102-001 also detach, add-from-library and reorder, with an optional `sessions` lock before `tags` and `FOR NO KEY UPDATE` on `tags`): global `pg_advisory_xact_lock(hashtext('cp-library-binding'))` → `tags` rows `for update` in `id` order → `tag_library` rows in `id` order → per-token advisory locks inside the trigger. This matches the order of the existing delete cascade (tags, then the library row through set null).
- **Deploy window** (extended by TASK-20261102-001 with the `shared_library_schema()` capability guard `requireSharedLibrary()`, see `features/shared-checkpoint-routes.md`): all library access goes through RPCs. Codes `PGRST202`, `42883`, `PGRST205`, `42P01` (`LIBRARY_UNAVAILABLE` in `db.ts`) map to: list `{available:false, entries:[]}`; writes 503 "태그 목록 기능을 사용하려면 DB 업데이트가 필요합니다."; inspect `library:null`; auto-add silently skipped. `/admin/tags` and the NFC tab show the DB-update message; everything else works.

# Why

- Reusing `register_tag_sun` keeps the UID-binding rules identical for every path (plan constraint "rules apply to every UID binding") and avoids two copies drifting.
- Auto-add as a separate call keeps direct registration working unchanged before the migration (one code path), never holds a `tags` lock while waiting on a library lock, and fails safe: the library counter is only a starting baseline, a too-low counter can only make a later match fail with the existing 409, and the next direct registration or refresh fixes it.
- The trigger plus advisory locks give a guarantee rather than a probability: without the lock on the saved token, a concurrent `create_tag` could take a just-saved original (verified as a real interleaving in analysis review), and restoring it later would collide.
- The global binding lock makes all binding changes serial (admin-only, infrequent) and, with the fixed row-lock order, prevents deadlocks with checkpoint or session deletes.
- `notify_admin_change` must **not** be attached to `tag_library`: the trigger function reads `session_id` from the row, which the library table does not have, so every write would raise an error.

# Constraints

- Never add a path that binds a UID without a server-verified SUN read. Library SUN entries come only from `verifySun` output.
- ~~Inside `match_library_static`, `bound_tag_id` must be set **before** the library token is written to `tags.token`.~~ Superseded: since TASK-20261102-001 no function writes a library token into `tags.token`, and `bound_tag_id` / `original_token` must stay null (CHECK constraints).
- Any new code that writes `tags.token` passes through `tags_token_guard`; keep that trigger in place and keep the global lock + lock order in any new binding function.
- Do not add `originalToken` to `NfcTag`. Raw `to_jsonb(t)` rows contain `original_token` (always null now) and `library_id`; participant mappers (`buildTeamRaceView`, `toTagSummary`) drop them. Participant responses must never contain library ids, library tokens, UIDs or library names.
- Do not attach `notify_admin_change` to `tag_library` (no `session_id`).
- Library routes are admin-only; library data never goes to participant routes.
- The migration `20261028100000_tag_library.sql` must be applied on hosted before deploying this app version (`conventions/hosted-supabase-operations.md`).
- Static URLs and QR codes use `window.location.origin`; issue them from the production domain.

# Related Files

- `supabase/migrations/20261028100000_tag_library.sql` (sha256 `efea3af7c5b88bd599c5e21f9777252929b1c0823233cbfca333bf179960374b`)
- `src/lib/db.ts`: `LIBRARY_UNAVAILABLE`, `libraryRpc`, `toLibraryEntry`, `listLibrary`, `registerLibrarySun`, `issueLibraryStatic`, `deleteLibraryEntry`, `matchLibrary`, `releaseLibrary`, `autoAddLibrarySun`, `getLibraryEntryByUid`
- `src/lib/types.ts`: `LibraryEntry`, `LibrarySunBinding`, `LibraryStaticBinding`, `LibraryList`, `LibraryEntryRef`, `SunAdminContext.library`
- Routes: `src/app/api/admin/library/route.ts`, `[libraryId]/route.ts`, `[libraryId]/release/route.ts`, `src/app/api/admin/sessions/[id]/tags/[tagId]/library/route.ts`; auto-add in `.../tags/[tagId]/sun/route.ts`; `library` in `sun/inspect/route.ts`
- UI: `src/app/admin/tags/page.tsx`, `src/app/admin/page.tsx` (link), `src/app/admin/sessions/[id]/ui.tsx` (`NfcPanel`, `SunTagRow`), `src/app/t/[token]/admin-sun-panel.tsx`
- `README.md`: "태그 목록 (미리 등록해 두기)"

# Validation

- Codex FINAL_REVIEW APPROVED: `.ai/tasks/archive/TASK-20261028-001/reviews/final-20261028-181026.json`.
- Static gate PASSED on the integrated tree (`runtime/static/FINAL/summary.txt`); `npm run test:sun` 11/11.
- Local API/SQL check 146/146 (`runtime/web/FINAL/api-check.out.txt`, originally `evidence/TODO-001/api-check.out.txt`): catalog and privileges (RLS on, 0 policies, anon 42501 on table and every function, EXECUTE only for service_role), all matching/move/release/delete rules, trigger + issuance + `create_tag` retry cases, checkpoint and session delete unbinding, participant crediting and leak scan, deploy-window simulation, and the deterministic two-connection Risk 2a checks in both interleavings (blocked on the advisory lock, then `{retry:true}`; reverse order completes with no deadlock).
- Browser checks (Chromium, local stack): `/admin/tags` and `/t` admin mode 34/34; NFC tab matching with participant taps 42/42 (`runtime/web/FINAL/report.md`, screenshots in the same directory and under `runtime/web/TODO-002/`, `runtime/web/TODO-003/`).
- Hosted API regression after the user applied the migration: 42/42, user-data digests identical before and after for all tables including `tag_library`, 0 leftovers (`runtime/web/FINAL/hosted/hosted-check.out.txt`).
- The seven earlier migration files stayed byte-identical (`evidence/TODO-001/migrations-sha256-before.txt` / `-after.txt`).
- All paths above are under `.ai/tasks/archive/TASK-20261028-001/`.

# Future Considerations

- **Residual risk (accepted, Requirement 4):** matching a SUN entry sets the baseline to the library counter, which can be older than the tag's real counter. URLs read after the library registration and never used stay valid until a baseline refresh. The registration URL itself is rejected (`ctr <= baseline`). Refreshing the baseline right before the race remains required practice.
- **Not exercised:** "NFC로 읽기" on `/admin/tags` (Chromium has no Web NFC; only its hidden state was asserted). Rehearse on Android.
- **Not exercised:** the `configGuard()` 503 path of the new routes (dev mode has no config errors); the routes use the same first line as other admin routes.
- **Auto-add is not atomic** with registration: if it fails after registration commits, the library misses that read or keeps an older counter (fails safe, fixed by the next admin read).
- **Library page freshness:** no Realtime for the library; the NFC tab refetches on `live.tags` changes, so a library-only change elsewhere (rename, delete) appears on the next refetch.
- **No backfill:** checkpoints bound before this feature enter the library only on their next direct registration or baseline refresh.
- ~~**README gap:** the "태그 목록" subsection still says the checkpoint-matching screen will be added later.~~ Fixed in TASK-20261102-001.
- **Not requested:** rename UI, SUN "unmatch", bulk import, in-app NFC writing, static `/t` admin registration of unbound library tokens.

# Related Tasks

- TASK-20261028-001 (TODO-001 DB/API, TODO-002 library page and `/t` admin mode, TODO-003 NFC tab matching)
- TASK-20261102-001 (shared static attachment across sessions, per-session routes; supersedes the static swap model — `features/shared-checkpoint-routes.md`)
