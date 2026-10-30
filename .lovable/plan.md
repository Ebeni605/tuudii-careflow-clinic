# Updated design with the clinic logo, lab form and service list — then start building

This update adds three things you sent to the approved design: the logo, the paper lab request form, and the list of ten clinical services. The app still has only three departments: Reception, OPD and Laboratory.

## What changes in the design

**Logo and branding**
- Your round 2D MC logo appears in the side menu, on the login page and at the top of printed lab reports.
- The colors stay royal blue, white and light blue. The logo's red is used only for warnings, such as abnormal results or allergies.
- The printed header copies your paper form: "KILINIKA G/GALEESSA TUUDI", the Amharic line, "TWO D MEDIUM CLINIC", and the phone numbers 0992540474 / 0913591670.

**Clinical services (10)**
- When registering or checking in a patient, the receptionist picks one of the ten services. The patient then goes into the OPD queue for that service.
- In OPD, a consultation form opens that matches the service:
  - General / Internal Medicine
  - Acute and Chronic Disease
  - ANC (pregnancy history, gestational age, antenatal visits)
  - Family Planning (method, counselling)
  - Diabetes (blood glucose)
  - Hypertension (BP readings)
  - Minor Surgery and Infant Circumcision (assessment, consent, procedure notes)
  - Dental
  - General Follow-up (review of previous visits)
  - Laboratory-only visit (goes straight to the lab request)
- Every form has follow-up planning and visit history. The system never makes clinical decisions on its own.

**Lab test catalogue, taken from your paper form**
- Hematology: CBC, WBC with diff (N, L, M, B %), Hgb, HCT, B/F, Blood Group, Peripheral Morphology, PT, aPTT, INR, D-dimer, LDH, TIBC, Serum Fe, Transferrin, ESR, RBS/FBS
- Serology: Widal, Weil Felix, HBsAg, HBsAb, HCV Ab, VDRL, CRP, HIV, ASO titer, Malaria RDT, RF, H. pylori Ab
- Urine Analysis: pH, Specific Gravity, Protein, Blood, Leukocytes, Glucose, Ketone, Urobilinogen, Bilirubin, Nitrite
- Microscopy: WBC/HPF, RBC/HPF, Cast, Epithelial cells, Urine HCG, 24hr Urine Protein
- Bacteriology & Parasitology: Stool exam, Appearance/Consistency, H. pylori Ag, Occult blood, B/F, Sputum exam, AFB (2X), KOH
- The OPD lab request screen is a checklist laid out in the same columns as the paper form. The printed report follows the form too, with "Requested by" and "Reported by" names and dates.
- The admin can edit the tests, units and normal ranges later.

**Dashboard**
- Visits by service, today's OPD attendance, pending lab requests and completed lab results.
- The services flyer is used only for this setup. It will not appear as a page or banner.

## Build order

1. **Foundation:** online database and login (Lovable Cloud), the logo, colors and print header, staff roles (Admin, Receptionist, OPD Clinician, Lab Technician), and the admin's staff page. There is no public sign-up. Every change is recorded with who made it.
2. **Reception:** patient registration with a unique ID (TDC-YYYY-000001), search, appointments, walk-in check-in with a service choice, and a live queue. Includes fictional sample patients.
3. **OPD:** queues per service, the service-specific consultation forms, vitals, diagnosis, treatment notes, lab request checklist, and patient history.
4. **Laboratory:** worklist, specimen collection, processing, result entry with normal ranges, verification, and the printable report. Verified results appear automatically in the OPD visit.
5. **Dashboard and checks:** dashboard figures, permission tests for each role, print polish and a security review.

I'll start with step 1, then continue through the steps in order.

## Technical details

- New tables: `service_categories` (10 rows from a migration), `visits.service_category_id`, and `consultation_templates` (key plus a JSON field schema). Answers are stored as JSON in `consultations.template_data`, with common fields such as complaint, diagnosis and plan kept as their own columns.
- `lab_tests` gets `section` and `display_order` to match the paper form's layout. A `lab_panels` table groups tests such as CBC and Urine Analysis.
- The logo is uploaded through Lovable Assets. The favicon is made from the logo and stored in `public/`.
- Everything else follows the approved architecture: `user_roles` with `has_role()`, RLS on every table, server functions with auth middleware, and Realtime for the queue and lab worklist.
