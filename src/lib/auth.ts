import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import type { AppRole } from "./workflow";

export type Staff = {
  id: string;
  email: string;
  fullName: string;
  canSelfVerify: boolean;
  roles: AppRole[];
};

export function useStaff() {
  return useQuery({
    queryKey: ["me"],
    staleTime: 60_000,
    queryFn: async (): Promise<Staff | null> => {
      const { data } = await supabase.auth.getUser();
      const user = data.user;
      if (!user) return null;
      const [{ data: profile }, { data: roles }] = await Promise.all([
        supabase.from("profiles").select("*").eq("id", user.id).maybeSingle(),
        supabase.from("user_roles").select("role").eq("user_id", user.id),
      ]);
      return {
        id: user.id,
        email: user.email ?? "",
        fullName: profile?.full_name || user.email || "",
        canSelfVerify: profile?.can_self_verify ?? false,
        roles: profile?.active === false ? [] : (roles ?? []).map((r) => r.role as AppRole),
      };
    },
  });
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
