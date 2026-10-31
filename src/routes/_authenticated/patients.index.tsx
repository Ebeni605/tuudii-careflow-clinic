import { createFileRoute, Link } from "@tanstack/react-router";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Search, UserPlus } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { LoadError, PageHeader, RequireArea } from "@/components/AppShell";
import { supabase } from "@/integrations/supabase/client";
import { clinicDayRange, patientName } from "@/lib/data";
import { ageFromDob, canAccess } from "@/lib/workflow";
import { requireArea, useStaff } from "@/lib/auth";

export const Route = createFileRoute("/_authenticated/patients/")({
  beforeLoad: requireArea("patients"),
  head: () => ({ meta: [{ title: "Patients — Two D Medium Clinic" }] }),
  component: () => <RequireArea area="patients"><Patients /></RequireArea>,
});

const PAGE = 25;

function Patients() {
  const [q, setQ] = useState("");
  const [sex, setSex] = useState("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [archived, setArchived] = useState(false);
  const [page, setPage] = useState(0);
  const { data: me } = useStaff();
  const isAdmin = !!me?.roles.includes("administrator");
  const term = q.trim().replace(/[%,()*\\]/g, "");

  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: ["patients", term, sex, from, to, archived, page],
    placeholderData: keepPreviousData,
    queryFn: async () => {
      let query = supabase.from("patients").select("*", { count: "exact" }).order("created_at", { ascending: false })
        .range(page * PAGE, page * PAGE + PAGE - 1).eq("archived", archived);
      for (const p of term ? term.split(/\s+/) : []) {
        query = query.or(`first_name.ilike.%${p}%,middle_name.ilike.%${p}%,last_name.ilike.%${p}%,mrn.ilike.%${p}%,phone.ilike.%${p}%`);
      }
      if (sex !== "all") query = query.eq("sex", sex);
      if (from) query = query.gte("created_at", clinicDayRange(from).from);
      if (to) query = query.lte("created_at", clinicDayRange(to).to);
      const { data, error, count } = await query;
      if (error) throw error;
      return { rows: data, count: count ?? 0 };
    },
  });
  const rows = data?.rows ?? [];
  const total = data?.count ?? 0;
  const reset = (fn: () => void) => { fn(); setPage(0); };
  const filtersOn = term || sex !== "all" || from || to || archived;

  return (
    <div>
      <PageHeader
        title="Patients"
        subtitle="Search by patient number, name or phone number"
        actions={me && canAccess(me.roles, "reception") ? <Button asChild><Link to="/patients/new"><UserPlus className="mr-1 h-4 w-4" />Register new patient</Link></Button> : null}
      />
      <Card className="mb-4 p-4">
        <div className="grid gap-3 md:grid-cols-[2fr_1fr_1fr_1fr]">
          <div className="relative">
            <Label className="sr-only" htmlFor="ps">Search</Label>
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input id="ps" autoFocus className="pl-9" placeholder="CL-000001, name or 09…" value={q} onChange={(e) => reset(() => setQ(e.target.value))} />
          </div>
          <Select value={sex} onValueChange={(v) => reset(() => setSex(v))}>
            <SelectTrigger aria-label="Sex filter"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="all">All sexes</SelectItem><SelectItem value="female">Female</SelectItem><SelectItem value="male">Male</SelectItem></SelectContent>
          </Select>
          <Input type="date" aria-label="Registered from" title="Registered from" value={from} onChange={(e) => reset(() => setFrom(e.target.value))} />
          <Input type="date" aria-label="Registered to" title="Registered to" value={to} onChange={(e) => reset(() => setTo(e.target.value))} />
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
          <span>{isLoading ? "Searching…" : `${total} patient${total === 1 ? "" : "s"} found`}{isFetching && !isLoading ? " · updating…" : ""}</span>
          <div className="flex items-center gap-3">
            {isAdmin && <label className="flex items-center gap-2"><Switch checked={archived} onCheckedChange={(c) => reset(() => setArchived(c))} />Show archived records</label>}
            {filtersOn && <Button size="sm" variant="ghost" onClick={() => { setQ(""); setSex("all"); setFrom(""); setTo(""); setArchived(false); setPage(0); }}>Clear filters</Button>}
          </div>
        </div>
      </Card>
      {error && <div className="mb-4"><LoadError onRetry={() => refetch()} /></div>}
      <Card className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Patient no.</TableHead><TableHead>Name</TableHead><TableHead>Sex</TableHead><TableHead>Age</TableHead><TableHead>Phone</TableHead><TableHead className="hidden md:table-cell">Address</TableHead><TableHead className="hidden lg:table-cell">Registered</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && <TableRow><TableCell colSpan={7} className="text-muted-foreground">Loading…</TableCell></TableRow>}
            {!isLoading && rows.length === 0 && (
              <TableRow><TableCell colSpan={7} className="py-8 text-center text-muted-foreground">
                No patients match. {me && canAccess(me.roles, "reception") && <Link to="/patients/new" className="text-primary hover:underline">Register a new patient</Link>}
              </TableCell></TableRow>
            )}
            {rows.map((p) => (
              <TableRow key={p.id}>
                <TableCell className="font-mono text-xs"><Link className="text-primary hover:underline" to="/patients/$patientId" params={{ patientId: p.id }}>{p.mrn}</Link></TableCell>
                <TableCell className="font-medium">
                  <Link to="/patients/$patientId" params={{ patientId: p.id }} className="hover:underline">{patientName(p)}</Link>
                  {p.allergies && <span className="ml-2 rounded bg-destructive/10 px-1.5 text-xs text-destructive">Allergy</span>}
                </TableCell>
                <TableCell className="capitalize">{p.sex}</TableCell>
                <TableCell>{ageFromDob(p.date_of_birth, new Date(), p.dob_estimated) ?? "—"}</TableCell>
                <TableCell>{p.phone ?? "—"}</TableCell>
                <TableCell className="hidden text-sm text-muted-foreground md:table-cell">{[p.kebele && `Kebele ${p.kebele}`, p.town, p.region].filter(Boolean).join(", ") || "—"}</TableCell>
                <TableCell className="hidden text-sm lg:table-cell">{new Date(p.created_at).toLocaleDateString()}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
      {total > PAGE && (
        <div className="mt-3 flex items-center justify-end gap-2 text-sm">
          <span className="text-muted-foreground">Page {page + 1} of {Math.ceil(total / PAGE)}</span>
          <Button size="sm" variant="outline" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</Button>
          <Button size="sm" variant="outline" disabled={(page + 1) * PAGE >= total} onClick={() => setPage(page + 1)}>Next</Button>
        </div>
      )}
    </div>
  );
}
