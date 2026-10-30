import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { patientName } from "@/lib/data";

export type PickedPatient = { id: string; mrn: string; label: string };

/** Search existing (non-archived) patients by number, name or phone. */
export function usePatientSearch(term: string, enabled = true) {
  const t = term.trim().replace(/[%,()*\\]/g, "");
  return useQuery({
    queryKey: ["patient_search", t],
    enabled: enabled && t.length >= 2,
    queryFn: async () => {
      let q = supabase.from("patients").select("id, mrn, first_name, middle_name, last_name, phone, sex").eq("archived", false).limit(8);
      for (const p of t.split(/\s+/)) q = q.or(`first_name.ilike.%${p}%,middle_name.ilike.%${p}%,last_name.ilike.%${p}%,mrn.ilike.%${p}%,phone.ilike.%${p}%`);
      const { data, error } = await q;
      if (error) throw error;
      return data;
    },
  });
}

export function PatientPicker({ value, onChange }: { value: PickedPatient | null; onChange: (p: PickedPatient | null) => void }) {
  const [q, setQ] = useState("");
  const { data, isFetching } = usePatientSearch(q, !value);
  if (value) {
    return (
      <div className="flex items-center justify-between rounded border bg-secondary px-3 py-2 text-sm">
        {value.label}<Button type="button" size="sm" variant="ghost" onClick={() => onChange(null)}>Change</Button>
      </div>
    );
  }
  return (
    <div>
      <div className="relative">
        <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input className="pl-9" aria-label="Search patient" placeholder="Patient number, name or phone" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {q.trim().length >= 2 && (
        <div className="mt-1 max-h-56 divide-y overflow-auto rounded border">
          {isFetching && !data && <div className="px-3 py-2 text-sm text-muted-foreground">Searching…</div>}
          {data?.length === 0 && <div className="px-3 py-2 text-sm text-muted-foreground">No match.</div>}
          {data?.map((p) => (
            <button key={p.id} type="button" className="block w-full px-3 py-1.5 text-left text-sm hover:bg-muted"
              onClick={() => { onChange({ id: p.id, mrn: p.mrn, label: `${patientName(p)} · ${p.mrn}` }); setQ(""); }}>
              {patientName(p)} <span className="font-mono text-xs text-muted-foreground">{p.mrn}</span> <span className="text-xs text-muted-foreground">{p.phone}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
