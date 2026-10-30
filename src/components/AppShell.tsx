import { Link, Outlet, useRouterState } from "@tanstack/react-router";
import type { ReactNode } from "react";
import {
  LayoutDashboard, Users, UserPlus, ListOrdered, CalendarDays, Stethoscope,
  FlaskConical, ShieldCheck, TestTubes, ScrollText, LogOut,
} from "lucide-react";
import {
  Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent, SidebarGroupLabel, SidebarMenu,
  SidebarMenuButton, SidebarMenuItem, SidebarProvider, SidebarTrigger, SidebarHeader, SidebarFooter, useSidebar,
} from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { ClinicLogo } from "@/components/ClinicBrand";
import { useSignOut, useStaff } from "@/lib/auth";
import { canAccess, ROLE_LABELS, type Area } from "@/lib/workflow";

const NAV: { label: string; area: Area; items: { title: string; url: string; icon: typeof Users }[] }[] = [
  { label: "Overview", area: "dashboard", items: [{ title: "Dashboard", url: "/dashboard", icon: LayoutDashboard }] },
  {
    label: "Reception", area: "reception", items: [
      { title: "Patients", url: "/patients", icon: Users },
      { title: "Register patient", url: "/patients/new", icon: UserPlus },
      { title: "Check-in & queue", url: "/reception/queue", icon: ListOrdered },
      { title: "Appointments", url: "/reception/appointments", icon: CalendarDays },
    ],
  },
  { label: "OPD", area: "opd", items: [{ title: "OPD queue", url: "/opd", icon: Stethoscope }] },
  { label: "Laboratory", area: "lab", items: [{ title: "Lab worklist", url: "/lab", icon: FlaskConical }] },
  {
    label: "Administration", area: "admin", items: [
      { title: "Staff & roles", url: "/admin/staff", icon: ShieldCheck },
      { title: "Test catalogue", url: "/admin/tests", icon: TestTubes },
      { title: "Audit log", url: "/admin/audit", icon: ScrollText },
    ],
  },
];

function AppSidebar() {
  const { data: me } = useStaff();
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const path = useRouterState({ select: (r) => r.location.pathname });
  const roles = me?.roles ?? [];
  const groups = NAV.filter((g) => canAccess(roles, g.area));
  // Clinicians and lab technicians can also search patients
  if (!canAccess(roles, "reception") && roles.length) {
    groups.splice(1, 0, { label: "Patients", area: "patients", items: [{ title: "Patient search", url: "/patients", icon: Users }] });
  }
  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="flex-row items-center gap-2 p-3">
        <ClinicLogo className="h-10 w-10 shrink-0" />
        {!collapsed && (
          <div className="leading-tight">
            <div className="text-sm font-bold">Two D Medium Clinic</div>
            <div className="text-[11px] opacity-80">G/Galeessa Tuudii</div>
          </div>
        )}
      </SidebarHeader>
      <SidebarContent>
        {groups.map((g) => (
          <SidebarGroup key={g.label}>
            <SidebarGroupLabel className="text-sidebar-foreground/70">{g.label}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {g.items.map((item) => (
                  <SidebarMenuItem key={item.url}>
                    <SidebarMenuButton asChild isActive={path === item.url} tooltip={item.title}>
                      <Link to={item.url}>
                        <item.icon className="h-4 w-4" />
                        <span>{item.title}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>
      <SidebarFooter />
    </Sidebar>
  );
}

export function AppShell() {
  const { data: me } = useStaff();
  const signOut = useSignOut();
  return (
    <SidebarProvider>
      <div className="flex min-h-screen w-full">
        <div className="no-print"><AppSidebar /></div>
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="no-print sticky top-0 z-10 flex h-14 items-center gap-3 border-b bg-card px-3">
            <SidebarTrigger />
            <div className="flex-1" />
            {me && (
              <div className="text-right text-sm leading-tight">
                <div className="font-medium">{me.fullName}</div>
                <div className="text-xs text-muted-foreground">{me.roles.map((r) => ROLE_LABELS[r]).join(", ") || "No role assigned"}</div>
              </div>
            )}
            <Button variant="ghost" size="icon" onClick={signOut} aria-label="Sign out"><LogOut className="h-4 w-4" /></Button>
          </header>
          <main className="flex-1 p-4 md:p-6"><Outlet /></main>
        </div>
      </div>
    </SidebarProvider>
  );
}

/** Renders children only for staff whose role may use this area. */
export function RequireArea({ area, children }: { area: Area; children: ReactNode }) {
  const { data: me, isLoading } = useStaff();
  if (isLoading) return <div className="text-muted-foreground">Loading…</div>;
  if (!me || !canAccess(me.roles, area)) {
    return (
      <div className="mx-auto mt-16 max-w-md rounded-lg border bg-card p-6 text-center">
        <h2 className="text-lg font-semibold">No access</h2>
        <p className="mt-2 text-sm text-muted-foreground">Your role does not include this section. Contact the administrator if you need access.</p>
      </div>
    );
  }
  return <>{children}</>;
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-bold text-primary">{title}</h1>
        {subtitle && <p className="text-sm text-muted-foreground">{subtitle}</p>}
      </div>
      {actions && <div className="no-print flex gap-2">{actions}</div>}
    </div>
  );
}
