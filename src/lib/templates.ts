// Service-specific consultation fields (stored in consultations.template_data).
// Forms only record documentation; the system never makes clinical decisions.

export type TemplateField = {
  key: string;
  label: string;
  type: "text" | "textarea" | "number" | "date" | "select" | "checkbox";
  options?: string[];
};

export const SERVICE_TEMPLATES: Record<string, { title: string; fields: TemplateField[] }> = {
  internal_medicine: { title: "Internal Medicine", fields: [] },
  acute_chronic: {
    title: "Acute & Chronic Disease",
    fields: [
      { key: "condition_type", label: "Condition type", type: "select", options: ["Acute", "Chronic"] },
      { key: "duration", label: "Duration of illness", type: "text" },
      { key: "current_medications", label: "Current medications", type: "textarea" },
      { key: "adherence", label: "Medication adherence", type: "select", options: ["Good", "Fair", "Poor", "N/A"] },
    ],
  },
  anc: {
    title: "Antenatal Care",
    fields: [
      { key: "lmp", label: "LMP", type: "date" },
      { key: "edd", label: "EDD", type: "date" },
      { key: "gestational_age_weeks", label: "Gestational age (weeks)", type: "number" },
      { key: "gravida", label: "Gravida", type: "number" },
      { key: "para", label: "Para", type: "number" },
      { key: "anc_visit_number", label: "ANC visit number", type: "number" },
      { key: "fundal_height_cm", label: "Fundal height (cm)", type: "number" },
      { key: "fetal_heart_rate", label: "Fetal heart rate (bpm)", type: "number" },
      { key: "presentation", label: "Presentation", type: "text" },
      { key: "danger_signs", label: "Danger signs reported", type: "textarea" },
      { key: "supplements", label: "Supplements / TT given", type: "text" },
    ],
  },
  family_planning: {
    title: "Family Planning",
    fields: [
      { key: "client_type", label: "Client type", type: "select", options: ["New", "Repeat", "Switch"] },
      { key: "method", label: "Method selected", type: "select", options: ["Pills (COC)", "Pills (POP)", "Injectable", "Implant", "IUCD", "Condom", "Other"] },
      { key: "term", label: "Term", type: "select", options: ["Short-term", "Long-term"] },
      { key: "counselling", label: "Counselling given", type: "textarea" },
      { key: "consent", label: "Client consent obtained", type: "checkbox" },
    ],
  },
  diabetes: {
    title: "Diabetes Follow-up",
    fields: [
      { key: "diabetes_type", label: "Type", type: "select", options: ["Type 1", "Type 2", "Gestational", "Other"] },
      { key: "fbs", label: "FBS (mg/dL)", type: "number" },
      { key: "rbs", label: "RBS (mg/dL)", type: "number" },
      { key: "hba1c", label: "HbA1c (%)", type: "number" },
      { key: "foot_exam", label: "Foot examination", type: "text" },
      { key: "current_medications", label: "Current medications", type: "textarea" },
    ],
  },
  hypertension: {
    title: "Hypertension",
    fields: [
      { key: "bp_reading_2", label: "Second BP reading (mmHg)", type: "text" },
      { key: "target_organ", label: "Target organ symptoms", type: "textarea" },
      { key: "current_medications", label: "Current medications", type: "textarea" },
      { key: "adherence", label: "Adherence", type: "select", options: ["Good", "Fair", "Poor"] },
      { key: "lifestyle", label: "Lifestyle counselling", type: "textarea" },
    ],
  },
  minor_surgery: {
    title: "Minor Surgery & Infant Circumcision",
    fields: [
      { key: "procedure", label: "Procedure", type: "text" },
      { key: "pre_assessment", label: "Pre-procedure assessment", type: "textarea" },
      { key: "consent", label: "Consent documented (patient/guardian)", type: "checkbox" },
      { key: "consent_by", label: "Consent given by", type: "text" },
      { key: "anaesthesia", label: "Anaesthesia", type: "text" },
      { key: "procedure_notes", label: "Procedure notes", type: "textarea" },
      { key: "complications", label: "Complications", type: "textarea" },
    ],
  },
  dental: {
    title: "Dental Care",
    fields: [
      { key: "dental_complaint", label: "Dental complaint", type: "textarea" },
      { key: "teeth_involved", label: "Teeth involved", type: "text" },
      { key: "oral_exam", label: "Oral examination", type: "textarea" },
      { key: "procedure_done", label: "Procedure done", type: "text" },
    ],
  },
  general_followup: {
    title: "General Follow-up",
    fields: [
      { key: "previous_review", label: "Review of previous visit", type: "textarea" },
      { key: "progress", label: "Progress", type: "select", options: ["Improved", "Unchanged", "Worse"] },
    ],
  },
  laboratory: { title: "Laboratory-only Visit", fields: [] },
};
