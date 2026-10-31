import { queryOptions, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { redirect, useNavigate } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { canAccess, homePathFor, type AppRole, type Area } from "./workflow";

export type Staff = {
  id: string;
  email: string;
  fullName: string;
  phone: string;
  active: boolean;
  canSelfVerify: boolean;
  /** Explicit permission to verify lab results (admin-set, enforced by the database). */
  canVerifyLab: boolean;
  roles: AppRole[];
};

async function fetchStaff(): Promise<Staff | null> {
  const { data } = await supabase.auth.getUser();
  const user = data.user;
  if (!user) return null;
  const [{ data: profile, error: pe }, { data: roles, error: re }] = await Promise.all([
    supabase.from("profiles").select("*").eq("id", user.id).maybeSingle(),
    supabase.from("user_roles").select("role").eq("user_id", user.id),
  ]);
  if (pe || re) throw new Error("Could not load your staff profile");
  const active = profile?.active ?? false;
  return {
    id: user.id,
    email: user.email ?? "",
    fullName: profile?.full_name || user.email || "",
    phone: profile?.phone ?? "",
    active,
    canSelfVerify: profile?.can_self_verify ?? false,
    canVerifyLab: active && (roles ?? []).some((r) => r.role === "laboratory_technician") && (profile?.can_verify_lab ?? false),
    // A disabled account keeps no effective roles (the database enforces the same rule)
    roles: active ? (roles ?? []).map((r) => r.role as AppRole) : [],
  };
}

export const staffQuery = queryOptions({ queryKey: ["me"], queryFn: fetchStaff, staleTime: 60_000 });

export function useStaff() {
  return useQuery(staffQuery);
}

/** Route guard: send staff without the right role to the no-access page before the page loads. */
export function requireArea(area: Area) {
  return async ({ context }: { context: { queryClient: QueryClient } }) => {
    const me = await context.queryClient.ensureQueryData(staffQuery);
    if (!me) throw redirect({ to: "/auth" });
    if (!canAccess(me.roles, area)) throw redirect({ to: "/no-access" });
  };
}

/** Guard for /dashboard (the post-sign-in landing): non-administrators go to their own department dashboard. */
export async function requireDashboardOrHome({ context }: { context: { queryClient: QueryClient } }) {
  const me = await context.queryClient.ensureQueryData(staffQuery);
  if (!me) throw redirect({ to: "/auth" });
  const home = homePathFor(me.roles);
  if (home !== "/dashboard") throw redirect({ to: home, replace: true });
}

export function useSignOut() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  return async () => {
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  };
}
