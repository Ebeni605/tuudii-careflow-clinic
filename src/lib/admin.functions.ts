import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { AppRole } from "./workflow";

const ROLES: AppRole[] = ["admin", "receptionist", "clinician", "lab_tech"];

function checkPassword(p: string) {
  if (typeof p !== "string" || p.length < 8) throw new Error("Password must be at least 8 characters");
}

/** One-time setup: create the first administrator while no admin exists. */
export const bootstrapAdmin = createServerFn({ method: "POST" })
  .inputValidator((d: { email: string; password: string; fullName: string }) => {
    if (!d?.email?.includes("@")) throw new Error("Valid email required");
    checkPassword(d.password);
    if (!d.fullName?.trim()) throw new Error("Full name required");
    return { email: d.email.trim().toLowerCase(), password: d.password, fullName: d.fullName.trim().slice(0, 120) };
  })
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { count } = await supabaseAdmin
      .from("user_roles")
      .select("id", { count: "exact", head: true })
      .eq("role", "admin");
    if ((count ?? 0) > 0) throw new Error("An administrator already exists. Ask them to create your account.");
    const { data: created, error } = await supabaseAdmin.auth.admin.createUser({
      email: data.email,
      password: data.password,
      email_confirm: true,
      user_metadata: { full_name: data.fullName },
    });
    if (error || !created.user) throw new Error(error?.message ?? "Could not create user");
    await supabaseAdmin.from("profiles").upsert({ id: created.user.id, full_name: data.fullName });
    await supabaseAdmin.from("user_roles").insert({ user_id: created.user.id, role: "admin" });
    return { ok: true };
  });

async function assertAdmin(context: { supabase: any; userId: string }) {
  const { data } = await context.supabase.rpc("has_role", { _user_id: context.userId, _role: "admin" });
  if (!data) throw new Error("Only administrators can manage staff");
}

export const createStaff = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { email: string; password: string; fullName: string; phone?: string; roles: AppRole[] }) => {
    if (!d?.email?.includes("@")) throw new Error("Valid email required");
    checkPassword(d.password);
    const roles = (d.roles ?? []).filter((r) => ROLES.includes(r));
    if (!roles.length) throw new Error("Choose at least one role");
    return { ...d, email: d.email.trim().toLowerCase(), fullName: d.fullName.trim().slice(0, 120), roles };
  })
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: created, error } = await supabaseAdmin.auth.admin.createUser({
      email: data.email,
      password: data.password,
      email_confirm: true,
      user_metadata: { full_name: data.fullName },
    });
    if (error || !created.user) throw new Error(error?.message ?? "Could not create user");
    await supabaseAdmin.from("profiles").upsert({ id: created.user.id, full_name: data.fullName, phone: data.phone ?? null });
    await supabaseAdmin.from("user_roles").insert(data.roles.map((role) => ({ user_id: created.user!.id, role })));
    return { ok: true };
  });

export const listStaff = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const [{ data: users }, { data: profiles }, { data: roles }] = await Promise.all([
      supabaseAdmin.auth.admin.listUsers({ perPage: 500 }),
      supabaseAdmin.from("profiles").select("*"),
      supabaseAdmin.from("user_roles").select("user_id, role"),
    ]);
    return (users?.users ?? []).map((u) => {
      const p = profiles?.find((x) => x.id === u.id);
      return {
        id: u.id,
        email: u.email ?? "",
        fullName: p?.full_name ?? "",
        phone: p?.phone ?? "",
        active: p?.active ?? true,
        canSelfVerify: p?.can_self_verify ?? false,
        canVerifyLab: p?.can_verify_lab ?? false,
        roles: (roles ?? []).filter((r) => r.user_id === u.id).map((r) => r.role as AppRole),
        lastSignIn: u.last_sign_in_at ?? null,
      };
    });
  });

export const updateStaff = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { userId: string; roles: AppRole[]; active: boolean; canSelfVerify: boolean; canVerifyLab?: boolean; newPassword?: string }) => {
    if (d.newPassword) checkPassword(d.newPassword);
    return { ...d, roles: (d.roles ?? []).filter((r) => ROLES.includes(r)) };
  })
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    if (data.userId === context.userId && (!data.roles.includes("admin") || !data.active)) {
      throw new Error("You cannot remove your own administrator access");
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("profiles").update({ active: data.active, can_self_verify: data.canSelfVerify, can_verify_lab: !!data.canVerifyLab }).eq("id", data.userId);
    await supabaseAdmin.from("user_roles").delete().eq("user_id", data.userId);
    if (data.roles.length) {
      await supabaseAdmin.from("user_roles").insert(data.roles.map((role) => ({ user_id: data.userId, role })));
    }
    if (data.newPassword) {
      const { error } = await supabaseAdmin.auth.admin.updateUserById(data.userId, { password: data.newPassword });
      if (error) throw new Error(error.message);
    }
    return { ok: true };
  });
