# Roadmap

## Phase 3 — OPD (done)
## Phase 4 — Laboratory (done)

## Phase 5 — Integration, reports, billing, security, go-live prep
- [x] A. Integration: duplicate lab-order guard (same test still open on the visit), row lock against concurrent orders
- [x] B. Admin management dashboard (live database counts)
- [x] B. Reports (7) with date filters, CSV export, print/PDF, pagination, no names in aggregates
- [x] C. Optional billing (off until admin enables): charges, invoices, items, payments, receipts, adjustments, outstanding, daily report
- [x] D. Security: revoke anonymous function access, attribute staff/permission changes in audit, server input validation, password reset, idle sign-out, audit page filters
- [x] E/G. Backup & recovery + deployment/rollback/admin setup guide (document only what is verified)
- [x] F. QA: full journey + role tests in database, browser walkthrough, mobile layout, printing
- [x] Final implementation report
- [ ] Not verified: backup restore in a separate environment, real concurrent-order test, billing browser flow with billing switched on, email reset delivery to a real inbox

## Later / needs the clinic
- Clinic to enter validated units/reference intervals; confirm meaning of B/F and BF
- Clinic to approve prices + payment workflow before billing is switched on
- Remove test accounts and fictional records before real use

## Patient journey & handovers (Reception → OPD → Lab → OPD → Reception payment → Completed)
- [ ] DB: new visit steps (lab processing, awaiting payment, partly paid, ready to close), visit numbers, handover history, persistent notifications, payment requests, invoice-from-request, payment settings (methods, partial), backend-only transitions
- [ ] UI: visit slip with QR, notification bell + department inboxes, OPD lists (returned from lab, payment, ready to close), payment request panel, Reception "Received from OPD", lab accept + visit/encounter IDs, billing setup methods/partial
- [ ] Restore lab test catalogue names (no units/ranges) and billing settings row lost in remix
- [ ] Tests: workflow rules unit tests; DB scenarios A/B + rejected/partial/duplicate/permissions; browser check
