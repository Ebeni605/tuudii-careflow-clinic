import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { CalendarDays, ClipboardCheck, Clock, Footprints, UserPlus, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LoadError, PageHeader, RequireArea } from "@/components/AppShell";
import { StatusBadge } from "@/components/StatusBadge";
import { CheckInDialog } from "@/components/CheckInDialog";
import { supabase } from "@/integrations/supabase/client";
import { APPT_STATUS_LABEL, clinicDayRange, patientName, today, useLiveTable, useServices } from "@/lib/data";
import { requireArea } from "@/lib/auth";

export const Route = createFileRoute("/_authenticated/reception/")({
  beforeLoad: requireArea("reception"),
  head: () => ({ meta: [{ title: "Reception — Two D Medium Clinic" }] }),
  component: () => <RequireArea area="reception"><ReceptionDashboard /></RequireArea>,
});

function ReceptionDashboard() {
  const { data: services } = useServices();
  useLiveTable("visits", [["reception_dash"]]);
  const d = today();
  const range = clinicDayRange(d);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["reception_dash", d],
    queryFn: async () => {
      const [total, regToday, visits, appts, recent] = await Promise.all([
        supabase.from("patients").select("id", { count: "exact", head: true }).eq("archived", false),
        supabase.from("patients").select("id", { count: "exact", head: true }).eq("archived", false).gte("created_at", range.from).lte("created_at", range.to),
        supabase.from("visits").select("status, visit_type").eq("queue_date", d),
        supabase.from("appointments").select("*, patients(id, mrn, first_name, middle_name, last_name)").gte("scheduled_at", range.from).lte("scheduled_at", range.to).order("scheduled_at"),
        supabase.from("patients").select("id, mrn, first_name, middle_name, last_name, sex, created_at").order("created_at", { ascending: false }).limit(6),
      ]);
      const err = total.error ?? regToday.error ?? visits.error ?? appts.error ?? recent.error;
      if (err) throw err;
      return { total: total.count ?? 0, regToday: regToday.count ?? 0, visits: visits.data ?? [], appts: appts.data ?? [], recent: recent.data ?? [] };
    },
  });
  const v = data?.visits ?? [];
  const appts = data?.appts ?? [];
  const svc = (k: string) => services?.find((s) => s.key === k)?.name ?? k;
  const stats = [
    { label: "Registered patients", value: data?.total, icon: Users },
    { label: "Registered today", value: data?.regToday, icon: UserPlus },
    { label: "Today's appointments", value: appts.filter((a) => a.status !== "cancelled").length, icon: CalendarDays },
    { label: "Walk-ins today", value: v.filter((x) => x.visit_type === "walk_in").length, icon: Footprints },
    { label: "Waiting for OPD", value: v.filter((x) => x.status === "waiting").length, icon: Clock },
    { label: "Check-ins today", value: v.filter((x) => x.status !== "cancelled").length, icon: ClipboardCheck },
  ];

  return (
    <div>
      <PageHeader
        title="Reception"
        subtitle={`Today, ${new Date().toLocaleDateString([], { dateStyle: "full" })}`}
        actions={<>
          <Button variant="outline" asChild><Link to="/reception/queue">Check-in & queue</Link></Button>
          <Button size="lg" asChild><Link to="/patients/new"><UserPlus className="mr-1 h-4 w-4" />Register new patient</Link></Button>
        </>}
      />
      {error && <div className="mb-4"><LoadError onRetry={() => refetch()} /></div>}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {stats.map((s) => (
          <Card key={s.label}>
            <CardContent className="flex items-center gap-3 p-4">
              <div className="rounded-md bg-secondary p-2 text-primary"><s.icon className="h-5 w-5" /></div>
              <div><div className="text-2xl font-bold">{isLoading ? "…" : s.value ?? 0}</div><div className="text-xs text-muted-foreground">{s.label}</div></div>
            </CardContent>
          </Card>
        ))}
      </div>
      <div className="mt-5 grid gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base">Today's appointments</CardTitle>
            <Link to="/reception/appointments" className="text-sm text-primary hover:underline">All appointments</Link>
          </CardHeader>
          <CardContent className="divide-y">
            {!isLoading && appts.length === 0 && <p className="py-4 text-sm text-muted-foreground">No appointments today.</p>}
            {appts.map((a) => (
              <div key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                <div className="flex items-center gap-3">
                  <span className="w-14 font-semibold text-primary">{new Date(a.scheduled_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                  <div>
                    <div className="font-medium">{patientName(a.patients)} <span className="font-mono text-xs text-muted-foreground">{a.patients?.mrn}</span></div>
                    <div className="text-xs text-muted-foreground">{svc(a.service_key)}{a.reason && ` · ${a.reason}`}</div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <StatusBadge status={a.status} label={APPT_STATUS_LABEL[a.status]} />
                  {a.status === "scheduled" && a.patients && <CheckInDialog patientId={a.patients.id} patientLabel={patientName(a.patients)} appointmentId={a.id} defaultService={a.service_key} />}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base">Recent registrations</CardTitle>
            <Link to="/patients" className="text-sm text-primary hover:underline">All patients</Link>
          </CardHeader>
          <CardContent className="divide-y">
            {!isLoading && data?.recent.length === 0 && <p className="py-4 text-sm text-muted-foreground">No patients registered yet.</p>}
            {data?.recent.map((p) => (
              <Link key={p.id} to="/patients/$patientId" params={{ patientId: p.id }} className="flex items-center justify-between py-2 text-sm hover:text-primary">
                <span><span className="font-medium">{patientName(p)}</span> <span className="font-mono text-xs text-muted-foreground">{p.mrn}</span></span>
                <span className="text-xs text-muted-foreground">{new Date(p.created_at).toLocaleDateString()}</span>
              </Link>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
