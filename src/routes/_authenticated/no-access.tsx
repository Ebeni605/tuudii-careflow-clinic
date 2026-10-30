import { createFileRoute, Link } from "@tanstack/react-router";
import { ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSignOut, useStaff } from "@/lib/auth";

export const Route = createFileRoute("/_authenticated/no-access")({
  head: () => ({ meta: [{ title: "No Access — Two D Medium Clinic" }] }),
  component: NoAccess,
});

function NoAccess() {
  const { data: me } = useStaff();
  const signOut = useSignOut();
  const disabled = me && !me.active;
  const noRole = me && me.active && me.roles.length === 0;
  return (
    <div className="mx-auto mt-12 max-w-md rounded-lg border border-t-4 border-t-destructive bg-card p-6 text-center shadow-sm">
      <ShieldAlert className="mx-auto h-10 w-10 text-destructive" />
      <h1 className="mt-3 text-xl font-bold">No access</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        {disabled
          ? "Your account has been disabled. Contact the clinic administrator."
          : noRole
            ? "Your account has no role yet. Ask the administrator to assign one."
            : "Your role does not include this section. Contact the administrator if you need access."}
      </p>
      <div className="mt-5 flex justify-center gap-2">
        {me?.roles.length ? <Button asChild><Link to="/dashboard">Go to dashboard</Link></Button> : null}
        <Button variant="outline" onClick={signOut}>Sign out</Button>
      </div>
    </div>
  );
}
