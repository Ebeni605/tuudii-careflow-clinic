import { useId } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useServices } from "@/lib/data";
import { OTHER_SERVICE_KEY, SERVICE_DETAIL_MAX, groupOf, optionValueFor, serviceOptions } from "@/lib/services";

/**
 * Select Clinic Service: the ten advertised clinic services, a procedure choice for the
 * surgery/circumcision service, and a details box for "Follow-up and Various Other Services".
 * `value` is the saved service key (or the group value while the procedure is not chosen yet).
 */
export function ServicePicker({ value, detail, onChange, label = "Clinic service *" }: {
  value: string; detail: string; onChange: (key: string, detail: string) => void; label?: string;
}) {
  const id = useId();
  const { data: services, isLoading, error, refetch } = useServices();
  const options = serviceOptions(services ?? []);
  const selected = value ? optionValueFor(value) : "";
  const group = selected ? groupOf(selected) : undefined;

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor={`${id}-svc`}>{label}</Label>
        {error ? (
          <div className="flex items-center justify-between gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm">
            <span>Could not load the service list.</span>
            <Button type="button" size="sm" variant="outline" onClick={() => refetch()}>Retry</Button>
          </div>
        ) : (
          <Select value={selected} onValueChange={(v) => onChange(v, v === OTHER_SERVICE_KEY ? detail : "")} disabled={isLoading || options.length === 0}>
            <SelectTrigger id={`${id}-svc`} aria-label="Select clinic service">
              <SelectValue placeholder={isLoading ? "Loading services…" : options.length === 0 ? "No services set up yet" : "Select Clinic Service"} />
            </SelectTrigger>
            <SelectContent className="max-h-[min(24rem,var(--radix-select-content-available-height))] max-w-[calc(100vw-2rem)]">
              {options.map((o) => <SelectItem key={o.value} value={o.value} className="whitespace-normal">{o.label}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
        {!isLoading && !error && options.length === 0 && (
          <p className="text-xs text-muted-foreground">The clinic service list is empty. Ask the administrator to add services under Admin → Services.</p>
        )}
      </div>

      {group && (
        <div className="space-y-1.5">
          <Label htmlFor={`${id}-proc`}>Procedure *</Label>
          <Select value={(group.keys as readonly string[]).includes(value) ? value : ""} onValueChange={(k) => onChange(k, "")}>
            <SelectTrigger id={`${id}-proc`} aria-label="Procedure"><SelectValue placeholder="Select procedure" /></SelectTrigger>
            <SelectContent>
              {group.keys.map((k) => <SelectItem key={k} value={k}>{group.procedureLabels[k]}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      )}

      {value === OTHER_SERVICE_KEY && (
        <div className="space-y-1.5">
          <Label htmlFor={`${id}-detail`}>Service details</Label>
          <Input id={`${id}-detail`} value={detail} maxLength={SERVICE_DETAIL_MAX} placeholder="e.g. wound dressing, injection, review of previous visit"
            onChange={(e) => onChange(value, e.target.value)} />
        </div>
      )}
    </div>
  );
}
