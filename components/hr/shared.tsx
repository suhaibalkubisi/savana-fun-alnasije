"use client";
import { useId, type ReactNode } from "react";
import {
  Search,
  Inbox,
  RotateCw,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Combobox,
  ComboboxInput,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxList,
  ComboboxItem,
} from "@/components/ui/combobox";
import { Skeleton } from "@/components/ui/skeleton";
import { Empty, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
} from "@/components/ui/pagination";
import {
  employmentLabels,
  statuses,
  type EmploymentStatus,
  type StatusType,
} from "@/lib/hr/types";
export type Option = { value: string; label: string };
export function Field({
  label,
  children,
  className = "",
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={`field ${className}`}>
      <span className="field-label">{label}</span>
      {children}
    </label>
  );
}
export function Choice({
  label,
  value,
  onChange,
  options,
  empty = "الكل",
  disabled = false,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: Option[];
  empty?: string;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <Select
        dir="rtl"
        value={value || "__empty__"}
        onValueChange={(v) => onChange(v === "__empty__" ? "" : v)}
        disabled={disabled}
      >
        <SelectTrigger id={id} className="w-full h-11 bg-white">
          <SelectValue placeholder={empty} />
        </SelectTrigger>
        <SelectContent position="popper">
          <SelectItem value="__empty__">{empty}</SelectItem>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              <bdi>{o.label}</bdi>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
export function SearchPicker({
  label,
  value,
  onChange,
  options,
  disabled = false,
  inputId,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: Option[];
  disabled?: boolean;
  inputId?: string;
}) {
  const id = useId();
  const selected = options.find((o) => o.value === value) || null;
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <Combobox
        items={options}
        value={selected}
        onValueChange={(item) => onChange(item?.value || "")}
        itemToStringLabel={(o) => o.label}
        isItemEqualToValue={(a, b) => a.value === b.value}
        disabled={disabled}
      >
        <ComboboxInput
          id={inputId || id}
          placeholder="بحث بالاسم أو الرقم"
          className="w-full h-11 bg-white"
          showClear
        />
        <ComboboxContent>
          <ComboboxEmpty>لا توجد نتائج</ComboboxEmpty>
          <ComboboxList>
            {(item: Option) => (
              <ComboboxItem key={item.value} value={item}>
                <bdi>{item.label}</bdi>
              </ComboboxItem>
            )}
          </ComboboxList>
        </ComboboxContent>
      </Combobox>
    </div>
  );
}
export function SearchBox({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="search-box">
      <Search size={17} />
      <Input
        aria-label="بحث بالاسم أو رقم الموظف"
        placeholder="بحث بالاسم أو رقم الموظف"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}
export function PageTitle({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="page-title no-print">
      <div>
        <p className="eyebrow">قسم الموارد البشرية</p>
        <h1>{title}</h1>
        {subtitle && <p className="subtitle">{subtitle}</p>}
      </div>
      {actions && <div className="actions">{actions}</div>}
    </div>
  );
}
export function LoadState({
  loading,
  error,
  empty,
  emptyText = "لا توجد سجلات",
  retry,
  children,
}: {
  loading: boolean;
  error?: string;
  empty?: boolean;
  emptyText?: string;
  retry?: () => void;
  children: ReactNode;
}) {
  if (error)
    return (
      <div className="error-state" role="alert">
        <p>{error}</p>
        {retry && (
          <Button variant="outline" onClick={retry}>
            <RotateCw size={16} />
            إعادة المحاولة
          </Button>
        )}
      </div>
    );
  if (loading)
    return (
      <div className="loading-state" aria-label="جار التحميل">
        {[1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    );
  if (empty)
    return (
      <Empty className="empty-state">
        <EmptyHeader>
          <Inbox className="mx-auto mb-2 size-8 text-slate-400" />
          <EmptyTitle>{emptyText}</EmptyTitle>
        </EmptyHeader>
      </Empty>
    );
  return <>{children}</>;
}
export function StatusBadge({
  type,
  code = false,
}: {
  type: StatusType;
  code?: boolean;
}) {
  return (
    <span className={`status-badge ${statuses[type].className}`} dir="rtl">
      {code ? statuses[type].code : statuses[type].label}
    </span>
  );
}
export function EmploymentBadge({ status }: { status: EmploymentStatus }) {
  return (
    <span className={`employment-badge employment-${status}`}>
      {employmentLabels[status]}
    </span>
  );
}
export function Pager({
  page,
  total,
  size = 25,
  onChange,
}: {
  page: number;
  total: number;
  size?: number;
  onChange: (v: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / size));
  return (
    <div className="pager no-print">
      <span>{total} سجل</span>
      <Pagination>
        <PaginationContent>
          <PaginationItem>
            <Button
              aria-label="الصفحة السابقة"
              variant="outline"
              size="icon"
              disabled={page <= 1}
              onClick={() => onChange(page - 1)}
            >
              <ChevronRight size={16} />
            </Button>
          </PaginationItem>
          <PaginationItem>
            <span className="page-number">
              {page} / {pages}
            </span>
          </PaginationItem>
          <PaginationItem>
            <Button
              aria-label="الصفحة التالية"
              variant="outline"
              size="icon"
              disabled={page >= pages}
              onClick={() => onChange(page + 1)}
            >
              <ChevronLeft size={16} />
            </Button>
          </PaginationItem>
        </PaginationContent>
      </Pagination>
    </div>
  );
}
