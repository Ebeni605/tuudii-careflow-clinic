import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ClinicLogo, CLINIC } from "@/components/ClinicBrand";
import { supabase } from "@/integrations/supabase/client";
import { bootstrapAdmin } from "@/lib/admin.functions";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Staff Sign In — Two D Medium Clinic" },
      { name: "description", content: "Sign in to the Two D Medium Clinic management system." },
      { property: "og:title", content: "Staff Sign In — Two D Medium Clinic" },
      { property: "og:description", content: "Secure staff sign in." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [needsSetup, setNeedsSetup] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) navigate({ to: "/dashboard", replace: true });
    });
    supabase.rpc("admin_exists").then(({ data }) => setNeedsSetup(data === false));
  }, [navigate]);

  async function signIn(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (error) { toast.error(error.message.includes("Invalid") ? "Wrong email or password" : "Sign in failed. Check your connection and try again."); return; }
    qc.clear();
    navigate({ to: "/dashboard", replace: true });
  }

  async function setup(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await bootstrapAdmin({ data: { email, password, fullName } });
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      toast.success("Administrator account created");
      navigate({ to: "/dashboard", replace: true });
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid min-h-screen lg:grid-cols-[1.1fr_1fr]">
      <aside className="relative hidden flex-col justify-between overflow-hidden bg-sidebar p-10 text-sidebar-foreground lg:flex">
        <div className="absolute inset-x-0 top-0 h-1 bg-destructive" />
        <div className="flex items-center gap-4">
          <ClinicLogo className="h-20 w-20 ring-4 ring-sidebar-border" />
          <div>
            <div className="text-xl font-extrabold tracking-wide">{CLINIC.name}</div>
            <div className="text-lg opacity-90">{CLINIC.amharic}</div>
            <div className="text-sm font-semibold tracking-[0.2em] opacity-80">{CLINIC.english}</div>
          </div>
        </div>
        <div>
          <h1 className="text-4xl font-extrabold leading-tight">Clinic management<br />for every department.</h1>
          <div className="mt-8 grid grid-cols-3 gap-3 text-sm">
            {["Reception", "OPD", "Laboratory"].map((d) => (
              <div key={d} className="rounded-lg border border-sidebar-border bg-sidebar-accent/60 px-3 py-3 font-semibold">{d}</div>
            ))}
          </div>
        </div>
        <div className="text-xs opacity-70">Tel: {CLINIC.phones} · Authorised staff only</div>
      </aside>
      <div className="flex items-center justify-center bg-gradient-to-b from-secondary to-background px-4 py-10">
      <Card className="w-full max-w-md border-t-4 border-t-primary shadow-xl">
        <CardHeader className="items-center text-center">
          <ClinicLogo className="h-24 w-24 lg:hidden" />
          <div className="text-sm font-bold text-primary lg:hidden">{CLINIC.name}</div>
          <div className="text-xs text-muted-foreground lg:hidden">{CLINIC.english}</div>
          <CardTitle className="pt-2 text-2xl">{needsSetup ? "Create first administrator" : "Staff sign in"}</CardTitle>
          {!needsSetup && <p className="text-sm text-muted-foreground">Use the email and password given to you by the administrator.</p>}
          {needsSetup && (
            <p className="text-sm text-muted-foreground">
              No administrator exists yet. This one-time setup creates the clinic's admin account. All other staff accounts are created by the admin.
            </p>
          )}
        </CardHeader>
        <CardContent>
          <form onSubmit={needsSetup ? setup : signIn} className="space-y-4">
            {needsSetup && (
              <div className="space-y-1.5">
                <Label htmlFor="fn">Full name</Label>
                <Input id="fn" value={fullName} onChange={(e) => setFullName(e.target.value)} required />
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="em">Email</Label>
              <Input id="em" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pw">Password</Label>
              <Input id="pw" type="password" autoComplete={needsSetup ? "new-password" : "current-password"} minLength={needsSetup ? 8 : undefined} value={password} onChange={(e) => setPassword(e.target.value)} required />
            </div>
            <Button type="submit" className="w-full" disabled={busy}>
              {busy ? "Please wait…" : needsSetup ? "Create administrator" : "Sign in"}
            </Button>
            {!needsSetup && <p className="text-center text-xs text-muted-foreground">Forgot your password? Ask the clinic administrator to reset it.</p>}
          </form>
        </CardContent>
      </Card>
      </div>
    </div>
  );
}
