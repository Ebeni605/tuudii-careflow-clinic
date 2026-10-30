import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader, RequireArea } from "@/components/AppShell";
import { requireArea } from "@/lib/auth";
import { PatientForm, toPatientRow } from "@/components/PatientForm";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/patients/new")({
  beforeLoad: requireArea("reception"),
  head: () => ({ meta: [{ title: "Register Patient — Two D Medium Clinic" }] }),
  component: () => <RequireArea area="reception"><NewPatient /></RequireArea>,
});

function NewPatient() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  return (
    <div className="max-w-4xl">
      <PageHeader title="Register new patient" subtitle="A unique patient ID is created automatically. Search first to avoid duplicates." />
      <Card><CardContent className="p-5">
        <PatientForm
          busy={busy}
          submitLabel="Register patient"
          onSubmit={async (v) => {
            setBusy(true);
            const { data, error } = await supabase.from("patients").insert(toPatientRow(v)).select("id, mrn").single();
            setBusy(false);
            if (error) { toast.error(error.message); return; }
            toast.success(`Registered — Patient ID ${data.mrn}`);
            qc.invalidateQueries({ queryKey: ["patients"] });
            navigate({ to: "/patients/$patientId", params: { patientId: data.id } });
          }}
        />
      </CardContent></Card>
    </div>
  );
}
