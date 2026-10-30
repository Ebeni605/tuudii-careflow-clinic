import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { TemplateField } from "@/lib/templates";
import { cn } from "@/lib/utils";

export function F({ label, children, className, required }: { label: string; children: React.ReactNode; className?: string; required?: boolean }) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <Label>{label}{required && <span className="ml-0.5 text-destructive" aria-label="required">*</span>}</Label>
      {children}
    </div>
  );
}

export function TemplateInput({ field, value, onChange, disabled }: { field: TemplateField; value: unknown; onChange: (v: unknown) => void; disabled: boolean }) {
  const v = value == null ? "" : String(value);
  if (field.type === "checkbox") {
    return (
      <label className="flex items-start gap-2 pt-1 text-sm md:pt-7">
        <Checkbox disabled={disabled} checked={value === true} onCheckedChange={(c) => onChange(c === true)} className="mt-0.5" />
        <span>{field.label}{field.required && <span className="ml-0.5 text-destructive">*</span>}</span>
      </label>
    );
  }
  if (field.type === "select") {
    return (
      <F label={field.label} required={field.required}>
        <Select disabled={disabled} value={v} onValueChange={onChange}>
          <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
          <SelectContent>{field.options!.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}</SelectContent>
        </Select>
      </F>
    );
  }
  if (field.type === "textarea") {
    return (
      <F label={field.label} required={field.required} className="md:col-span-3">
        <Textarea disabled={disabled} rows={2} maxLength={2000} value={v} onChange={(e) => onChange(e.target.value)} />
      </F>
    );
  }
  return (
    <F label={field.label} required={field.required}>
      <Input
        disabled={disabled}
        type={field.type}
        step={field.type === "number" ? "any" : undefined}
        maxLength={200}
        value={v}
        onChange={(e) => onChange(field.type === "number" ? (e.target.value === "" ? null : Number(e.target.value)) : e.target.value)}
      />
    </F>
  );
}
