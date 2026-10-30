import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { ClinicLogo, CLINIC } from "@/components/ClinicBrand";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Two D Medium Clinic — Staff Portal" },
      { name: "description", content: "Staff portal for Reception, OPD and Laboratory at Kilinika G/Galeessa Tuudii – Two D Medium Clinic." },
      { property: "og:title", content: "Two D Medium Clinic — Staff Portal" },
      { property: "og:description", content: "Reception, OPD and Laboratory in one shared patient system." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Index,
});

function Index() {
  const navigate = useNavigate();
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) navigate({ to: "/dashboard", replace: true });
    });
  }, [navigate]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-b from-secondary to-background px-4 text-center">
      <ClinicLogo className="h-40 w-40 shadow-lg" />
      <h1 className="mt-6 text-3xl font-extrabold text-primary">{CLINIC.name}</h1>
      <p className="mt-1 text-lg">{CLINIC.amharic}</p>
      <p className="font-semibold tracking-widest text-muted-foreground">{CLINIC.english}</p>
      <div className="mt-6 flex gap-3 text-sm text-muted-foreground">
        <span>Reception</span>·<span>OPD</span>·<span>Laboratory</span>
      </div>
      <Button asChild size="lg" className="mt-8">
        <Link to="/auth">Staff sign in</Link>
      </Button>
    </div>
  );
}
