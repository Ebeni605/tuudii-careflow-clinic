# Roadmap

## Phase 3 — OPD (done)
## Phase 4 — Laboratory (done)

## Phase 5 — Integration, reports, billing, security, go-live prep
- [ ] A. Integration: duplicate lab-order guard (same test still open on the visit), row lock against concurrent orders
- [ ] B. Admin management dashboard (live database counts)
- [ ] B. Reports (7) with date filters, CSV export, print/PDF, pagination, no names in aggregates
- [ ] C. Optional billing (off until admin enables): charges, invoices, items, payments, receipts, adjustments, outstanding, daily report
- [ ] D. Security: revoke anonymous function access, attribute staff/permission changes in audit, server input validation, password reset, idle sign-out, audit page filters
- [ ] E/G. Backup & recovery + deployment/rollback/admin setup guide (document only what is verified)
- [ ] F. QA: full journey + role tests in database, browser walkthrough, mobile layout, printing
- [ ] Final implementation report

## Later / needs the clinic
- Clinic to enter validated units/reference intervals; confirm meaning of B/F and BF
- Clinic to approve prices + payment workflow before billing is switched on
- Remove test accounts and fictional records before real use
