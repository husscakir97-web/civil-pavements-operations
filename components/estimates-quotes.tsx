"use client";

import { EstimateItemsEditor, EstimateApprovalPanel } from "@/components/v1/estimating";
import { useWorkspaceBrand } from "@/components/workspace-brand";
import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Calculator,
  CheckCircle2,
  ChevronRight,
  CircleDollarSign,
  Download,
  FileCheck2,
  FileText,
  History,
  LibraryBig,
  LoaderCircle,
  Plus,
  Printer,
  RefreshCw,
  Save,
  Settings2,
  ShieldAlert,
  Trash2,
  Truck,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import {
  DEFAULT_RATE_LIBRARY,
  calculateEstimate,
  makeDefaultEstimate,
  validateEstimate,
  type EstimateData,
  type EstimateStatus,
  type EstimateTotals,
  type LabourLine,
  type PlantLine,
  type RateItem,
  type RateLibrary,
  type SubcontractorLine,
  type TrafficLine,
} from "@/lib/estimate-calculations";

type EstimateRecord = {
  id: string;
  name: string;
  status: EstimateStatus;
  createdAt: string;
  updatedAt: string;
  revisionNumber: number;
  currentRevisionId: string;
  data: EstimateData;
  totals: EstimateTotals;
  validation: { errors: string[]; warnings: string[]; isValid: boolean };
  jobId?: string | null;
  approvedRevisionId?: string | null;
  approvedBudget?: EstimateTotals | null;
};

type RevisionRecord = {
  id: string;
  name: string;
  status: string;
  createdAt: string;
  metadata: { revisionNumber?: number; reason?: string; totals?: EstimateTotals };
};

type Lookup = { id: string; name: string; source?: string };
type JsonPayload = Record<string, unknown>;

const currency = new Intl.NumberFormat("en-AU", {
  style: "currency",
  currency: "AUD",
  maximumFractionDigits: 0,
});
const currencyExact = new Intl.NumberFormat("en-AU", {
  style: "currency",
  currency: "AUD",
  maximumFractionDigits: 2,
});
const decimal = new Intl.NumberFormat("en-AU", { maximumFractionDigits: 1 });

const estimateSteps = ["Scope & Quantities","Production & Resources","Subcontractors & Indirects","Price & Margin","Assumptions & Exclusions","Review & Approval"] as const;
type EstimateStep=(typeof estimateSteps)[number];

const rateCategories: Array<{ key: "materials" | "labour" | "plant" | "traffic" | "subcontractors" | "allowances"; label: string }> = [
  { key: "materials", label: "Materials & external" },
  { key: "labour", label: "Labour" },
  { key: "plant", label: "Plant & equipment" },
  { key: "traffic", label: "Traffic control" },
  { key: "subcontractors", label: "Subcontractors" },
  { key: "allowances", label: "Allowances" },
];

function statusClass(status: string) {
  if (status === "Awarded") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (status === "Submitted") return "border-blue-200 bg-blue-50 text-blue-700";
  if (status === "Internal Review" || status === "Revised") return "border-amber-200 bg-amber-50 text-amber-800";
  if (status === "Lost" || status === "Cancelled") return "border-rose-200 bg-rose-50 text-rose-700";
  return "border-slate-200 bg-slate-50 text-slate-700";
}

function StatusBadge({ status }: { status: string }) {
  return <Badge variant="outline" className={`rounded-md px-2 py-1 font-semibold ${statusClass(status)}`}>{status}</Badge>;
}

function Section({ icon: Icon, title, description, children, className = "" }: { icon: typeof Calculator; title: string; description?: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={`rounded-xl border bg-white shadow-sm ${className}`}>
      <div className="flex items-start gap-3 border-b px-5 py-4">
        <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-orange-50 text-primary"><Icon className="size-4" /></span>
        <div><h3 className="font-semibold text-slate-950">{title}</h3>{description && <p className="mt-0.5 text-sm text-slate-500">{description}</p>}</div>
      </div>
      <div className="p-5">{children}</div>
    </section>
  );
}

function Field({ label, hint, children, className = "" }: { label: string; hint?: string; children: React.ReactNode; className?: string }) {
  return <div className={className}><Label className="mb-1.5 block text-sm font-medium text-slate-700">{label}</Label>{children}{hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}</div>;
}

function Money({ value, exact = false }: { value: number; exact?: boolean }) {
  return <span>{(exact ? currencyExact : currency).format(Number.isFinite(value) ? value : 0)}</span>;
}

function Metric({ label, value, note, tone = "slate" }: { label: string; value: React.ReactNode; note?: string; tone?: "slate" | "orange" | "green" | "blue" | "amber" }) {
  const tones = {
    slate: "border-slate-200 bg-white",
    orange: "border-orange-200 bg-orange-50/60",
    green: "border-emerald-200 bg-emerald-50/60",
    blue: "border-blue-200 bg-blue-50/60",
    amber: "border-amber-200 bg-amber-50/60",
  };
  return <div className={`rounded-lg border p-3 ${tones[tone]}`}><p className="text-xs font-medium text-slate-500">{label}</p><p className="mt-1 text-lg font-bold text-slate-950">{value}</p>{note && <p className="mt-0.5 text-xs text-slate-500">{note}</p>}</div>;
}

function newId(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`;
}

export function EstimatesQuotes({opportunityId,opportunityName,initialEstimateId}:{opportunityId?:string;opportunityName?:string;initialEstimateId?:string}={}) {
  const {brand} = useWorkspaceBrand();
  const [estimates, setEstimates] = useState<EstimateRecord[]>([]);
  const [form, setForm] = useState<EstimateData>(() => makeDefaultEstimate());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [currentStatus, setCurrentStatus] = useState<EstimateStatus>("Draft");
  const [revisions, setRevisions] = useState<RevisionRecord[]>([]);
  const [rateLibraries, setRateLibraries] = useState<RateLibrary[]>([DEFAULT_RATE_LIBRARY]);
  const [activeLibrary, setActiveLibrary] = useState<RateLibrary>(DEFAULT_RATE_LIBRARY);
  const [clients, setClients] = useState<Lookup[]>([]);
  const [opportunities, setOpportunities] = useState<Lookup[]>([]);
  const [jobs, setJobs] = useState<Lookup[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [showRates, setShowRates] = useState(false);
  const [rateSaving, setRateSaving] = useState(false);
  const [filter, setFilter] = useState("");
  const [estimateStep,setEstimateStep]=useState<EstimateStep>("Scope & Quantities");

  const totals = useMemo(() => calculateEstimate(form), [form]);
  const validation = useMemo(() => validateEstimate(form, totals), [form, totals]);
  const filteredEstimates = useMemo(() => {
    const query = filter.trim().toLowerCase();
    if (!query) return estimates;
    return estimates.filter((estimate) => [estimate.name, estimate.data.clientName, estimate.data.projectName, estimate.status].join(" ").toLowerCase().includes(query));
  }, [estimates, filter]);

  async function readJson(response: Response): Promise<JsonPayload> {
    const payload = await response.json().catch(() => ({})) as JsonPayload;
    if (!response.ok) throw new Error(typeof payload.error === "string" ? payload.error : "The request could not be completed.");
    return payload;
  }

  async function loadList(preferredId?: string | null) {
    const payload = await readJson(await fetch("/api/estimates", { cache: "no-store" })) as { estimates?: EstimateRecord[]; rateLibraries?: RateLibrary[]; clients?: Lookup[]; opportunities?: Lookup[]; jobs?: Lookup[] };
    setEstimates(payload.estimates ?? []);
    setRateLibraries(payload.rateLibraries ?? [DEFAULT_RATE_LIBRARY]);
    const library = payload.rateLibraries?.[0] ?? DEFAULT_RATE_LIBRARY;
    setActiveLibrary(library);
    setClients(payload.clients ?? []);
    setOpportunities(payload.opportunities ?? []);
    setJobs(payload.jobs ?? []);
    const linkedId = opportunityId ? payload.estimates?.find(estimate => estimate.data.opportunityId === opportunityId)?.id : undefined;
    const id = preferredId ?? selectedId ?? initialEstimateId ?? linkedId ?? (opportunityId ? undefined : payload.estimates?.[0]?.id);
    if (id) await openEstimate(id);
    else {
      setSelectedId(null);
      setCurrentStatus("Draft");
      const next = makeDefaultEstimate(library);
      setForm(opportunityId ? {...next,opportunityId,opportunityName:opportunityName||next.opportunityName} : next);
      setRevisions([]);
    }
  }

  async function openEstimate(id: string) {
    const payload = await readJson(await fetch(`/api/estimates?id=${encodeURIComponent(id)}`, { cache: "no-store" })) as { estimate: EstimateRecord; revisions?: RevisionRecord[] };
    const estimate = payload.estimate as EstimateRecord;
    setSelectedId(estimate.id);
    setCurrentStatus(estimate.status);
    setForm(estimate.data);
    setRevisions(payload.revisions ?? []);
  }

  useEffect(() => {
    let mounted = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadList().catch((error) => { if (mounted) toast.error(error.message); }).finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function setField<K extends keyof EstimateData>(key: K, value: EstimateData[K]) {
    setForm((previous) => ({ ...previous, [key]: value }));
  }

  function setNumberField<K extends keyof EstimateData>(key: K, value: string) {
    const number = Number(value);
    setField(key, Number.isFinite(number) ? number as EstimateData[K] : 0 as EstimateData[K]);
  }

  function updateLabour(index: number, patch: Partial<LabourLine>) {
    setForm((previous) => ({ ...previous, labour: previous.labour.map((line, row) => row === index ? { ...line, ...patch } : line) }));
  }

  function updatePlant(index: number, patch: Partial<PlantLine>) {
    setForm((previous) => ({ ...previous, plant: previous.plant.map((line, row) => row === index ? { ...line, ...patch } : line) }));
  }

  function updateTraffic(index: number, patch: Partial<TrafficLine>) {
    setForm((previous) => ({ ...previous, traffic: previous.traffic.map((line, row) => row === index ? { ...line, ...patch } : line) }));
  }

  function updateSubcontractor(index: number, patch: Partial<SubcontractorLine>) {
    setForm((previous) => ({ ...previous, subcontractors: previous.subcontractors.map((line, row) => row === index ? { ...line, ...patch } : line) }));
  }

  function applyLibraryRates() {
    const material = activeLibrary.materials.find((item) => item.name === form.asphaltMix);
    const tack = activeLibrary.materials.find((item) => item.id === "tack-coat");
    const profiling = activeLibrary.materials.find((item) => item.id === "profiling");
    const cartage = activeLibrary.materials.find((item) => item.id === "cartage");
    setForm((previous) => ({
      ...previous,
      supplierRatePerT: material?.rate ?? previous.supplierRatePerT,
      tackCoatRatePerM2: tack?.rate ?? previous.tackCoatRatePerM2,
      profilingRatePerM2: profiling?.rate ?? previous.profilingRatePerM2,
      cartageRatePerTrip: cartage?.rate ?? previous.cartageRatePerTrip,
      targetMarginPct: activeLibrary.targetMarginPct,
      gstPct: activeLibrary.gstPct,
      labour: previous.labour.map((line) => ({ ...line, hourlyRate: activeLibrary.labour.find((item) => item.id === line.id)?.rate ?? line.hourlyRate })),
      plant: previous.plant.map((line) => ({ ...line, hourlyRate: activeLibrary.plant.find((item) => item.id === line.id)?.rate ?? line.hourlyRate })),
      traffic: previous.traffic.map((line) => ({ ...line, ratePerDay: activeLibrary.traffic.find((item) => item.id === line.id)?.rate ?? line.ratePerDay })),
    }));
    toast.success("Current rate library applied to this estimate.");
  }

  function chooseMix(value: string) {
    const material = activeLibrary.materials.find((item) => item.name === value);
    setForm((previous) => ({ ...previous, asphaltMix: value, supplierRatePerT: material?.rate ?? previous.supplierRatePerT }));
  }

  async function refresh(id?: string | null) {
    await loadList(id ?? selectedId);
  }

  async function saveEstimate(status: EstimateStatus = currentStatus, reason = "") {
    if (status !== "Draft" && validation.errors.length > 0) {
      toast.error("Resolve the validation errors before changing this estimate status.");
      return;
    }
    setBusy(true);
    try {
      const response = selectedId
        ? await fetch("/api/estimates", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: selectedId, data: form, status, reason }) })
        : await fetch("/api/estimates", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ data: form, status }) });
      const payload = await readJson(response) as { estimate?: EstimateRecord };
      const id = payload.estimate?.id ?? selectedId;
      toast.success(selectedId ? `Revision saved as ${status}.` : "Estimate created as Draft.");
      await refresh(id);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The estimate could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  async function awardEstimate() {
    if (!selectedId) {
      toast.error("Save the estimate before awarding it.");
      return;
    }
    if (validation.errors.length > 0) {
      toast.error("Resolve the validation errors before awarding this estimate.");
      return;
    }
    if (validation.warnings.length > 0 && !window.confirm("This estimate has validation warnings. Award it anyway?")) return;
    setBusy(true);
    try {
      const payload = await readJson(await fetch("/api/estimates/award", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ estimateId: selectedId }) })) as { alreadyAwarded?: boolean; job?: { name?: string } };
      toast.success(payload.alreadyAwarded ? "This estimate is already awarded." : `Quote awarded and ${payload.job?.name ?? "job"} created.`);
      await refresh(selectedId);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The estimate could not be awarded.");
    } finally {
      setBusy(false);
    }
  }

  async function reopenEstimate() {
    if (!selectedId) return;
    setBusy(true);
    try {
      await readJson(await fetch("/api/estimates", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: selectedId, action: "reopen", data: form, reason: "Reopened for commercial revision" }) }));
      toast.success("Estimate reopened as Revised. The awarded job baseline remains intact.");
      await refresh(selectedId);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The estimate could not be reopened.");
    } finally {
      setBusy(false);
    }
  }

  async function saveRateLibrary() {
    setRateSaving(true);
    try {
      const payload = await readJson(await fetch("/api/estimates/rates", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(activeLibrary) })) as { rateLibrary: RateLibrary };
      const saved = payload.rateLibrary;
      setActiveLibrary(saved);
      setRateLibraries((previous) => previous.some((library) => library.id === saved.id) ? previous.map((library) => library.id === saved.id ? saved : library) : [...previous, saved]);
      toast.success("Rate library saved for this organisation.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The rate library could not be saved.");
    } finally {
      setRateSaving(false);
    }
  }

  function updateRate(category: keyof RateLibrary, index: number, patch: Partial<RateItem>) {
    setActiveLibrary((previous) => {
      const items = previous[category];
      if (!Array.isArray(items)) return previous;
      return { ...previous, [category]: (items as RateItem[]).map((item, row) => row === index ? { ...item, ...patch } : item) };
    });
  }

  function startNew() {
    setSelectedId(null);
    setCurrentStatus("Draft");
    setForm(makeDefaultEstimate(activeLibrary));
    setRevisions([]);
  }

  function exportEstimate() {
    const payload = { estimateId: selectedId, status: currentStatus, data: form, totals, validation, exportedAt: new Date().toISOString() };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${(form.projectName || "estimate").replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  if (loading) {
    return <div className="flex min-h-[420px] items-center justify-center rounded-xl border bg-white"><LoaderCircle className="size-6 animate-spin text-primary" /><span className="ml-3 text-sm text-slate-500">Loading estimates and rate libraries…</span></div>;
  }

  const costRows: Array<[string, number]> = [
    ["Asphalt material", totals.materialCost],
    ["Tack coat", totals.tackCoatCost],
    ["Profiling", totals.profilingCost],
    ["Cartage", totals.cartageCost],
    ["Labour", totals.labourCost],
    ["Plant & equipment", totals.plantCost],
    ["Traffic control", totals.trafficCost],
    ["Mobilisation & floats", totals.mobilisationCost],
    ["Accommodation & travel", totals.allowancesCost],
    ["Subcontractors", totals.subcontractorCost],
    ["Overheads", totals.overheadCost],
    ["Contingency", totals.contingencyCost],
  ];

  return (
    <div className="estimate-page space-y-5">
      <div className="no-print flex flex-wrap items-end justify-between gap-4">
        <div><p className="text-sm font-medium text-slate-500">Commercial control</p><h2 className="mt-1 text-2xl font-bold tracking-tight text-slate-950">Estimates &amp; Quotes</h2><p className="mt-1 text-sm text-slate-500">Build a priced baseline from quantities, resources and organisation rates.</p></div>
        <div className="flex flex-wrap gap-2"><Button variant="outline" onClick={() => setShowRates((value) => !value)}><LibraryBig className="size-4" /> Rate library</Button><Button onClick={startNew}><Plus className="size-4" /> New estimate</Button></div>
      </div>

      <div className="no-print grid gap-4 xl:grid-cols-[280px_minmax(0,1fr)]">
        <aside className="space-y-4">
          <div className="rounded-xl border bg-white p-3 shadow-sm">
            <div className="flex items-center justify-between px-2 pb-2"><p className="text-sm font-semibold text-slate-900">Estimate register</p><span className="text-xs text-slate-500">{estimates.length}</span></div>
            <Input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Search estimates…" className="mb-2 h-9" />
            <div className="max-h-[480px] space-y-1 overflow-y-auto">
              {filteredEstimates.length === 0 && <p className="px-2 py-6 text-center text-sm text-slate-500">No saved estimates yet.</p>}
              {filteredEstimates.map((estimate) => <button key={estimate.id} onClick={() => openEstimate(estimate.id)} className={`w-full rounded-lg border px-3 py-3 text-left transition ${selectedId === estimate.id ? "border-primary bg-orange-50/60" : "border-transparent hover:border-slate-200 hover:bg-slate-50"}`}><div className="flex items-start justify-between gap-2"><span className="min-w-0 truncate text-sm font-semibold text-slate-900">{estimate.name}</span><ChevronRight className="mt-0.5 size-4 shrink-0 text-slate-400" /></div><p className="mt-1 truncate text-xs text-slate-500">{estimate.data.clientName || "No client"} · {estimate.data.projectName || "No project"}</p><div className="mt-2 flex items-center justify-between gap-2"><StatusBadge status={estimate.status} /><span className="text-xs text-slate-500">Rev {estimate.revisionNumber}</span></div></button>)}
            </div>
          </div>
          {selectedId && <div className="rounded-xl border bg-white p-4 shadow-sm"><div className="flex items-center gap-2"><History className="size-4 text-primary" /><h3 className="text-sm font-semibold">Version history</h3></div><div className="mt-3 space-y-2">{revisions.length === 0 && <p className="text-xs text-slate-500">No revisions returned.</p>}{revisions.map((revision) => <div key={revision.id} className="rounded-lg bg-slate-50 p-2.5"><div className="flex items-center justify-between gap-2"><span className="text-xs font-semibold text-slate-700">Rev {revision.metadata.revisionNumber ?? "—"}</span><StatusBadge status={revision.status} /></div><p className="mt-1 text-xs text-slate-500">{revision.metadata.reason || "Saved revision"}</p><p className="mt-1 text-[11px] text-slate-400">{new Date(revision.createdAt).toLocaleString("en-AU")}</p></div>)}</div></div>}
          {jobs.length > 0 && <div className="rounded-xl border bg-white p-4 shadow-sm"><div className="flex items-center gap-2"><FileCheck2 className="size-4 text-emerald-600" /><h3 className="text-sm font-semibold">Awarded jobs</h3></div><div className="mt-3 space-y-2">{jobs.slice(0, 4).map((job) => <div key={job.id} className="rounded-lg bg-emerald-50/60 p-2.5"><p className="text-sm font-medium text-slate-800">{job.name}</p><p className="mt-1 text-xs text-emerald-700">Approved baseline retained</p></div>)}</div></div>}
        </aside>

        <div className="min-w-0 space-y-5">
          <section className="rounded-xl border bg-white p-4 shadow-sm sm:p-5">
            <div className="flex flex-wrap items-start justify-between gap-3"><div><div className="flex items-center gap-2"><h3 className="text-lg font-semibold text-slate-950">{form.name || form.projectName || "New estimate"}</h3><StatusBadge status={currentStatus} /></div><p className="mt-1 text-sm text-slate-500">{selectedId ? `Estimate ID ${selectedId.slice(0, 8)} · Rev ${revisions[0]?.metadata?.revisionNumber ?? 1}` : "Unsaved estimate · complete the inputs and save a draft"}</p></div><div className="no-print flex flex-wrap gap-2"><Button variant="outline" size="sm" onClick={applyLibraryRates}><RefreshCw className="size-3.5" /> Apply rates</Button><Button variant="outline" size="sm" onClick={exportEstimate}><Download className="size-3.5" /> Export</Button><Button variant="outline" size="sm" onClick={() => window.print()}><Printer className="size-3.5" /> Print quote</Button></div></div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="Estimate name" className="lg:col-span-2"><Input value={form.name} onChange={(event) => setField("name", event.target.value)} placeholder="e.g. Kings Highway resurfacing" /></Field>
              <Field label="Status"><NativeSelect value={currentStatus} onChange={(event) => setCurrentStatus(event.target.value as EstimateStatus)} disabled={currentStatus === "Awarded"}><NativeSelectOption value="Draft">Draft</NativeSelectOption><NativeSelectOption value="Internal Review">Internal Review</NativeSelectOption><NativeSelectOption value="Submitted">Submitted</NativeSelectOption><NativeSelectOption value="Revised">Revised</NativeSelectOption><NativeSelectOption value="Lost">Lost</NativeSelectOption><NativeSelectOption value="Cancelled">Cancelled</NativeSelectOption></NativeSelect></Field>
              <Field label="Rate library"><NativeSelect value={activeLibrary.id ?? ""} onChange={(event) => { const next = rateLibraries.find((library) => library.id === event.target.value); if (next) setActiveLibrary(next); }}><NativeSelectOption value="">Select library</NativeSelectOption>{rateLibraries.map((library) => <NativeSelectOption key={library.id ?? library.name} value={library.id ?? ""}>{library.name}</NativeSelectOption>)}</NativeSelect></Field>
            </div>
          </section>

          <div className="sticky top-16 z-10 space-y-3 rounded-xl border bg-white/95 p-3 shadow-sm backdrop-blur no-print">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-8">
              <Metric label="Direct cost" value={<Money value={totals.directCost}/>} />
              <Metric label="Total cost" value={<Money value={totals.totalCost}/>} />
              <Metric label="Sell ex GST" value={<Money value={totals.sellRate}/>} tone="green" />
              <Metric label="Gross profit" value={<Money value={totals.grossProfit}/>} />
              <Metric label="Margin" value={decimal.format(totals.grossMargin)+"%"} tone={totals.grossMargin>=form.targetMarginPct?"green":"amber"} />
              <Metric label="$/t" value={<Money value={totals.sellRatePerTonne} exact/>} />
              <Metric label="$/m²" value={<Money value={totals.sellRatePerM2} exact/>} />
              <Metric label="Shifts" value={totals.estimatedShifts} />
            </div>
            <nav aria-label="Estimate sections" className="flex gap-2 overflow-x-auto">{estimateSteps.map(step=><Button key={step} size="sm" className="shrink-0" variant={estimateStep===step?"default":"outline"} onClick={()=>setEstimateStep(step)}>{step}</Button>)}</nav>
          </div>

          <Section className={estimateStep==="Scope & Quantities"?"":"hidden"} icon={FileText} title="Client, project & scope" description="Link the estimate to the opportunity and describe the work being priced.">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="Client" hint="Select a known client or enter a new name." className="lg:col-span-2"><NativeSelect value={form.clientId || "__custom"} onChange={(event) => { const value = event.target.value; const client = clients.find((item) => item.id === value); setForm((previous) => ({ ...previous, clientId: value === "__custom" ? "" : value, clientName: client?.name ?? previous.clientName })); }}><NativeSelectOption value="__custom">Enter client name…</NativeSelectOption>{clients.map((client) => <NativeSelectOption key={client.id} value={client.id}>{client.name}{client.source === "docket" ? " · from dockets" : ""}</NativeSelectOption>)}</NativeSelect><Input className="mt-2" value={form.clientName} onChange={(event) => setField("clientName", event.target.value)} placeholder="Client / principal contractor" /></Field>
              <Field label="Opportunity" className="lg:col-span-2"><NativeSelect value={form.opportunityId || "__custom"} onChange={(event) => { const value = event.target.value; const opportunity = opportunities.find((item) => item.id === value); setForm((previous) => ({ ...previous, opportunityId: value === "__custom" ? "" : value, opportunityName: opportunity?.name ?? previous.opportunityName })); }}><NativeSelectOption value="__custom">No linked opportunity / enter name…</NativeSelectOption>{opportunities.map((opportunity) => <NativeSelectOption key={opportunity.id} value={opportunity.id}>{opportunity.name}</NativeSelectOption>)}</NativeSelect><Input className="mt-2" value={form.opportunityName} onChange={(event) => setField("opportunityName", event.target.value)} placeholder="Opportunity or tender reference" /></Field>
              <Field label="Project"><Input value={form.projectName} onChange={(event) => setField("projectName", event.target.value)} placeholder="Project name" /></Field>
              <Field label="Site"><Input value={form.site} onChange={(event) => setField("site", event.target.value)} placeholder="Work location" /></Field>
              <Field label="Work type"><NativeSelect value={form.workType} onChange={(event) => setField("workType", event.target.value)}><NativeSelectOption value="Asphalt resurfacing">Asphalt resurfacing</NativeSelectOption><NativeSelectOption value="Profiling / milling">Profiling / milling</NativeSelectOption><NativeSelectOption value="Pavement maintenance">Pavement maintenance</NativeSelectOption><NativeSelectOption value="Traffic management">Traffic management</NativeSelectOption><NativeSelectOption value="Spray seal">Spray seal</NativeSelectOption><NativeSelectOption value="Civil works">Civil works</NativeSelectOption></NativeSelect></Field>
              <Field label="Specification" className="sm:col-span-2 lg:col-span-4"><Textarea value={form.specification} onChange={(event) => setField("specification", event.target.value)} rows={2} placeholder="Specification, mix, finish, testing and scope detail" /></Field>
            </div>
          </Section>

          <div className={estimateStep==="Scope & Quantities"?"":"hidden"}><EstimateItemsEditor form={form} setForm={setForm} disabled={currentStatus === "Awarded"} /></div>
          <Section className={estimateStep==="Scope & Quantities"&&form.includePaving!==false?"":"hidden"} icon={Calculator} title="Quantity & material build-up" description="Tonnage uses area × compacted depth × density, including waste. Length × width is available as a cross-check.">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="Area (m²)" hint={form.lengthM > 0 && form.widthM > 0 ? `Length × width = ${decimal.format(form.lengthM * form.widthM)} m²` : "Use area or length × width."}><Input type="number" min="0" step="0.1" value={form.areaM2} onChange={(event) => setNumberField("areaM2", event.target.value)} /></Field>
              <Field label="Length (m)"><Input type="number" min="0" step="0.1" value={form.lengthM} onChange={(event) => setNumberField("lengthM", event.target.value)} /></Field>
              <Field label="Width (m)"><Input type="number" min="0" step="0.1" value={form.widthM} onChange={(event) => setNumberField("widthM", event.target.value)} /></Field>
              <Field label="Compacted depth (mm)"><Input type="number" min="0" step="1" value={form.compactedDepthMm} onChange={(event) => setNumberField("compactedDepthMm", event.target.value)} /></Field>
              <Field label="Density (t/m³)"><Input type="number" min="0" step="0.01" value={form.materialDensityTPerM3} onChange={(event) => setNumberField("materialDensityTPerM3", event.target.value)} /></Field>
              <Field label="Waste (%)"><Input type="number" min="0" step="0.1" value={form.wastePct} onChange={(event) => setNumberField("wastePct", event.target.value)} /></Field>
              <Field label="Asphalt mix"><NativeSelect value={form.asphaltMix} onChange={(event) => chooseMix(event.target.value)}>{activeLibrary.materials.filter((item) => ["AC10", "AC14", "AC20", "SMA"].includes(item.name)).map((item) => <NativeSelectOption key={item.id} value={item.name}>{item.name}</NativeSelectOption>)}<NativeSelectOption value={form.asphaltMix}>{form.asphaltMix}</NativeSelectOption></NativeSelect></Field>
              <Field label="Supplier"><Input value={form.supplierName} onChange={(event) => setField("supplierName", event.target.value)} placeholder="Supplier / quarry" /></Field>
              <Field label="Supplier rate ($/t)"><Input type="number" min="0" step="0.01" value={form.supplierRatePerT} onChange={(event) => setNumberField("supplierRatePerT", event.target.value)} /></Field>
              <Field label="Tack coat ($/m²)"><Input type="number" min="0" step="0.01" value={form.tackCoatRatePerM2} onChange={(event) => setNumberField("tackCoatRatePerM2", event.target.value)} /></Field>
              <Field label="Profiling" hint={form.profilingIncluded ? "Included for the specified area" : "Excluded — cost is $0"}><label className="flex min-h-10 items-center gap-2 text-sm"><input type="checkbox" checked={form.profilingIncluded} onChange={(event) => setForm((current) => ({ ...current, profilingIncluded: event.target.checked }))} /> Include profiling</label><Input type="number" min="0" step="0.1" value={form.profilingAreaM2} onChange={(event) => setNumberField("profilingAreaM2", event.target.value)} disabled={!form.profilingIncluded} placeholder="Profiling area (m²)" /></Field>
              <Field label="Profiling rate ($/m²)"><Input type="number" min="0" step="0.01" value={form.profilingRatePerM2} onChange={(event) => setNumberField("profilingRatePerM2", event.target.value)} /></Field>
              <Field label="Cartage ($/trip)"><Input type="number" min="0" step="1" value={form.cartageRatePerTrip} onChange={(event) => setNumberField("cartageRatePerTrip", event.target.value)} /></Field>
              <Field label="Truck payload (t)"><Input type="number" min="0" step="0.1" value={form.truckPayloadT} onChange={(event) => setNumberField("truckPayloadT", event.target.value)} /></Field>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-3"><Metric label="Raw tonnes" value={decimal.format(totals.rawTonnes)} note="Before waste" tone="blue" /><Metric label="Total tonnes" value={decimal.format(totals.totalTonnes)} note={`${form.wastePct}% waste included`} tone="orange" /><Metric label="Required truck trips" value={totals.requiredTrips} note={`${form.truckPayloadT || 0} t payload`} /></div>
          </Section>

          <Section className={estimateStep==="Production & Resources"?"":"hidden"} icon={Truck} title="Shift plan & delivery resources" description="Shift duration, production capacity and crew/plant rates drive the estimated shift count and delivery cost.">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="Shift type"><NativeSelect value={form.shiftType} onChange={(event) => setField("shiftType", event.target.value)}><NativeSelectOption value="Day shift">Day shift</NativeSelectOption><NativeSelectOption value="Night shift">Night shift</NativeSelectOption><NativeSelectOption value="Saturday">Saturday</NativeSelectOption><NativeSelectOption value="Sunday / public holiday">Sunday / public holiday</NativeSelectOption></NativeSelect></Field>
              <Field label="Shift duration (hours)"><Input type="number" min="0" step="0.5" value={form.shiftDurationHours} onChange={(event) => setNumberField("shiftDurationHours", event.target.value)} /></Field>
              <Field label="Production (t / shift)"><Input type="number" min="0" step="1" value={form.productionTonnesPerShift} onChange={(event) => setNumberField("productionTonnesPerShift", event.target.value)} /></Field>
              <Field label="Shift override" hint="0 uses tonnes ÷ production"><Input type="number" min="0" step="1" value={form.shiftsOverride} onChange={(event) => setNumberField("shiftsOverride", event.target.value)} /></Field>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-3"><Metric label="Estimated shifts" value={totals.estimatedShifts} note={`${form.shiftType} · ${form.shiftDurationHours} hours`} tone="blue" /><Metric label="Labour cost" value={<Money value={totals.labourCost} />} note="Crew composition" /><Metric label="Plant cost" value={<Money value={totals.plantCost} />} note="Hours × shifts" /></div>
            <div className="mt-5 grid gap-5 xl:grid-cols-2">
              <div><div className="mb-2 flex items-center justify-between"><div><h4 className="text-sm font-semibold text-slate-900">Labour &amp; crew composition</h4><p className="text-xs text-slate-500">Headcount × hours × shifts × rate</p></div><Button variant="outline" size="sm" onClick={() => setForm((previous) => ({ ...previous, labour: [...previous.labour, { id: newId("labour"), name: "New role", headcount: 1, hoursPerShift: previous.shiftDurationHours, hourlyRate: 0 }] }))}><Plus className="size-3.5" /> Add role</Button></div><div className="space-y-2">{form.labour.map((line, index) => <div key={line.id} className="grid grid-cols-[minmax(0,1fr)_70px_80px_90px_32px] gap-2"><Input aria-label="Labour role" value={line.name} onChange={(event) => updateLabour(index, { name: event.target.value })} /><Input aria-label="Headcount" type="number" min="0" step="1" value={line.headcount} onChange={(event) => updateLabour(index, { headcount: Number(event.target.value) || 0 })} /><Input aria-label="Hours per shift" type="number" min="0" step="0.5" value={line.hoursPerShift} onChange={(event) => updateLabour(index, { hoursPerShift: Number(event.target.value) || 0 })} /><Input aria-label="Hourly rate" type="number" min="0" step="0.01" value={line.hourlyRate} onChange={(event) => updateLabour(index, { hourlyRate: Number(event.target.value) || 0 })} /><Button aria-label="Remove labour role" variant="ghost" size="icon-xs" onClick={() => setForm((previous) => ({ ...previous, labour: previous.labour.filter((_, row) => row !== index) }))}><Trash2 className="size-3.5 text-slate-400" /></Button></div>)}</div><div className="mt-1 grid grid-cols-[minmax(0,1fr)_70px_80px_90px_32px] gap-2 px-1 text-[11px] text-slate-400"><span>Role</span><span>People</span><span>Hours</span><span>$/hour</span></div></div>
              <div><div className="mb-2 flex items-center justify-between"><div><h4 className="text-sm font-semibold text-slate-900">Plant &amp; equipment</h4><p className="text-xs text-slate-500">Units × hours × shifts × rate</p></div><Button variant="outline" size="sm" onClick={() => setForm((previous) => ({ ...previous, plant: [...previous.plant, { id: newId("plant"), name: "New plant", units: 1, hoursPerShift: previous.shiftDurationHours, hourlyRate: 0 }] }))}><Plus className="size-3.5" /> Add plant</Button></div><div className="space-y-2">{form.plant.map((line, index) => <div key={line.id} className="grid grid-cols-[minmax(0,1fr)_70px_80px_90px_32px] gap-2"><Input aria-label="Plant name" value={line.name} onChange={(event) => updatePlant(index, { name: event.target.value })} /><Input aria-label="Plant units" type="number" min="0" step="1" value={line.units} onChange={(event) => updatePlant(index, { units: Number(event.target.value) || 0 })} /><Input aria-label="Plant hours" type="number" min="0" step="0.5" value={line.hoursPerShift} onChange={(event) => updatePlant(index, { hoursPerShift: Number(event.target.value) || 0 })} /><Input aria-label="Plant rate" type="number" min="0" step="0.01" value={line.hourlyRate} onChange={(event) => updatePlant(index, { hourlyRate: Number(event.target.value) || 0 })} /><Button aria-label="Remove plant" variant="ghost" size="icon-xs" onClick={() => setForm((previous) => ({ ...previous, plant: previous.plant.filter((_, row) => row !== index) }))}><Trash2 className="size-3.5 text-slate-400" /></Button></div>)}</div><div className="mt-1 grid grid-cols-[minmax(0,1fr)_70px_80px_90px_32px] gap-2 px-1 text-[11px] text-slate-400"><span>Plant</span><span>Units</span><span>Hours</span><span>$/hour</span></div></div>
            </div>
            <div className="mt-5"><div className="mb-2 flex items-center justify-between"><div><h4 className="text-sm font-semibold text-slate-900">Traffic-control resources</h4><p className="text-xs text-slate-500">Resource quantity × days × estimated shifts × rate</p></div><Button variant="outline" size="sm" onClick={() => setForm((previous) => ({ ...previous, traffic: [...previous.traffic, { id: newId("traffic"), name: "New traffic resource", units: 1, days: 1, ratePerDay: 0 }] }))}><Plus className="size-3.5" /> Add resource</Button></div><div className="space-y-2">{form.traffic.map((line, index) => <div key={line.id} className="grid max-w-3xl grid-cols-[minmax(0,1fr)_80px_80px_100px_32px] gap-2"><Input aria-label="Traffic resource" value={line.name} onChange={(event) => updateTraffic(index, { name: event.target.value })} /><Input aria-label="Traffic units" type="number" min="0" step="1" value={line.units} onChange={(event) => updateTraffic(index, { units: Number(event.target.value) || 0 })} /><Input aria-label="Traffic days" type="number" min="0" step="1" value={line.days} onChange={(event) => updateTraffic(index, { days: Number(event.target.value) || 0 })} /><Input aria-label="Traffic rate" type="number" min="0" step="0.01" value={line.ratePerDay} onChange={(event) => updateTraffic(index, { ratePerDay: Number(event.target.value) || 0 })} /><Button aria-label="Remove traffic resource" variant="ghost" size="icon-xs" onClick={() => setForm((previous) => ({ ...previous, traffic: previous.traffic.filter((_, row) => row !== index) }))}><Trash2 className="size-3.5 text-slate-400" /></Button></div>)}</div><div className="mt-1 grid max-w-3xl grid-cols-[minmax(0,1fr)_80px_80px_100px_32px] gap-2 px-1 text-[11px] text-slate-400"><span>Resource</span><span>Units</span><span>Days</span><span>$/day</span></div></div>
          </Section>

          <Section className={estimateStep==="Subcontractors & Indirects"?"":"hidden"} icon={Settings2} title="Mobilisation, allowances & subcontractors" description="Keep establishment, float, accommodation, travel and external work visible in the cost build-up.">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="Mobilisations"><Input type="number" min="0" step="1" value={form.mobilisations} onChange={(event) => setNumberField("mobilisations", event.target.value)} /></Field>
              <Field label="Mobilisation rate ($)"><Input type="number" min="0" step="1" value={form.mobilisationRate} onChange={(event) => setNumberField("mobilisationRate", event.target.value)} /></Field>
              <Field label="Float movements"><Input type="number" min="0" step="1" value={form.floatMovements} onChange={(event) => setNumberField("floatMovements", event.target.value)} /></Field>
              <Field label="Float rate ($)"><Input type="number" min="0" step="1" value={form.floatRate} onChange={(event) => setNumberField("floatRate", event.target.value)} /></Field>
              <Field label="Accommodation nights"><Input type="number" min="0" step="1" value={form.accommodationNights} onChange={(event) => setNumberField("accommodationNights", event.target.value)} /></Field>
              <Field label="Accommodation people"><Input type="number" min="0" step="1" value={form.accommodationPersons} onChange={(event) => setNumberField("accommodationPersons", event.target.value)} /></Field>
              <Field label="Accommodation rate ($/night)" className="sm:col-span-2"><Input type="number" min="0" step="1" value={form.accommodationRate} onChange={(event) => setNumberField("accommodationRate", event.target.value)} /></Field>
              <Field label="Travel people"><Input type="number" min="0" step="1" value={form.travelPersons} onChange={(event) => setNumberField("travelPersons", event.target.value)} /></Field>
              <Field label="Travel days"><Input type="number" min="0" step="1" value={form.travelDays} onChange={(event) => setNumberField("travelDays", event.target.value)} /></Field>
              <Field label="Travel allowance ($/day)" className="sm:col-span-2"><Input type="number" min="0" step="1" value={form.travelAllowanceRate} onChange={(event) => setNumberField("travelAllowanceRate", event.target.value)} /></Field>
            </div>
            <div className="mt-5"><div className="mb-2 flex items-center justify-between"><div><h4 className="text-sm font-semibold text-slate-900">Subcontractor costs</h4><p className="text-xs text-slate-500">External quote line items, hire or specialist work.</p></div><Button variant="outline" size="sm" onClick={() => setForm((previous) => ({ ...previous, subcontractors: [...previous.subcontractors, { id: newId("subcontractor"), name: "New subcontractor", quantity: 1, unit: "item", unitRate: 0 }] }))}><Plus className="size-3.5" /> Add subcontractor</Button></div><div className="space-y-2">{form.subcontractors.map((line, index) => <div key={line.id} className="grid max-w-3xl grid-cols-[minmax(0,1fr)_80px_90px_100px_32px] gap-2"><Input aria-label="Subcontractor" value={line.name} onChange={(event) => updateSubcontractor(index, { name: event.target.value })} /><Input aria-label="Subcontractor quantity" type="number" min="0" step="0.1" value={line.quantity} onChange={(event) => updateSubcontractor(index, { quantity: Number(event.target.value) || 0 })} /><Input aria-label="Subcontractor unit" value={line.unit} onChange={(event) => updateSubcontractor(index, { unit: event.target.value })} /><Input aria-label="Subcontractor rate" type="number" min="0" step="0.01" value={line.unitRate} onChange={(event) => updateSubcontractor(index, { unitRate: Number(event.target.value) || 0 })} /><Button aria-label="Remove subcontractor" variant="ghost" size="icon-xs" onClick={() => setForm((previous) => ({ ...previous, subcontractors: previous.subcontractors.filter((_, row) => row !== index) }))}><Trash2 className="size-3.5 text-slate-400" /></Button></div>)}</div><div className="mt-1 grid max-w-3xl grid-cols-[minmax(0,1fr)_80px_90px_100px_32px] gap-2 px-1 text-[11px] text-slate-400"><span>Subcontractor</span><span>Qty</span><span>Unit</span><span>Rate</span></div></div>
          </Section>

          <Section className={estimateStep==="Price & Margin"?"":"hidden"} icon={CircleDollarSign} title="Commercial rules" description="Overheads, contingency, margin/markup and GST are applied to the calculated cost base.">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
              <Field label="Overheads (%)"><Input type="number" min="0" step="0.1" value={form.overheadsPct} onChange={(event) => setNumberField("overheadsPct", event.target.value)} /></Field>
              <Field label="Contingency (%)"><Input type="number" min="0" step="0.1" value={form.contingencyPct} onChange={(event) => setNumberField("contingencyPct", event.target.value)} /></Field>
              <Field label="Price method"><NativeSelect value={form.marginType} onChange={(event) => setField("marginType", event.target.value as "margin" | "markup")}><NativeSelectOption value="margin">Gross margin</NativeSelectOption><NativeSelectOption value="markup">Cost markup</NativeSelectOption></NativeSelect></Field>
              <Field label={form.marginType === "margin" ? "Margin (%)" : "Markup (%)"}><Input type="number" min="0" step="0.1" value={form.marginValue} onChange={(event) => setNumberField("marginValue", event.target.value)} /></Field>
              <Field label="GST (%)"><Input type="number" min="0" step="0.1" value={form.gstPct} onChange={(event) => setNumberField("gstPct", event.target.value)} /></Field>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-4"><Metric label="Direct cost" value={<Money value={totals.directCost} />} note="Before overheads & contingency" /><Metric label="Total cost" value={<Money value={totals.totalCost} />} note={`${decimal.format(totals.costPerTonne)} / t cost`} tone="blue" /><Metric label="Gross profit" value={<Money value={totals.grossProfit} />} note={`${decimal.format(totals.grossMargin)}% margin`} tone={totals.grossMargin >= form.targetMarginPct ? "green" : "amber"} /><Metric label="Quote incl. GST" value={<Money value={totals.totalQuoteValue} />} note={`${currencyExact.format(totals.sellRate)} ex GST`} tone="orange" /></div>
          </Section>

          <Section className={estimateStep==="Assumptions & Exclusions"?"":"hidden"} icon={FileText} title="Notes, exclusions & assumptions" description="These fields are retained with every estimate revision and appear in the printable quote summary.">
            <div className="grid gap-4 lg:grid-cols-3"><Field label="Internal notes"><Textarea value={form.notes} onChange={(event) => setField("notes", event.target.value)} rows={4} placeholder="Estimator notes, source documents or internal review points" /></Field><Field label="Exclusions"><Textarea value={form.exclusions} onChange={(event) => setField("exclusions", event.target.value)} rows={4} placeholder="What is excluded from this price" /></Field><Field label="Assumptions"><Textarea value={form.assumptions} onChange={(event) => setField("assumptions", event.target.value)} rows={4} placeholder="Pricing and delivery assumptions" /></Field></div>
          </Section>

          {estimateStep==="Review & Approval" && (validation.errors.length > 0 || validation.warnings.length > 0) && <section className="no-print rounded-xl border border-amber-200 bg-amber-50/70 p-4"><div className="flex items-start gap-3"><ShieldAlert className="mt-0.5 size-5 text-amber-700" /><div><h3 className="font-semibold text-amber-950">Estimate validation</h3>{validation.errors.length > 0 && <div className="mt-2 space-y-1 text-sm text-rose-800">{validation.errors.map((message) => <p key={message} className="flex gap-2"><X className="mt-0.5 size-4 shrink-0" />{message}</p>)}</div>}{validation.warnings.length > 0 && <div className="mt-2 space-y-1 text-sm text-amber-900">{validation.warnings.map((message) => <p key={message} className="flex gap-2"><AlertTriangle className="mt-0.5 size-4 shrink-0" />{message}</p>)}</div>}</div></div></section>}

          {estimateStep==="Review & Approval" && <EstimateApprovalPanel estimateId={selectedId} onChanged={() => { void loadList(selectedId); }} />}
          <section className={`no-print rounded-xl border bg-[#101a24] p-4 text-white shadow-sm sm:p-5 ${estimateStep==="Review & Approval"?"":"hidden"}`}><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-wider text-orange-300">Quote control</p><h3 className="mt-1 text-lg font-semibold">{currentStatus === "Awarded" ? "Approved budget baseline" : "Save and progress this estimate"}</h3><p className="mt-1 text-sm text-slate-300">{currentStatus === "Awarded" ? `Job ${estimates.find((estimate) => estimate.id === selectedId)?.jobId?.slice(0, 8) ?? "created"} retains the awarded snapshot.` : "Every save creates a revision so the original pricing remains traceable."}</p></div><div className="flex flex-wrap justify-end gap-2">{currentStatus !== "Awarded" && <><Button variant="secondary" onClick={() => saveEstimate("Draft", "Saved draft")} disabled={busy}><Save className="size-4" /> Save draft</Button><Button variant="outline" className="border-white/20 bg-white/10 text-white hover:bg-white/20 hover:text-white" onClick={() => saveEstimate("Internal Review", "Sent to internal review")} disabled={busy}><ShieldAlert className="size-4" /> Internal review</Button><Button variant="outline" className="border-white/20 bg-white/10 text-white hover:bg-white/20 hover:text-white" onClick={() => saveEstimate("Submitted", "Submitted to client")} disabled={busy}><FileCheck2 className="size-4" /> Submit</Button>{["Revised", "Lost", "Cancelled"].includes(currentStatus) && <Button variant="outline" className="border-white/20 bg-white/10 text-white hover:bg-white/20 hover:text-white" onClick={() => saveEstimate(currentStatus, `Saved as ${currentStatus}`)} disabled={busy}><Save className="size-4" /> Save {currentStatus}</Button>}<Button onClick={awardEstimate} disabled={busy || !selectedId}><CheckCircle2 className="size-4" /> Award &amp; create job</Button></>}{currentStatus === "Awarded" && <Button onClick={reopenEstimate} disabled={busy}><RefreshCw className="size-4" /> Reopen estimate</Button>}</div></div></section>
        </div>
      </div>

      {showRates && <div className="no-print fixed inset-0 z-40 bg-slate-950/30 p-4 sm:p-8" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowRates(false); }}><div className="mx-auto flex max-h-[calc(100dvh-4rem)] max-w-5xl flex-col overflow-hidden rounded-xl border bg-white shadow-2xl"><div className="flex items-start justify-between border-b px-5 py-4"><div><div className="flex items-center gap-2"><LibraryBig className="size-5 text-primary" /><h3 className="text-lg font-semibold">Organisation rate library</h3></div><p className="mt-1 text-sm text-slate-500">Edit reusable rates used by new estimates. Changes are saved to this organisation.</p></div><Button variant="ghost" size="icon" onClick={() => setShowRates(false)}><X className="size-5" /></Button></div><div className="overflow-y-auto p-5"><div className="grid gap-4 sm:grid-cols-3"><Field label="Library name" className="sm:col-span-2"><Input value={activeLibrary.name} onChange={(event) => setActiveLibrary((previous) => ({ ...previous, name: event.target.value }))} /></Field><Field label="Target margin (%)"><Input type="number" min="0" step="0.1" value={activeLibrary.targetMarginPct} onChange={(event) => setActiveLibrary((previous) => ({ ...previous, targetMarginPct: Number(event.target.value) || 0 }))} /></Field></div><div className="mt-5 grid gap-5 lg:grid-cols-2">{rateCategories.map(({ key, label }) => <div key={key} className="rounded-lg border p-4"><div className="mb-3 flex items-center justify-between"><h4 className="font-semibold text-slate-900">{label}</h4><span className="text-xs text-slate-500">{(activeLibrary[key] as RateItem[]).length} rates</span></div><div className="space-y-2">{(activeLibrary[key] as RateItem[]).map((item, index) => <div key={item.id} className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_78px_86px]"><Input value={item.name} onChange={(event) => updateRate(key, index, { name: event.target.value })} /><Input value={item.unit} onChange={(event) => updateRate(key, index, { unit: event.target.value })} /><Input aria-label={`${item.name} rate`} type="number" min="0" step="0.01" value={item.rate} onChange={(event) => updateRate(key, index, { rate: Number(event.target.value) || 0 })} /></div>)}</div></div>)}</div></div><div className="flex justify-end gap-2 border-t bg-slate-50 px-5 py-4"><Button variant="outline" onClick={() => setShowRates(false)}>Close</Button><Button onClick={saveRateLibrary} disabled={rateSaving}>{rateSaving ? <LoaderCircle className="size-4 animate-spin" /> : <Save className="size-4" />} Save rate library</Button></div></div></div>}

      <div className="no-print grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><Metric label="Total tonnes" value={decimal.format(totals.totalTonnes)} note={`${decimal.format(totals.effectiveAreaM2)} m² effective area`} tone="blue" /><Metric label="Cost per tonne" value={<Money value={totals.costPerTonne} exact />} note={`${currencyExact.format(totals.costPerM2)} / m²`} /><Metric label="Sell rate" value={<Money value={totals.sellRate} exact />} note="Ex GST" tone="green" /><Metric label="Gross margin" value={`${decimal.format(totals.grossMargin)}%`} note={`Target ${decimal.format(form.targetMarginPct)}%`} tone={totals.grossMargin >= form.targetMarginPct ? "green" : "amber"} /></div>

      <div className="no-print rounded-xl border bg-white shadow-sm"><div className="flex items-center gap-2 border-b px-5 py-4"><Calculator className="size-4 text-primary" /><h3 className="font-semibold">Cost build-up</h3><span className="ml-auto text-sm text-slate-500">{currentStatus} · {form.shiftType}</span></div><div className="grid gap-6 p-5 lg:grid-cols-[minmax(0,1fr)_320px]"><div className="divide-y rounded-lg border">{costRows.map(([label, value]) => <div key={label} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm"><span className="text-slate-600">{label}</span><span className="font-medium text-slate-900"><Money value={value} exact /></span></div>)}<div className="flex items-center justify-between gap-3 bg-slate-50 px-4 py-3 text-sm font-semibold"><span>Total cost</span><Money value={totals.totalCost} exact /></div></div><div className="rounded-lg bg-[#101a24] p-4 text-white"><p className="text-xs font-semibold uppercase tracking-wider text-orange-300">Sell summary</p><div className="mt-4 space-y-3 text-sm"><div className="flex justify-between gap-3"><span className="text-slate-300">Sell rate ex GST</span><strong><Money value={totals.sellRate} exact /></strong></div><div className="flex justify-between gap-3"><span className="text-slate-300">Gross profit</span><strong className="text-emerald-300"><Money value={totals.grossProfit} exact /></strong></div><div className="flex justify-between gap-3"><span className="text-slate-300">GST</span><strong><Money value={totals.gstAmount} exact /></strong></div><div className="border-t border-white/15 pt-3"><div className="flex justify-between gap-3"><span className="font-semibold">Total quote</span><strong className="text-xl text-orange-300"><Money value={totals.totalQuoteValue} exact /></strong></div></div></div></div></div></div>

      <div className="print-only quote-print"><div className="quote-header"><div><p className="quote-kicker">{brand.companyName}</p><h1>Estimate &amp; Quote Summary</h1><p>{form.projectName || "Untitled project"} · {form.site || "Site to be confirmed"}</p></div><div className="quote-meta"><strong>{currentStatus}</strong><span>{form.shiftType}</span><span>{new Date().toLocaleDateString("en-AU")}</span></div></div><div className="quote-grid"><div><h2>Scope</h2><p><strong>Client:</strong> {form.clientName || "—"}</p><p><strong>Opportunity:</strong> {form.opportunityName || "—"}</p><p><strong>Work type:</strong> {form.workType}</p><p><strong>Specification:</strong> {form.specification || "—"}</p><p><strong>Quantity:</strong> {decimal.format(totals.effectiveAreaM2)} m² · {decimal.format(totals.totalTonnes)} t · {totals.estimatedShifts} shifts</p></div><div><h2>Commercial summary</h2><p><strong>Direct cost:</strong> <Money value={totals.directCost} exact /></p><p><strong>Total cost:</strong> <Money value={totals.totalCost} exact /></p><p><strong>Sell rate ex GST:</strong> <Money value={totals.sellRate} exact /></p><p><strong>Gross profit:</strong> <Money value={totals.grossProfit} exact /></p><p><strong>Gross margin:</strong> {decimal.format(totals.grossMargin)}%</p><p><strong>Total quote incl. GST:</strong> <Money value={totals.totalQuoteValue} exact /></p></div></div><div className="quote-columns"><div><h2>Exclusions</h2><p>{form.exclusions || "None stated."}</p></div><div><h2>Assumptions</h2><p>{form.assumptions || "None stated."}</p></div></div><p className="quote-footer">This summary is generated from the approved estimate version and remains subject to the detailed scope, exclusions and assumptions recorded in the estimate.</p></div>
    </div>
  );
}
