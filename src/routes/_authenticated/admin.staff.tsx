import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeader, RequireArea } from "@/components/AppShell";
import { createStaff, listStaff, updateStaff } from "@/lib/admin.functions";
import { ROLE_LABELS, type AppRole } from "@/lib/workflow";

export const Route = createFileRoute("/_authenticated/admin/staff")({
  head: () => ({ meta: [{ title: "Staff & Roles — Two D Medium Clinic" }] }),
  component: () => <RequireArea area="admin"><Staff /></RequireArea>,
});

const ALL: AppRole[] = ["admin", "receptionist", "clinician", "lab_tech"];

function RolePicker({ value, onChange }: { value: AppRole[]; onChange: (r: AppRole[]) => void }) {
  return (
    <div className="grid grid-cols-2 gap-2">
      {ALL.map((r) => (
        <label key={r} className="flex items-center gap-2 text-sm">
          <Checkbox checked={value.includes(r)} onCheckedChange={(c) => onChange(c ? [...value, r] : value.filter((x) => x !== r))} />
          {ROLE_LABELS[r]}
        </label>
      ))}
    </div>
  );
}

function Staff() {
  const list = useServerFn(listStaff);
  const create = useServerFn(createStaff);
  const update = useServerFn(updateStaff);
  const { data, refetch } = useQuery({ queryKey: ["staff"], queryFn: () => list() });
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ fullName: "", email: "", phone: "", password: "", roles: [] as AppRole[] });
  const [edit, setEdit] = useState<null | { userId: string; name: string; roles: AppRole[]; active: boolean; canSelfVerify: boolean; newPassword: string }>(null);

  async function add() {
    try {
      await create({ data: f });
      toast.success("Staff account created");
      setOpen(false); setF({ fullName: "", email: "", phone: "", password: "", roles: [] }); refetch();
    } catch (e) { toast.error((e as Error).message); }
  }
  async function save() {
    if (!edit) return;
    try {
      await update({ data: { userId: edit.userId, roles: edit.roles, active: edit.active, canSelfVerify: edit.canSelfVerify, newPassword: edit.newPassword || undefined } });
      toast.success("Saved"); setEdit(null); refetch();
    } catch (e) { toast.error((e as Error).message); }
  }

  return (
    <div>
      <PageHeader title="Staff & roles" subtitle="Only the administrator creates staff accounts. There is no public sign-up."
        actions={
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild><Button>Add staff</Button></DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>New staff account</DialogTitle></DialogHeader>
              <div className="space-y-3">
                <div className="space-y-1.5"><Label>Full name</Label><Input value={f.fullName} onChange={(e) => setF({ ...f, fullName: e.target.value })} /></div>
                <div className="space-y-1.5"><Label>Email (used to sign in)</Label><Input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></div>
                <div className="space-y-1.5"><Label>Phone</Label><Input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></div>
                <div className="space-y-1.5"><Label>Temporary password (min. 8 characters)</Label><Input type="text" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></div>
                <div className="space-y-1.5"><Label>Roles</Label><RolePicker value={f.roles} onChange={(roles) => setF({ ...f, roles })} /></div>
                <Button className="w-full" onClick={add}>Create account</Button>
              </div>
            </DialogContent>
          </Dialog>
        } />
      <Card>
        <Table>
          <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Email</TableHead><TableHead>Roles</TableHead><TableHead>Status</TableHead><TableHead>Last sign in</TableHead><TableHead /></TableRow></TableHeader>
          <TableBody>
            {data?.map((s) => (
              <TableRow key={s.id}>
                <TableCell className="font-medium">{s.fullName}</TableCell>
                <TableCell>{s.email}</TableCell>
                <TableCell className="text-sm">{s.roles.map((r) => ROLE_LABELS[r]).join(", ") || "—"}{s.canSelfVerify && <div className="text-xs text-muted-foreground">May self-verify lab results</div>}</TableCell>
                <TableCell>{s.active ? "Active" : <span className="text-destructive">Disabled</span>}</TableCell>
                <TableCell className="text-sm">{s.lastSignIn ? new Date(s.lastSignIn).toLocaleString() : "Never"}</TableCell>
                <TableCell><Button size="sm" variant="outline" onClick={() => setEdit({ userId: s.id, name: s.fullName, roles: s.roles, active: s.active, canSelfVerify: s.canSelfVerify, newPassword: "" })}>Edit</Button></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
      <Dialog open={!!edit} onOpenChange={(o) => !o && setEdit(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Edit {edit?.name}</DialogTitle></DialogHeader>
          {edit && <div className="space-y-4">
            <RolePicker value={edit.roles} onChange={(roles) => setEdit({ ...edit, roles })} />
            <label className="flex items-center gap-2 text-sm"><Switch checked={edit.active} onCheckedChange={(active) => setEdit({ ...edit, active })} />Account active</label>
            <label className="flex items-center gap-2 text-sm"><Switch checked={edit.canSelfVerify} onCheckedChange={(canSelfVerify) => setEdit({ ...edit, canSelfVerify })} />Senior technician — may verify own results</label>
            <div className="space-y-1.5"><Label>Reset password (optional)</Label><Input value={edit.newPassword} onChange={(e) => setEdit({ ...edit, newPassword: e.target.value })} placeholder="New password, min. 8 characters" /></div>
            <Button className="w-full" onClick={save}>Save</Button>
          </div>}
        </DialogContent>
      </Dialog>
    </div>
  );
}
