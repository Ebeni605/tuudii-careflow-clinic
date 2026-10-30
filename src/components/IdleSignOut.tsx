import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useSignOut } from "@/lib/auth";
import { IDLE_MINUTES, IDLE_WARNING_MINUTES, idleRemainingMs } from "@/lib/session";

const KEY = "clinic.lastActivity";
const EVENTS = ["pointerdown", "keydown", "scroll", "touchstart"] as const;

/** Signs staff out of a shared computer after a period without activity (synchronised across tabs). */
export function IdleSignOut() {
  const signOut = useSignOut();
  const [warn, setWarn] = useState(false);
  const [left, setLeft] = useState(0);
  const lastWrite = useRef(0);

  useEffect(() => {
    const touch = () => {
      const now = Date.now();
      if (now - lastWrite.current < 15_000) return;
      lastWrite.current = now;
      localStorage.setItem(KEY, String(now));
      setWarn(false);
    };
    localStorage.setItem(KEY, String(Date.now()));
    EVENTS.forEach((e) => window.addEventListener(e, touch, { passive: true }));
    const timer = window.setInterval(() => {
      const last = Number(localStorage.getItem(KEY) ?? Date.now());
      const remaining = idleRemainingMs(last, Date.now());
      if (remaining <= 0) {
        window.clearInterval(timer);
        toast.info(`Signed out after ${IDLE_MINUTES} minutes without activity`);
        void signOut();
        return;
      }
      setLeft(Math.ceil(remaining / 1000));
      setWarn(remaining <= IDLE_WARNING_MINUTES * 60_000);
    }, 5_000);
    return () => {
      EVENTS.forEach((e) => window.removeEventListener(e, touch));
      window.clearInterval(timer);
    };
  }, [signOut]);

  return (
    <Dialog open={warn} onOpenChange={(o) => { if (!o) { localStorage.setItem(KEY, String(Date.now())); setWarn(false); } }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Are you still there?</DialogTitle>
          <DialogDescription>For patient privacy you will be signed out in about {Math.max(1, Math.round(left / 60))} minute(s) unless you continue.</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => void signOut()}>Sign out now</Button>
          <Button onClick={() => { localStorage.setItem(KEY, String(Date.now())); setWarn(false); }}>Stay signed in</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
