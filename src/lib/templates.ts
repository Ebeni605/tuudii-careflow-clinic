// Service-specific consultation fields (stored in consultations.template_data).
// Forms only record documentation; the system never makes clinical decisions.
// Fields marked `required` must be filled before the note can be signed
// (the database enforces the consent fields too — see consult_before).

export type TemplateField = {
  key: string;
  label: string;
  type: "text" | "textarea" | "number" | "date" | "select" | "checkbox";
  options?: string[];
  required?: boolean;
  group?: string;
};

export type ServiceTemplate = {
  title: string;
  intro?: string;
  fields: TemplateField[];
  /** Labels for the standard history/exam boxes when the service uses different wording. */
  labels?: Partial<Record<"chief_complaint" | "history" | "examination" | "assessment", string>>;
};

const YES_NO_UNKNOWN = ["Yes", "No", "Unknown"];
const ADHERENCE = ["Good", "Fair", "Poor", "Not on treatment"];

export const SERVICE_TEMPLATES: Record<string, ServiceTemplate> = {
  internal_medicine: {
    title: "Internal Medicine Treatment",
    fields: [{ key: "review_of_systems", label: "Review of systems", type: "textarea" }],
  },
  acute_chronic: {
    title: "Acute and Chronic Disease Treatment",
    labels: { history: "Disease history", examination: "Clinical findings" },
    fields: [
      { key: "condition_type", label: "Condition type", type: "select", options: ["Acute", "Chronic", "Acute on chronic"] },
      { key: "duration", label: "Duration of illness", type: "text" },
      { key: "adherence", label: "Medication adherence", type: "select", options: ADHERENCE },
      { key: "complications", label: "Complications noted", type: "textarea" },
    ],
  },
  minor_surgery: {
    title: "Minor Surgery",
    fields: [
      { key: "procedure", label: "Procedure", type: "text", group: "Procedure" },
      { key: "indication", label: "Indication", type: "text", group: "Procedure" },
      { key: "pre_assessment", label: "Pre-procedure assessment", type: "textarea", group: "Procedure" },
      { key: "consent", label: "Informed consent documented", type: "checkbox", required: true, group: "Consent" },
      { key: "consent_by", label: "Consent given by (name / relationship)", type: "text", group: "Consent" },
      { key: "anaesthesia", label: "Anaesthesia", type: "select", options: ["Local infiltration", "Ring / nerve block", "Topical", "None"], group: "Procedure" },
      { key: "procedure_notes", label: "Procedure details", type: "textarea", group: "Procedure" },
      { key: "complications", label: "Complications", type: "textarea", group: "Procedure" },
      { key: "aftercare", label: "Aftercare instructions", type: "textarea", group: "Aftercare" },
      { key: "suture_removal_date", label: "Wound review / suture removal date", type: "date", group: "Aftercare" },
    ],
  },
  infant_circumcision: {
    title: "Infant Male Circumcision",
    intro: "Child and guardian details, documented guardian consent and a pre-procedure safety check are required.",
    labels: { chief_complaint: "Reason for visit" },
    fields: [
      { key: "guardian_name", label: "Guardian name", type: "text", required: true, group: "Child and guardian" },
      { key: "guardian_relationship", label: "Relationship to child", type: "text", group: "Child and guardian" },
      { key: "guardian_phone", label: "Guardian phone", type: "text", group: "Child and guardian" },
      { key: "birth_weight_kg", label: "Birth weight (kg)", type: "number", group: "Child and guardian" },
      { key: "risks_explained", label: "Procedure, risks and aftercare explained to guardian", type: "checkbox", group: "Consent" },
      { key: "guardian_consent", label: "Guardian consent documented", type: "checkbox", required: true, group: "Consent" },
      { key: "vitamin_k_given", label: "Vitamin K given at birth", type: "select", options: YES_NO_UNKNOWN, group: "Pre-procedure safety check" },
      { key: "family_bleeding_history", label: "Family history of bleeding disorder", type: "select", options: YES_NO_UNKNOWN, group: "Pre-procedure safety check" },
      { key: "genital_exam", label: "Genital examination", type: "select", options: ["Normal", "Abnormal — procedure deferred", "Abnormal — see notes"], group: "Pre-procedure safety check" },
      { key: "general_condition", label: "General condition (feeding, jaundice, illness)", type: "text", group: "Pre-procedure safety check" },
      { key: "identity_confirmed", label: "Child identity confirmed with guardian", type: "checkbox", group: "Pre-procedure safety check" },
      { key: "method", label: "Method", type: "select", options: ["Plastibell", "Gomco clamp", "Mogen clamp", "Forceps-guided", "Other"], group: "Procedure" },
      { key: "anaesthesia", label: "Anaesthesia", type: "select", options: ["Dorsal penile nerve block", "Ring block", "Topical", "None"], group: "Procedure" },
      { key: "procedure_notes", label: "Procedure notes", type: "textarea", group: "Procedure" },
      { key: "haemostasis", label: "Haemostasis at end of procedure", type: "select", options: ["Achieved", "Required additional measures"], group: "Procedure" },
      { key: "complications", label: "Complications", type: "textarea", group: "Procedure" },
      { key: "voided_before_discharge", label: "Passed urine before discharge", type: "select", options: ["Yes", "No", "Not observed"], group: "Aftercare" },
      { key: "aftercare", label: "Aftercare instructions given", type: "textarea", group: "Aftercare" },
    ],
  },
  anc: {
    title: "Antenatal Care",
    intro: "EDD and gestational age calculated from LMP are estimates — confirm before recording.",
    fields: [
      { key: "gravida", label: "Gravida", type: "number", group: "Pregnancy history" },
      { key: "para", label: "Para", type: "number", group: "Pregnancy history" },
      { key: "abortions", label: "Abortions", type: "number", group: "Pregnancy history" },
      { key: "living_children", label: "Living children", type: "number", group: "Pregnancy history" },
      { key: "previous_pregnancy_notes", label: "Previous pregnancy / delivery notes", type: "textarea", group: "Pregnancy history" },
      { key: "lmp", label: "LMP", type: "date", group: "Dates" },
      { key: "edd", label: "EDD (confirmed by clinician)", type: "date", group: "Dates" },
      { key: "gestational_age_weeks", label: "Gestational age (weeks, confirmed)", type: "number", group: "Dates" },
      { key: "anc_visit_number", label: "ANC visit number", type: "number", group: "This visit" },
      { key: "fundal_height_cm", label: "Fundal height (cm)", type: "number", group: "This visit" },
      { key: "fetal_heart_rate", label: "Fetal heart rate (bpm)", type: "number", group: "This visit" },
      { key: "presentation", label: "Presentation", type: "select", options: ["Cephalic", "Breech", "Transverse", "Not assessed"], group: "This visit" },
      { key: "fetal_movement", label: "Fetal movement", type: "select", options: ["Present", "Reduced", "Not yet felt"], group: "This visit" },
      { key: "oedema", label: "Oedema", type: "select", options: ["None", "Mild", "Marked"], group: "This visit" },
      { key: "danger_signs", label: "Danger signs reported", type: "textarea", group: "This visit" },
      { key: "investigations", label: "Investigations (results reviewed)", type: "textarea", group: "This visit" },
      { key: "supplements", label: "Iron / folic acid / TT given", type: "text", group: "This visit" },
    ],
  },
  laboratory: {
    title: "Comprehensive Laboratory Service",
    intro: "Write the clinical indication, then order the tests in the Lab orders tab.",
    labels: { chief_complaint: "Clinical indication / complaint" },
    fields: [],
  },
  family_planning: {
    title: "Family Planning",
    fields: [
      { key: "client_type", label: "Client type", type: "select", options: ["New", "Repeat", "Switching method"] },
      { key: "method", label: "Method selected", type: "select", options: ["Pills (COC)", "Pills (POP)", "Injectable", "Implant", "IUCD", "Condom", "Emergency contraception", "Other"] },
      { key: "term", label: "Term", type: "select", options: ["Short-term", "Long-term"] },
      { key: "assessment", label: "Relevant assessment (e.g. pregnancy excluded, BP, history)", type: "textarea" },
      { key: "counselling", label: "Counselling notes", type: "textarea" },
      { key: "side_effects_explained", label: "Side effects and warning signs explained", type: "checkbox" },
      { key: "consent", label: "Client consent documented", type: "checkbox" },
      { key: "batch_number", label: "Product / batch number (if applicable)", type: "text" },
    ],
  },
  dental: {
    title: "Dental Care",
    labels: { chief_complaint: "Dental complaint", examination: "Oral examination" },
    fields: [
      { key: "teeth_involved", label: "Teeth involved (FDI numbers)", type: "text" },
      { key: "findings", label: "Findings", type: "textarea" },
      { key: "anaesthesia", label: "Local anaesthesia", type: "text" },
      { key: "procedure_done", label: "Treatment / procedure done", type: "textarea" },
    ],
  },
  diabetes: {
    title: "Diabetes Treatment and Follow-up",
    intro: "Blood glucose can also be recorded with the vital signs to build the trend over visits.",
    fields: [
      { key: "diabetes_type", label: "Type", type: "select", options: ["Type 1", "Type 2", "Gestational", "Other"] },
      { key: "years_since_diagnosis", label: "Years since diagnosis", type: "number" },
      { key: "fbs", label: "FBS (mg/dL)", type: "number" },
      { key: "rbs", label: "RBS (mg/dL)", type: "number" },
      { key: "hba1c", label: "HbA1c (%)", type: "number" },
      { key: "hypoglycaemia", label: "Hypoglycaemia episodes since last visit", type: "text" },
      { key: "foot_exam", label: "Foot examination", type: "text" },
      { key: "eye_symptoms", label: "Eye symptoms / last eye check", type: "text" },
      { key: "adherence", label: "Medication adherence", type: "select", options: ADHERENCE },
    ],
  },
  hypertension: {
    title: "Hypertension Treatment",
    intro: "Record each BP measurement in Vital signs; repeat readings are kept, not replaced.",
    fields: [
      { key: "years_since_diagnosis", label: "Years since diagnosis", type: "number" },
      { key: "home_bp", label: "Home BP readings reported", type: "text" },
      { key: "target_organ", label: "Target organ symptoms", type: "textarea" },
      { key: "risk_factors", label: "Risk factors (smoking, diabetes, family history…)", type: "text" },
      { key: "adherence", label: "Medication adherence", type: "select", options: ADHERENCE },
      { key: "lifestyle", label: "Lifestyle counselling given", type: "textarea" },
    ],
  },
  general_followup: {
    title: "General Follow-up and Other Services",
    fields: [
      { key: "previous_review", label: "Review of previous visit", type: "textarea" },
      { key: "progress", label: "Current progress", type: "select", options: ["Improved", "Unchanged", "Worse"] },
      { key: "progress_notes", label: "Progress notes", type: "textarea" },
    ],
  },
};

export function templateFor(serviceKey: string): ServiceTemplate {
  return SERVICE_TEMPLATES[serviceKey] ?? SERVICE_TEMPLATES["internal_medicine"]!;
}
