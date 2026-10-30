<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

# Project rules

- Departments are Reception, OPD, Laboratory (+ Admin); clinical services are categories (`service_categories`), never separate departments — keeps one shared patient record.
- Roles live only in `user_roles`; access is enforced by RLS via `has_role`/`has_any_role`/`is_staff` (disabled profiles count as no role). Every page under `_authenticated` sets `beforeLoad: requireArea(area)` (redirects to `/no-access`); `canAccess` in `src/lib/workflow.ts` defines areas and only drives UI.
- Staff edit only their own name/phone through the `update_my_profile` RPC; `profiles` UPDATE stays admin-only so staff can't change their own active/self-verify flags.
- Visit and lab-item status transitions and stamps (who/when, MRN, queue number, request number) are set by DB triggers; `src/lib/workflow.ts` mirrors them for UI and is unit-tested — change both together.
- Clinicians see lab results only when an item is `verified`; verifier must differ from the result enterer unless `profiles.can_self_verify`.
- Staff accounts are created only by admin via server functions in `src/lib/admin.functions.ts` (service role loaded inside handlers); public signup is disabled; `bootstrapAdmin` works only while no admin exists.
- Clinical CRUD uses the browser client under RLS; every clinical table has an audit trigger writing `audit_log`.
- Service-specific consultation fields live in `src/lib/templates.ts`, stored in `consultations.template_data` (jsonb).
- One consultation per visit, auto-created as `draft` when a clinician starts the visit; signing rules (`consult_before` trigger, mirrored by `signingProblems` in `workflow.ts`) and completion-requires-signed are DB-enforced so records stay medico-legally sound. Signed notes, their diagnoses and medicines are frozen; later changes go only into insert-only `consultation_amendments`.
- Vital signs are insert-only (each measurement kept, BMI is a generated column); OPD lab orders go only through the atomic `create_lab_order` RPC, which links the encounter and moves the visit to `awaiting_lab` (all verified → `ready_for_review`).
- Clinical tables grant nothing to `anon`; insert-only tables also revoke UPDATE/DELETE so a missing RLS policy is never the only guard.
- Form helper `F` (`src/components/opd/Field.tsx`) links its label to Input/Textarea children; Select triggers need their own `aria-label`.
- Lab catalogue sections/order follow the clinic's paper request form; printouts use `PrintHeader` plus `.no-print`/`print-area` CSS.
- Patient number (`mrn`), registration date/staff, queue number/date and check-in staff/time are set and kept immutable by DB triggers; patients are never deleted — admin archives with a reason (`archived*` columns), archived patients cannot be booked or checked in.
- Demographic corrections must carry a new `correction_note` (trigger-enforced) so the audit log records why; `middle_name` = father's name (required), `last_name` = grandfather's name ('' when unknown).
- Clinic "today" is Africa/Addis_Ababa (`clinic_today()` in SQL, `clinicToday()`/`clinicDayRange()` in TS) — never use the browser's or UTC date for queue/appointment days.
- Double booking and duplicate queue entries are blocked by partial unique indexes (`appointments_one_per_day`, `visits_one_active_per_patient_day`, `visits_one_per_appointment`); `friendlyDbError` maps them to plain messages.
- Patient form rules live in `src/lib/patient-schema.ts` (zod, unit-tested) and mirror the `assign_mrn` trigger validations — change both together.
- Development data must be fictional only.
