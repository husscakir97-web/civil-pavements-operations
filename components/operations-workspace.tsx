"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  BarChart3,
  BriefcaseBusiness,
  CalendarDays,
  ClipboardCheck,
  ClipboardList,
  DollarSign,
  Edit3,
  FileCheck2,
  HardHat,
  LoaderCircle,
  Package,
  Plus,
  Save,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  Truck,
  Users,
  X,
} from "lucide-react";
import { toast } from "sonner";
import {WorkspaceBrandSettings,useWorkspaceBrand} from '@/components/workspace-brand';
import { JobsPlanning } from '@/components/jobs-planning';
import { ReportsWorkspace } from "@/components/live-report";
import { TenderReviewAssistant } from '@/components/tender-review-assistant';

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";

export type NavLabel =
  | "Preparation" | "Today" | "Pipeline" | "Delivery" | "Compliance" | "Insights" | "Search" | "Admin/Settings" | "Tender Review" | "Variations" | "Claims" | "IMS & Compliance"
  | "Overview"
  | "Opportunities"
  | "Estimates & Quotes"
  | "Jobs"
  | "Planning"
  | "Field"
  | "Dockets"
  | "Commercial"
  | "Resources"
  | "QA & Safety"
  | "Reports"
  | "Settings";

type IconType = typeof BriefcaseBusiness;
type FieldType = "text" | "number" | "date" | "select" | "textarea";
type FieldConfig = { key: string; label: string; type?: FieldType; placeholder?: string; options?: string[] };
type RecordRow = { id: string; name: string; status: string; metadata: Record<string, unknown>; createdAt: string };
type JsonPayload = Record<string, unknown>;

type WorkspaceConfig = {
  apiModule: string;
  title: string;
  description: string;
  icon: IconType;
  statuses: string[];
  fields: FieldConfig[];
  emptyTitle: string;
  emptyDescription: string;
};

const configs: Partial<Record<NavLabel, WorkspaceConfig>> = {
  Opportunities: {
    apiModule: "opportunities",
    title: "Opportunities",
    description: "Track tenders, prospects and live work before it becomes a job.",
    icon: BriefcaseBusiness,
    statuses: ["Lead", "Qualifying", "Bid / no-bid", "Estimating", "Submitted", "Shortlisted", "Won", "Lost", "Withdrawn"],
    fields: [
      { key: "client", label: "Client", placeholder: "Client / builder" },
      { key: "builder", label: "Builder / principal contractor", placeholder: "Builder or principal" },
      { key: "project", label: "Project", placeholder: "Tender or project name" },
      { key: "site", label: "Location", placeholder: "Work location" },
      { key: "source", label: "Source", placeholder: "Referral, tender portal, repeat client…" },
      { key: "workPackages", label: "Work packages", placeholder: "Asphalt, profiling, traffic control…" },
      { key: "workTypes", label: "Relevant work types", placeholder: "Resurfacing, maintenance…" },
      { key: "estimatedValue", label: "Estimated value (ex GST)", type: "number", placeholder: "0" },
      { key: "tenderCloseDate", label: "Tender close", type: "date" },
      { key: "contacts", label: "Contacts", placeholder: "Name, email, phone" },
      { key: "bidNoBid", label: "Bid / no-bid", type: "select", options: ["Undecided", "Bid", "No-bid"] },
      { key: "probability", label: "Win probability (%)", type: "number", placeholder: "0" },
      { key: "nextAction", label: "Next action", placeholder: "Call estimator, site walk…" },
      { key: "assignedOwner", label: "Assigned owner", placeholder: "Estimator / manager" },
      { key: "outcome", label: "Outcome", placeholder: "Won / lost outcome" },
      { key: "lossReason", label: "Loss reason", placeholder: "Price, timing, scope…" },
      { key: "documents", label: "Documents", placeholder: "Drawing/tender file references" },
      { key: "notes", label: "Notes", type: "textarea", placeholder: "Scope, assumptions or commercial notes" },
    ],
    emptyTitle: "No opportunities yet",
    emptyDescription: "Add the next tender or prospective job to start the pipeline.",
  },
  Jobs: {
    apiModule: "jobs",
    title: "Jobs",
    description: "Move awarded work into delivery with a clear operational record.",
    icon: HardHat,
    statuses: ["Planning", "Active", "On hold", "Complete", "Closed"],
    fields: [
      { key: "client", label: "Client", placeholder: "Client / contractor" },
      { key: "site", label: "Site", placeholder: "Work location" },
      { key: "contractValue", label: "Contract value", type: "number", placeholder: "0" },
      { key: "sourceEstimateId", label: "Source estimate ID", placeholder: "Optional approved estimate ID" },
      { key: "startDate", label: "Target start", type: "date" },
      { key: "notes", label: "Notes", type: "textarea", placeholder: "Job setup notes, scope and commercial baseline" },
    ],
    emptyTitle: "No jobs yet",
    emptyDescription: "Award an estimate or create a job setup record here.",
  },
  Planning: {
    apiModule: "planning",
    title: "Planning",
    description: "Plan shifts, crews and delivery dates before work reaches the field.",
    icon: CalendarDays,
    statuses: ["Planned", "Confirmed", "In progress", "Complete", "Cancelled"],
    fields: [
      { key: "job", label: "Job", placeholder: "Job or project" },
      { key: "date", label: "Shift date", type: "date" },
      { key: "shiftType", label: "Shift type", type: "select", options: ["Day shift", "Night shift", "Saturday", "Sunday / public holiday"] },
      { key: "crew", label: "Crew", placeholder: "Crew / supervisor" },
      { key: "location", label: "Location", placeholder: "Site or work front" },
      { key: "notes", label: "Planning notes", type: "textarea", placeholder: "Resources, access, permits or constraints" },
    ],
    emptyTitle: "No shifts planned",
    emptyDescription: "Create the next planned shift and assign its delivery resources.",
  },
  Field: {
    apiModule: "field",
    title: "Field delivery",
    description: "Keep work fronts, supervisors and shift status visible to the delivery team.",
    icon: Activity,
    statuses: ["Planned", "Ready", "In progress", "Complete", "On hold"],
    fields: [
      { key: "job", label: "Job", placeholder: "Job or project" },
      { key: "date", label: "Work date", type: "date" },
      { key: "crew", label: "Crew / supervisor", placeholder: "Assigned crew" },
      { key: "workFront", label: "Work front", placeholder: "Location or activity" },
      { key: "docketReference", label: "Docket reference", placeholder: "Optional docket number" },
      { key: "notes", label: "Field notes", type: "textarea", placeholder: "Site constraints, quantities or handover notes" },
    ],
    emptyTitle: "No field work fronts",
    emptyDescription: "Create a field work front to track delivery status and docket references.",
  },
  Commercial: {
    apiModule: "commercial",
    title: "Commercial",
    description: "Control variations, claims, proformas and invoice-ready records.",
    icon: DollarSign,
    statuses: ["Draft", "Submitted", "Approved", "Rejected", "Paid"],
    fields: [
      { key: "job", label: "Job", placeholder: "Job or project" },
      { key: "recordType", label: "Record type", type: "select", options: ["Variation", "Claim", "Proforma", "Invoice", "Credit"] },
      { key: "amount", label: "Amount ex GST", type: "number", placeholder: "0" },
      { key: "dueDate", label: "Due date", type: "date" },
      { key: "reference", label: "Reference", placeholder: "PO, claim or invoice reference" },
      { key: "notes", label: "Notes", type: "textarea", placeholder: "Commercial explanation or approval notes" },
    ],
    emptyTitle: "No commercial records",
    emptyDescription: "Add a variation, claim or proforma so it is not lost between delivery and invoicing.",
  },
  "QA & Safety": {
    apiModule: "qa",
    title: "QA & Safety",
    description: "Log inspections, incidents, audits and close-out actions against delivery work.",
    icon: ShieldCheck,
    statuses: ["Open", "Assigned", "Closed", "Overdue"],
    fields: [
      { key: "job", label: "Job", placeholder: "Job or project" },
      { key: "recordType", label: "Record type", type: "select", options: ["Inspection", "Incident", "Near miss", "Audit", "Action"] },
      { key: "owner", label: "Owner", placeholder: "Person responsible" },
      { key: "dueDate", label: "Due date", type: "date" },
      { key: "reference", label: "Reference", placeholder: "Inspection or incident number" },
      { key: "notes", label: "Details", type: "textarea", placeholder: "Finding, control or close-out evidence" },
    ],
    emptyTitle: "No QA or safety records",
    emptyDescription: "Create a record for the next inspection, incident or action before it becomes a gap.",
  },
};

const resourceConfigs: Record<string, WorkspaceConfig> = {
  workers: { apiModule: "resources", title: "Workers", description: "Maintain the people and labour capability available to deliver work.", icon: Users, statuses: ["Active", "Leave", "Inactive"], fields: [{ key: "trade", label: "Trade / role", placeholder: "Role or qualification" }, { key: "phone", label: "Phone", placeholder: "Contact number" }, { key: "rate", label: "Working rate", type: "number", placeholder: "0" }, { key: "location", label: "Base / location", placeholder: "Depot or region" }] , emptyTitle: "No workers", emptyDescription: "Add the workers and supervisors used in planning and delivery." },
  plant: { apiModule: "resources", title: "Plant & equipment", description: "Track plant, vehicles, rates and availability for estimating and delivery.", icon: Truck, statuses: ["Available", "Allocated", "Maintenance", "Inactive"], fields: [{ key: "type", label: "Plant type", placeholder: "Paver, roller, truck, TMA…" }, { key: "rego", label: "Registration / asset ID", placeholder: "Asset identifier" }, { key: "hourlyRate", label: "Working rate", type: "number", placeholder: "0" }, { key: "location", label: "Current location", placeholder: "Depot / project" }] , emptyTitle: "No plant records", emptyDescription: "Add plant and equipment so planning and estimates have a reusable resource register." },
  crews: { apiModule: "resources", title: "Crews", description: "Define repeatable crews for planning and estimate build-ups.", icon: Users, statuses: ["Active", "Standby", "Inactive"], fields: [{ key: "foreman", label: "Supervisor / foreman", placeholder: "Responsible person" }, { key: "members", label: "Crew members", placeholder: "Names or headcount" }, { key: "rate", label: "Crew rate", type: "number", placeholder: "0" }, { key: "location", label: "Base / depot", placeholder: "Depot or region" }] , emptyTitle: "No crews", emptyDescription: "Add a standard crew composition for recurring work." },
  suppliers: { apiModule: "resources", title: "Suppliers", description: "Keep supplier contacts and supplied materials available to the estimator.", icon: Package, statuses: ["Active", "Preferred", "On hold", "Inactive"], fields: [{ key: "contact", label: "Contact", placeholder: "Contact person" }, { key: "phone", label: "Phone", placeholder: "Contact number" }, { key: "materials", label: "Materials / services", placeholder: "AC14, tack coat, cartage…" }, { key: "terms", label: "Terms", placeholder: "Payment or delivery terms" }] , emptyTitle: "No suppliers", emptyDescription: "Add suppliers used in material, plant or subcontract pricing." },
  subcontractors: { apiModule: "resources", title: "Subcontractors", description: "Maintain specialist subcontractors and their commercial details.", icon: Users, statuses: ["Active", "Preferred", "On hold", "Inactive"], fields: [{ key: "trade", label: "Trade / service", placeholder: "Specialty" }, { key: "contact", label: "Contact", placeholder: "Contact person" }, { key: "rate", label: "Working rate", type: "number", placeholder: "0" }, { key: "insuranceExpiry", label: "Insurance expiry", type: "date" }] , emptyTitle: "No subcontractors", emptyDescription: "Add external delivery partners so their costs and compliance are visible." },
};

const reportModules = ["opportunities", "jobs", "planning", "field", "commercial", "qa"] as const;
resourceConfigs.workers.fields.push({ key: 'competencies', label: 'Competencies / licences' }, { key: 'competencyExpiry', label: 'Earliest competency expiry', type: 'date' });
resourceConfigs.plant.fields.push({ key: 'payload', label: 'Truck payload (t)', type: 'number' });
resourceConfigs.plant.statuses.push('Out of service', 'Unavailable');

function statusClass(status: string) {
  if (["Active", "Available", "Preferred", "Complete", "Approved", "Paid", "Closed"].includes(status)) return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (["In progress", "Confirmed", "Submitted", "Assigned", "Allocated", "Qualified"].includes(status)) return "border-blue-200 bg-blue-50 text-blue-700";
  if (["On hold", "Maintenance", "Overdue", "Draft", "Planned", "Open"].includes(status)) return "border-amber-200 bg-amber-50 text-amber-800";
  return "border-slate-200 bg-slate-50 text-slate-700";
}

function StatusBadge({ status }: { status: string }) {
  return <Badge variant="outline" className={`rounded-md px-2 py-1 font-semibold ${statusClass(status)}`}>{status}</Badge>;
}

function formatValue(value: unknown, key: string) {
  if (value === null || value === undefined || value === "") return "—";
  if (["value", "amount", "rate", "hourlyRate"].includes(key)) return new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD", maximumFractionDigits: 0 }).format(Number(value) || 0);
  return String(value);
}

function fieldLabel(config: FieldConfig) {
  return <Label className="mb-1.5 block text-sm font-medium text-slate-700">{config.label}</Label>;
}

function OperationsWorkspace({ module, onNavigate, initialResource = "workers", resourceTypes }: { module: NavLabel; onNavigate: (label: NavLabel) => void; initialResource?: string; resourceTypes?: string[] }) {
  const [resourceType, setResourceType] = useState(initialResource);
  const config = module === "Resources" ? resourceConfigs[resourceType] : configs[module];
  const [records, setRecords] = useState<RecordRow[]>([]);
  const [form, setForm] = useState<Record<string, string>>({ status: "Draft" });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [tenderOpportunity, setTenderOpportunity] = useState<RecordRow | null>(null);
  const recordFormRef = useRef<HTMLFormElement>(null);

  const resourceOptions = Object.entries(resourceConfigs).filter(([value]) => !resourceTypes || resourceTypes.includes(value)).map(([value, valueConfig]) => ({ value, label: valueConfig.title }));
  const visibleRecords = useMemo(() => {
    const query = filter.trim().toLowerCase();
    if (!query) return records;
    return records.filter((record) => [record.name, record.status, ...Object.values(record.metadata).map(String)].join(" ").toLowerCase().includes(query));
  }, [filter, records]);

  async function readJson(response: Response): Promise<JsonPayload> {
    const payload = await response.json().catch(() => ({})) as JsonPayload;
    if (!response.ok) throw new Error(typeof payload.error === "string" ? payload.error : "The request could not be completed.");
    return payload;
  }

  async function loadRecords() {
    if (!config) return;
    setLoading(true);
    try {
      const payload = await readJson(await fetch(`/api/os/records?module=${encodeURIComponent(config.apiModule)}${module === "Resources" ? `&resourceType=${encodeURIComponent(resourceType)}` : ""}`, { cache: "no-store" }));
      setRecords((payload.records ?? []) as RecordRow[]);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Records could not be loaded.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    // The loader updates the UI from an external request; it must run when the active workspace changes.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadRecords();
    // loadRecords is derived from the current module and resource tab.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [module, resourceType]);

  function startNew() {
    setEditingId(null);
    setForm({ status: config?.statuses[0] ?? "Draft" });
    window.requestAnimationFrame(() => recordFormRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }

  function editRecord(record: RecordRow) {
    const values: Record<string, string> = { name: record.name, status: record.status };
    for (const [key, value] of Object.entries(record.metadata)) values[key] = value === null || value === undefined ? "" : String(value);
    setEditingId(record.id);
    setForm(values);
    window.requestAnimationFrame(() => recordFormRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }

  async function saveRecord() {
    if (!config || !form.name?.trim()) {
      toast.error("A name is required.");
      return;
    }
    setSaving(true);
    try {
      const metadata = { ...form };
      delete metadata.name;
      delete metadata.status;
      const body = { module: config.apiModule, resourceType: module === "Resources" ? resourceType : undefined, id: editingId, name: form.name, status: form.status || config.statuses[0], metadata };
      const response = await fetch("/api/os/records", { method: editingId ? "PUT" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      await readJson(response);
      toast.success(editingId ? "Record updated." : "Record created.");
      startNew();
      await loadRecords();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The record could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  if (!config) return null;
  const Icon = config.icon;
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4"><div><p className="text-sm font-medium text-slate-500">Infrastruct</p><h2 className="mt-1 flex items-center gap-2 text-2xl font-bold tracking-tight text-slate-950"><Icon className="size-6 text-primary" />{config.title}</h2><p className="mt-1 text-sm text-slate-500">{config.description}</p></div><div className="flex flex-wrap gap-2">{module === "Field" && <Button variant="outline" onClick={() => onNavigate("Dockets")}><ClipboardList className="size-4" /> Open dockets</Button>}{module === "Jobs" && <Button variant="outline" onClick={() => onNavigate("Planning")}><CalendarDays className="size-4" /> Plan a shift</Button>}{module === "Opportunities" && <Button variant="outline" disabled={!tenderOpportunity} onClick={() => document.getElementById("tender-review")?.scrollIntoView({behavior:"smooth"})}><Sparkles className="size-4" /> Tender assistant</Button>}<Button onClick={startNew}><Plus className="size-4" /> New record</Button></div></div>

      {module === "Resources" && <div className="flex flex-wrap gap-2 rounded-xl border bg-white p-3 shadow-sm">{resourceOptions.map((option) => <Button key={option.value} type="button" size="sm" variant={resourceType === option.value ? "default" : "outline"} onClick={() => { setResourceType(option.value); setEditingId(null); setForm({ status: resourceConfigs[option.value].statuses[0] ?? "Draft" }); }}>{option.label}</Button>)}</div>}

      {module === "Opportunities" && records.length > 0 && <label className="block text-sm">Tender opportunity<select aria-label="Tender opportunity" className="mt-2 block w-full rounded border bg-white p-2 sm:max-w-md" value={tenderOpportunity?.id || ""} onChange={e => setTenderOpportunity(records.find(r => r.id === e.target.value) || null)}><option value="">Select an opportunity</option>{records.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}</select></label>}
      {module === "Opportunities" && tenderOpportunity && <div id="tender-review"><TenderReviewAssistant key={tenderOpportunity.id} opportunityId={tenderOpportunity.id} opportunityName={tenderOpportunity.name} /></div>}

      <div className="grid gap-5 xl:grid-cols-[360px_minmax(0,1fr)]">
        <form ref={recordFormRef} className="order-2 xl:order-none rounded-xl border bg-white p-5 shadow-sm" onSubmit={(event) => { event.preventDefault(); void saveRecord(); }}><div className="flex items-start justify-between gap-3"><div><h3 className="font-semibold text-slate-950">{editingId ? "Edit record" : "Create record"}</h3><p className="mt-1 text-sm text-slate-500">Enter a name and save this record to the organisation workspace.</p></div>{editingId && <Button type="button" variant="ghost" size="icon-sm" onClick={startNew} aria-label="Cancel edit"><X className="size-4" /></Button>}</div><div className="mt-5 space-y-4"><div><Label className="mb-1.5 block text-sm font-medium text-slate-700">Name</Label><Input required value={form.name ?? ""} onChange={(event) => setForm((previous) => ({ ...previous, name: event.target.value }))} placeholder={`${config.title} record name`} /></div><div><Label className="mb-1.5 block text-sm font-medium text-slate-700">Status</Label><NativeSelect value={form.status ?? config.statuses[0]} onChange={(event) => setForm((previous) => ({ ...previous, status: event.target.value }))}>{config.statuses.map((status) => <NativeSelectOption key={status} value={status}>{status}</NativeSelectOption>)}</NativeSelect></div>{config.fields.map((field) => <div key={field.key}>{fieldLabel(field)}{field.type === "textarea" ? <Textarea rows={3} value={form[field.key] ?? ""} onChange={(event) => setForm((previous) => ({ ...previous, [field.key]: event.target.value }))} placeholder={field.placeholder} /> : field.type === "select" ? <NativeSelect value={form[field.key] ?? field.options?.[0] ?? ""} onChange={(event) => setForm((previous) => ({ ...previous, [field.key]: event.target.value }))}>{field.options?.map((option) => <NativeSelectOption key={option} value={option}>{option}</NativeSelectOption>)}</NativeSelect> : <Input type={field.type === "number" ? "number" : field.type === "date" ? "date" : "text"} value={form[field.key] ?? ""} onChange={(event) => setForm((previous) => ({ ...previous, [field.key]: event.target.value }))} placeholder={field.placeholder} />}</div>)}<Button type="submit" className="w-full" disabled={saving}>{saving ? <LoaderCircle className="size-4 animate-spin" /> : editingId ? <Save className="size-4" /> : <Plus className="size-4" />}{editingId ? "Save changes" : "Create record"}</Button></div></form>

        <section className="min-w-0 rounded-xl border bg-white shadow-sm"><div className="flex flex-wrap items-center gap-3 border-b px-5 py-4"><div><h3 className="font-semibold text-slate-950">{config.title} register</h3><p className="text-sm text-slate-500">{records.length} record{records.length === 1 ? "" : "s"} in this workspace</p></div><div className="ml-auto flex items-center gap-2"><Search className="size-4 text-slate-400" /><Input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Search records…" className="h-9 w-48" /></div></div><div className="p-5">{loading ? <div className="flex min-h-40 items-center justify-center text-sm text-slate-500"><LoaderCircle className="mr-2 size-5 animate-spin text-primary" /> Loading records…</div> : visibleRecords.length === 0 ? <div className="rounded-lg border border-dashed p-10 text-center"><Icon className="mx-auto size-8 text-slate-300" /><h4 className="mt-3 font-semibold text-slate-800">{filter ? "No matching records" : config.emptyTitle}</h4><p className="mx-auto mt-1 max-w-md text-sm text-slate-500">{filter ? "Try a different search." : config.emptyDescription}</p><Button className="mt-4" variant="outline" onClick={startNew}><Plus className="size-4" /> Add first record</Button></div> : <div className="space-y-3">{visibleRecords.map((record) => <article key={record.id} className="rounded-lg border p-4 transition hover:border-orange-200"><div className="flex flex-wrap items-start justify-between gap-3"><div><div className="flex items-center gap-2"><h4 className="font-semibold text-slate-900">{record.name}</h4><StatusBadge status={record.status} /></div><p className="mt-1 text-xs text-slate-500">Created {record.createdAt ? new Date(record.createdAt).toLocaleDateString("en-AU") : "—"}</p></div><Button variant="outline" size="sm" onClick={() => editRecord(record)}><Edit3 className="size-3.5" /> Edit</Button></div><div className="mt-3 grid gap-x-5 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">{config.fields.filter((field) => record.metadata[field.key] !== undefined && record.metadata[field.key] !== "").slice(0, 6).map((field) => <div key={field.key}><p className="text-xs text-slate-500">{field.label}</p><p className="mt-0.5 truncate text-sm font-medium text-slate-800">{formatValue(record.metadata[field.key], field.key)}</p></div>)}</div></article>)}</div>}</div></section>
      </div>
    </div>
  );
}

function SettingsWorkspace({ onNavigate }: { onNavigate: (label: NavLabel) => void }) {
  const {brand}=useWorkspaceBrand();
  type SettingsLibrary = { id?: string; name: string; targetMarginPct: number; gstPct: number };
  const [library, setLibrary] = useState<SettingsLibrary | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => { fetch("/api/estimates/rates", { cache: "no-store" }).then((response) => response.json()).then((payload: unknown) => { const rateLibraries = (payload as { rateLibraries?: SettingsLibrary[] }).rateLibraries; setLibrary(rateLibraries?.[0] ?? null); }).catch(() => toast.error("Settings could not be loaded.")); }, []);
  async function save() {
    if (!library) return;
    setSaving(true);
    try { const response = await fetch("/api/estimates/rates", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(library) }); if (!response.ok) throw new Error("Settings could not be saved."); toast.success("Organisation settings saved."); } catch (error) { toast.error(error instanceof Error ? error.message : "Settings could not be saved."); } finally { setSaving(false); }
  }
  return <div className="space-y-5"><div><p className="text-sm font-medium text-slate-500">Organisation controls</p><h2 className="mt-1 text-2xl font-bold tracking-tight text-slate-950">Settings</h2><p className="mt-1 text-sm text-slate-500">Set the commercial defaults used across the operating system.</p></div><WorkspaceBrandSettings/><section className="max-w-2xl rounded-xl border bg-white p-5 shadow-sm"><div className="flex items-start gap-3"><span className="flex size-9 items-center justify-center rounded-lg bg-orange-50 text-primary"><Settings className="size-5" /></span><div><h3 className="font-semibold">{brand.companyName}</h3><p className="mt-1 text-sm text-slate-500">Company rate library</p></div></div>{library ? <div className="mt-5 grid gap-4 sm:grid-cols-2"><div><Label className="mb-1.5 block text-sm font-medium text-slate-700">Rate library name</Label><Input value={library.name} onChange={(event) => setLibrary((previous) => previous ? { ...previous, name: event.target.value } : previous)} /></div><div><Label className="mb-1.5 block text-sm font-medium text-slate-700">Target margin (%)</Label><Input type="number" min="0" step="0.1" value={library.targetMarginPct} onChange={(event) => setLibrary((previous) => previous ? { ...previous, targetMarginPct: Number(event.target.value) || 0 } : previous)} /></div><div><Label className="mb-1.5 block text-sm font-medium text-slate-700">GST (%)</Label><Input type="number" min="0" step="0.1" value={library.gstPct} onChange={(event) => setLibrary((previous) => previous ? { ...previous, gstPct: Number(event.target.value) || 0 } : previous)} /></div><div className="flex items-end"><Button onClick={save} disabled={saving}>{saving ? <LoaderCircle className="size-4 animate-spin" /> : <Save className="size-4" />} Save defaults</Button></div></div> : <div className="mt-5 text-sm text-slate-500">No rate library has been created yet.</div>}<div className="mt-5 border-t pt-4"><Button variant="outline" onClick={() => onNavigate("Estimates & Quotes")}><FileCheck2 className="size-4" /> Open estimator and detailed rate library</Button></div></section></div>;
}

export function OperationsPage({ module, onNavigate, initialResource, resourceTypes }: { module: NavLabel; onNavigate: (label: NavLabel) => void; initialResource?: string; resourceTypes?: string[] }) {
  if (module === 'Jobs' || module === 'Planning') return <JobsPlanning page={module} />;
  if (module === "Reports") return <ReportsWorkspace />;
  if (module === "Settings") return <SettingsWorkspace onNavigate={onNavigate} />;
  return <OperationsWorkspace module={module} onNavigate={onNavigate} initialResource={initialResource} resourceTypes={resourceTypes} />;
}
