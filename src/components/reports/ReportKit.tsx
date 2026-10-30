import type { ReactNode } from "react";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { downloadCsv, toCsv, type Column } from "@/lib/reports";

/** A titled table with its own "Export CSV" button. */
export function ReportTable<T extends Record<string, unknown>>({
  title, rows, columns, csvName, empty = "No records in this period.", footer,
}: {
  title: string;
  rows: T[];
  columns: Column<T>[];
  csvName: string;
  empty?: string;
  footer?: ReactNode;
}) {
  return (
    <Card className="break-inside-avoid">
      <CardHeader className="flex-row items-center justify-between gap-2 space-y-0 pb-2">
        <CardTitle className="text-base">{title}</CardTitle>
        <Button size="sm" variant="outline" className="no-print" disabled={!rows.length}
          onClick={() => downloadCsv(csvName, toCsv(rows, columns))}>
          <Download className="mr-1 h-3.5 w-3.5" />Export CSV
        </Button>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>{columns.map((c, ci) => <TableHead key={`${c.key}-${ci}`} className={c.align === "right" ? "text-right" : ""}>{c.label}</TableHead>)}</TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 && <TableRow><TableCell colSpan={columns.length} className="py-6 text-center text-sm text-muted-foreground">{empty}</TableCell></TableRow>}
              {rows.map((r, i) => (
                <TableRow key={i}>
                  {columns.map((c, ci) => (
                    <TableCell key={`${c.key}-${ci}`} className={`text-sm ${c.align === "right" ? "text-right tabular-nums" : ""}`}>
                      {c.format ? c.format(r[c.key], r) : String(r[c.key] ?? "—")}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        {footer && <div className="no-print border-t px-4 py-2">{footer}</div>}
      </CardContent>
    </Card>
  );
}

export function StatGrid({ items, loading }: { items: { label: string; value: ReactNode; tone?: "warn" | undefined }[]; loading?: boolean }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      {items.map((s) => (
        <Card key={s.label} className={s.tone === "warn" ? "border-destructive/40" : ""}>
          <CardContent className="p-4">
            <div className={`text-2xl font-bold tabular-nums ${s.tone === "warn" ? "text-destructive" : "text-primary"}`}>{loading ? "…" : s.value}</div>
            <div className="text-xs text-muted-foreground">{s.label}</div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

/** Horizontal bars for small breakdowns (by service, sex, age group…). */
export function BarList({ title, items }: { title: string; items: { label: string; value: number }[] }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <Card className="break-inside-avoid">
      <CardHeader className="pb-2"><CardTitle className="text-base">{title}</CardTitle></CardHeader>
      <CardContent className="space-y-2">
        {items.length === 0 && <p className="text-sm text-muted-foreground">No records in this period.</p>}
        {items.map((i) => (
          <div key={i.label} className="flex items-center gap-3 text-sm">
            <div className="w-28 shrink-0 truncate sm:w-52" title={i.label}>{i.label}</div>
            <div className="h-3 flex-1 rounded bg-muted"><div className="h-3 rounded bg-primary" style={{ width: `${(i.value / max) * 100}%` }} /></div>
            <div className="w-10 text-right font-semibold tabular-nums">{i.value}</div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

export function Pager({ offset, limit, total, onChange }: { offset: number; limit: number; total: number; onChange: (o: number) => void }) {
  const page = Math.floor(offset / limit) + 1;
  const pages = Math.max(1, Math.ceil(total / limit));
  return (
    <div className="flex items-center justify-between gap-2 text-sm">
      <span className="text-muted-foreground">{total} record(s) · page {page} of {pages}</span>
      <div className="flex gap-2">
        <Button size="sm" variant="outline" disabled={offset === 0} onClick={() => onChange(Math.max(0, offset - limit))}>Previous</Button>
        <Button size="sm" variant="outline" disabled={offset + limit >= total} onClick={() => onChange(offset + limit)}>Next</Button>
      </div>
    </div>
  );
}
