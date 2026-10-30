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
- Roles live only in `user_roles`; access is enforced by RLS via `has_role`/`has_any_role`/`is_staff` — UI checks (`canAccess` in `src/lib/workflow.ts`) only hide controls.
- Visit and lab-item status transitions and stamps (who/when, MRN, queue number, request number) are set by DB triggers; `src/lib/workflow.ts` mirrors them for UI and is unit-tested — change both together.
- Clinicians see lab results only when an item is `verified`; verifier must differ from the result enterer unless `profiles.can_self_verify`.
- Staff accounts are created only by admin via server functions in `src/lib/admin.functions.ts` (service role loaded inside handlers); public signup is disabled; `bootstrapAdmin` works only while no admin exists.
- Clinical CRUD uses the browser client under RLS; every clinical table has an audit trigger writing `audit_log`.
- Service-specific consultation fields live in `src/lib/templates.ts`, stored in `consultations.template_data` (jsonb).
- Lab catalogue sections/order follow the clinic's paper request form; printouts use `PrintHeader` plus `.no-print`/`print-area` CSS.
- Development data must be fictional only.
