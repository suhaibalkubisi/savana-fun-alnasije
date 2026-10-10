"use client";
import { useState } from "react";
import Link from "next/link";
import { Upload, ArrowRight, FileSpreadsheet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "@/components/ui/alert-dialog";
import {
  Table,
  TableHeader,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
} from "@/components/ui/table";
import { toast } from "sonner";
import { api, changed } from "@/lib/hr/api";
import { parseXlsx } from "@/lib/hr/xlsx-import";
import type { PreviewRow } from "@/lib/server/import";
import { LoadState, PageTitle } from "./shared";
interface Preview {
  rows: PreviewRow[];
  errors: number;
  create: number;
  update: number;
  token: string | null;
}
export function ImportPage() {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [fileName, setFileName] = useState("");
  const [error, setError] = useState("");
  const [confirm, setConfirm] = useState(false);
  return (
    <>
      <Button asChild variant="ghost" className="back-link">
        <Link href="/employees">
          <ArrowRight size={17} />
          الموظفون
        </Link>
      </Button>
      <PageTitle title="استيراد الموظفين" />
      <section className="panel">
        <div className="import-control">
          <div className="import-icon">
            <FileSpreadsheet size={29} />
          </div>
          <div>
            <label htmlFor="import-file">ملف الموظفين — Excel</label>
            <Input
              id="import-file"
              type="file"
              accept=".xlsx"
              disabled={busy}
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                setBusy(true);
                setError("");
                setPreview(null);
                setFileName(file.name);
                try {
                  const parsed = await parseXlsx(file);
                  setPreview(
                    await api("/api/import", { action: "preview", ...parsed }),
                  );
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            />
          </div>
        </div>
        {error && (
          <p className="form-error import-error" role="alert">
            {error}
          </p>
        )}
        <LoadState loading={busy && !preview}>
          {preview && (
            <>
              <div className="import-summary">
                <span>{fileName}</span>
                <strong>{preview.create} إضافة</strong>
                <strong>{preview.update} تحديث</strong>
                <span className={preview.errors ? "form-error" : ""}>
                  {preview.errors} أخطاء
                </span>
                <Button
                  disabled={busy || !!preview.errors || !preview.token}
                  onClick={() => setConfirm(true)}
                >
                  <Upload size={17} />
                  تأكيد الاستيراد
                </Button>
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>الصف</TableHead>
                    <TableHead>الموظف</TableHead>
                    <TableHead>القسم</TableHead>
                    <TableHead>العملية</TableHead>
                    <TableHead>التحقق</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {preview.rows.map((r, i) => (
                    <TableRow key={i}>
                      <TableCell>
                        {r.sheet} · {r.row}
                      </TableCell>
                      <TableCell>{r.name}</TableCell>
                      <TableCell>
                        <bdi>{r.department}</bdi>
                      </TableCell>
                      <TableCell>
                        {r.mode === "update" ? "تحديث" : "إضافة"}
                      </TableCell>
                      <TableCell
                        className={
                          r.error
                            ? "form-error"
                            : r.warning
                              ? "text-amber-800"
                              : "text-emerald-800"
                        }
                      >
                        {r.error || r.warning || "سليم"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </>
          )}
        </LoadState>
      </section>
      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle>تطبيق استيراد الموظفين؟</AlertDialogTitle>
            <AlertDialogDescription>
              {preview?.create} إضافة · {preview?.update} تحديث
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction
              disabled={busy}
              onClick={async (e) => {
                e.preventDefault();
                if (!preview?.token) return;
                setBusy(true);
                try {
                  const r = await api<{ count: number }>("/api/import", {
                    action: "apply",
                    token: preview.token,
                    confirmed: true,
                  });
                  changed();
                  setPreview(null);
                  setConfirm(false);
                  toast.success(`تم استيراد ${r.count} موظف`);
                } catch (e) {
                  setError((e as Error).message);
                  setConfirm(false);
                } finally {
                  setBusy(false);
                }
              }}
            >
              تطبيق
            </AlertDialogAction>
            <AlertDialogCancel disabled={busy}>إلغاء</AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
