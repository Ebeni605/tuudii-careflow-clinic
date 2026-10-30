import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Users, Clock, Stethoscope, FlaskConical, CheckCircle2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/AppShell";
import { supabase } from "@/integrations/supabase/client";
import { today, useLiveTable, useServices } from "@/lib/data";
import { useStaff } from "@/lib/auth";
import { canAccess } from "@/lib/workflow";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({ meta: [{ title: "Dashboard — Two D Medium Clinic" }] }),
  component: Dashboard,
});

function Dashboard() {
  const { data: me } = useStaff();
  const { data: services } = useServices();
  const roles = me?.roles ?? [];
  const seesLab = canAccess(roles, "lab") || canAccess(roles, "opd");
  useLiveTable("visits", [["dash"]]);
  useLiveTable("lab_request_items", [["dash"]]);

  const { data } = useQuery({
    queryKey: ["dash", seesLab],
    enabled: !!me,
    queryFn: async () => {
      const d = today();
      const [{ data: visits }, { count: newPatients }, labs] = await Promise.all([
        supabase.from("visits").select("status, service_key").eq("queue_date", d),
        supabase.from("patients").select("id", { count: "exact", head: true }).gte("created_at", `${d}T00:00:00`),
        seesLab
          ? supabase.from("lab_request_items").select("status, lab_requests!inner(created_at)").gte("lab_requests.created_at", `${d}T00:00:00`)
          : Promise.resolve({ data: [] as { status: string }[] }),
      ]);
      const pendingLab = await (seesLab
        ? supabase.from("lab_request_items").select("id", { count: "exact", head: true }).in("status", ["requested", "collected", "processing", "resulted"])
        : Promise.resolve({ count: 0 }));
      return {
        visits: visits ?? [],
        newPatients: newPatients ?? 0,
        pendingLab: pendingLab.count ?? 0,
        verifiedToday: (labs.data ?? []).filter((i) => i.status === "verified").length,
      };
    },
  });

  const v = data?.visits ?? [];
  const stats = [
    { label: "OPD attendance today", value: v.filter((x) => x.status !== "cancelled").length, icon: Users },
    { label: "Waiting", value: v.filter((x) => x.status === "waiting").length, icon: Clock },
    { label: "In consultation", value: v.filter((x) => x.status === "in_consultation" || x.status === "awaiting_lab").length, icon: Stethoscope },
    ...(seesLab
      ? [
          { label: "Pending lab tests", value: data?.pendingLab ?? 0, icon: FlaskConical },
          { label: "Verified results today", value: data?.verifiedToday ?? 0, icon: CheckCircle2 },
        ]
      : [{ label: "New patients today", value: data?.newPatients ?? 0, icon: Users }]),
  ];
  const max = Math.max(1, ...(services ?? []).map((s) => v.filter((x) => x.service_key === s.key).length));

  return (
    <div>
      <PageHeader title={`Welcome, ${me?.fullName ?? ""}`} subtitle={new Date().toDateString()} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {stats.map((s) => (
          <Card key={s.label}>
            <CardContent className="flex items-center gap-3 p-4">
              <div className="rounded-md bg-secondary p-2 text-primary"><s.icon className="h-5 w-5" /></div>
              <div>
                <div className="text-2xl font-bold">{s.value}</div>
                <div className="text-xs text-muted-foreground">{s.label}</div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
      <div className="mt-5 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle className="text-base">Today's visits by service</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {(services ?? []).map((s) => {
              const n = v.filter((x) => x.service_key === s.key).length;
              return (
                <div key={s.key} className="flex items-center gap-3 text-sm">
                  <div className="w-56 shrink-0 truncate">{s.name}</div>
                  <div className="h-3 flex-1 rounded bg-muted">
                    <div className="h-3 rounded bg-primary" style={{ width: `${(n / max) * 100}%` }} />
                  </div>
                  <div className="w-6 text-right font-semibold">{n}</div>
                </div>
              );
            })}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">Quick actions</CardTitle></CardHeader>
          <CardContent className="flex flex-col gap-2 text-sm">
            {canAccess(roles, "reception") && <>
              <Link className="text-primary hover:underline" to="/patients/new">Register a new patient</Link>
              <Link className="text-primary hover:underline" to="/reception/queue">Check in a patient</Link>
              <Link className="text-primary hover:underline" to="/reception/appointments">Book an appointment</Link>
            </>}
            {canAccess(roles, "opd") && <Link className="text-primary hover:underline" to="/opd">Open OPD queue</Link>}
            {canAccess(roles, "lab") && <Link className="text-primary hover:underline" to="/lab">Open lab worklist</Link>}
            {canAccess(roles, "admin") && <Link className="text-primary hover:underline" to="/admin/staff">Manage staff</Link>}
            <Link className="text-primary hover:underline" to="/patients">Search patients</Link>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
