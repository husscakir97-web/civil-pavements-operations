"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { BarChart3, BriefcaseBusiness, Building2, CircleUserRound, ClipboardList, DollarSign, HardHat, Home, Menu, Search, Settings, ShieldCheck, Workflow, type LucideIcon } from "lucide-react";
import type { NavLabel } from "@/components/operations-workspace";
import { Toaster } from "@/components/ui/sonner";
import { Sheet, SheetContent, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { WorkspaceBrandProvider } from "@/components/workspace-brand";
import { useSession, Tabs } from "@/components/v1/kit";
import { NavContext, parseRoute, routeHash, useNav, type Route } from "@/components/v1/nav";
import { OfflineProvider } from "@/components/v1/offline";
import { ADMIN_SUBS, FIELD_SHELL_ROLES } from "@/lib/v1/navigation";
import type { Capability } from "@/lib/platform/permissions";

const loading = () => <div role="status" className="workspace-placeholder"><span className="sr-only">Loading workspace…</span><div className="h-7 w-52 rounded bg-slate-200/70"/><div className="mt-3 h-4 w-72 max-w-full rounded bg-slate-200/50"/><div className="mt-8 grid gap-4 sm:grid-cols-3">{[0,1,2].map(i=><div key={i} className="h-28 rounded-xl border bg-white"/>)}</div><div className="mt-5 h-64 rounded-xl border bg-white"/></div>;
// Workspaces load on demand; hovering a navigation item preloads its bundle.
const loaders = {
  home: () => import("@/components/v1/home"),
  pipeline: () => import("@/components/v1/pipeline"),
  estimates: () => import("@/components/estimates-quotes"),
  projects: () => import("@/components/v1/projects"),
  operations: () => import("@/components/operations-workspace"),
  dockets: () => import("@/components/docket-dashboard"),
  commercial: () => import("@/components/v1/commercial"),
  hseq: () => import("@/components/v1/hseq"),
  reports: () => import("@/components/v1/reports"),
  admin: () => import("@/components/v1/admin"),
  company: () => import("@/components/v1/company"),
  preparation: () => import("@/components/preparation-workspace"),
  search: () => import("@/components/v1/search"),
  field: () => import("@/components/v1/field"),
  fieldRecords: () => import("@/components/field-workspace"),
  resources: () => import("@/components/v1/resources"),
};
const otherResources = ["crews", "suppliers", "subcontractors"];
const HomeV1 = dynamic(() => loaders.home().then(m => m.HomeV1), { loading });
const OpportunitiesView = dynamic(() => loaders.pipeline().then(m => m.OpportunitiesView), { loading });
const TendersView = dynamic(() => loaders.pipeline().then(m => m.TendersView), { loading });
const EstimatesQuotes = dynamic(() => loaders.estimates().then(m => m.EstimatesQuotes), { loading });
const ProjectsView = dynamic(() => loaders.projects().then(m => m.ProjectsView), { loading });
const OperationsPage = dynamic(() => loaders.operations().then(m => m.OperationsPage), { loading });
const DocketDashboard = dynamic(() => loaders.dockets().then(m => m.DocketDashboard), { loading });
const CommercialArea = dynamic(() => loaders.commercial().then(m => m.CommercialArea), { loading });
const HseqArea = dynamic(() => loaders.hseq().then(m => m.HseqArea), { loading });
const ReportsV1 = dynamic(() => loaders.reports().then(m => m.ReportsV1), { loading });
const AdminArea = dynamic(() => loaders.admin().then(m => m.AdminArea), { loading });
const Onboarding = dynamic(() => loaders.company().then(m => m.Onboarding), { loading });
const PreparationWorkspace = dynamic(() => loaders.preparation().then(m => m.PreparationWorkspace), { loading });
const SearchV1 = dynamic(() => loaders.search().then(m => m.SearchV1), { loading });
const FieldToday = dynamic(() => loaders.field().then(m => m.FieldToday), { loading });
const ResourcesArea = dynamic(() => loaders.resources().then(m => m.ResourcesArea), { loading });
const FieldWorkspace = dynamic(() => loaders.fieldRecords().then(m => m.FieldWorkspace), { loading });

type Area = { key: string; label: string; icon: LucideIcon; module?: string; capability?: Capability; subs?: Array<{ key: string; module?: string; capability?: Capability; anyOf?: Capability[] }>; preload: () => Promise<unknown> };
const AREAS: Area[] = [
  { key: "Home", label: "Home", icon: Home, preload: loaders.home },
  { key: "Pipeline", label: "Pipeline", icon: BriefcaseBusiness, module: "pipeline", capability: "pipeline.view", subs: [{ key: "Opportunities" }, { key: "Tenders" }, { key: "Estimates", module: "estimating" }], preload: loaders.pipeline },
  { key: "Projects", label: "Projects", icon: HardHat, module: "projects", capability: "project.view", preload: loaders.projects },
  { key: "Operations", label: "Operations", icon: Workflow, module: "operations", capability: "schedule.view", subs: [{ key: "Schedule" }, { key: "Resources" }, { key: "Dockets", module: "dockets", capability: "docket.approve" }], preload: loaders.operations },
  { key: "Commercial", label: "Commercial", icon: DollarSign, module: "commercial", capability: "commercial.view", preload: loaders.commercial },
  { key: "IMS & HSEQ", label: "IMS & HSEQ", icon: ShieldCheck, module: "ims", capability: "hseq.view", preload: loaders.hseq },
  { key: "Reports", label: "Reports", icon: BarChart3, module: "reports", capability: "reports.view", preload: loaders.reports },
  { key: "Admin", label: "Admin", icon: Settings, subs: ADMIN_SUBS, preload: loaders.admin },
];

export function PavementOS() {
  return <WorkspaceBrandProvider><Router /></WorkspaceBrandProvider>;
}

function useRoute(): [Route, (area: string, sub?: string, id?: string, tab?: string) => void] {
  const [route, setRoute] = useState<Route>({ area: "Home" });
  useEffect(() => {
    const restore = () => { if (window.location.hash === "#main-content") return; setRoute(parseRoute(window.location.hash)); };
    restore();
    window.addEventListener("hashchange", restore);
    return () => window.removeEventListener("hashchange", restore);
  }, []);
  const navigate = useCallback((area: string, sub?: string, id?: string, tab?: string) => {
    const next = { area, sub, id, tab };
    setRoute(next);
    const hash = routeHash(next);
    if (window.location.hash !== hash) window.history.pushState(null, "", hash);
    window.scrollTo({ top: 0 });
  }, []);
  return [route, navigate];
}

function Router() {
  const session = useSession();
  const [route, navigate] = useRoute();
  // The first render is always the loading state (role unknown), so reading
  // sessionStorage lazily here cannot cause a hydration mismatch.
  const [skipOnboarding, setSkipOnboarding] = useState(() => { try { return typeof window !== "undefined" && sessionStorage.getItem("onboarding-skipped") === "1"; } catch { return false; } });
  if (session.role === "read-only") return loading();
  const nav = { route, navigate };
  // Field workers and supervisors work from the mobile field shell (price-free, offline-capable).
  if (FIELD_SHELL_ROLES.includes(session.role)) return <NavContext.Provider value={nav}><OfflineProvider><FieldShell /></OfflineProvider></NavContext.Provider>;
  if (session.role === "admin" && !session.onboarding.completed && !skipOnboarding) {
    return <main className="min-h-screen bg-[#f6f7f9] p-4 sm:p-8"><Onboarding onDone={() => navigate("Home")} /><div className="mx-auto mt-4 max-w-3xl text-center"><button className="text-sm text-slate-500 underline" onClick={() => { try { sessionStorage.setItem("onboarding-skipped", "1"); } catch { /* ignore */ } setSkipOnboarding(true); }}>Skip setup and go to the workspace</button></div></main>;
  }
  return <NavContext.Provider value={nav}><WorkspaceShell /></NavContext.Provider>;
}

function FieldShell() {
  const { brand, userEmail, role } = useSession();
  // The service worker keeps the app shell available offline; queued work lives in IndexedDB.
  useEffect(() => { if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {}); }, []);
  const [tab, setTab] = useState<"today" | "records" | "search">("today");
  return <div className="min-h-screen bg-[#f6f7f9] pb-20 text-slate-900">
    <header className="sticky top-0 z-20 flex items-center justify-between gap-3 border-b bg-white px-4 py-3"><div className="min-w-0"><p className="truncate font-semibold">{brand.companyName}</p><p className="text-xs text-slate-500">{role === "supervisor" ? "Supervisor" : "Field"}</p></div><Link href="/account" className="flex min-h-11 items-center rounded-lg border px-3 text-sm" title={userEmail}>Account</Link></header>
    <Toaster position="top-center" richColors />
    <main className="p-4 sm:p-6">{tab === "today" ? <FieldToday onOpenRecords={() => setTab("records")} /> : tab === "records" ? <FieldWorkspace /> : <SearchV1 />}</main>
    <nav aria-label="Field navigation" className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-3 border-t bg-white pb-[env(safe-area-inset-bottom)]">{([["today", "Today", Home], ["records", "Shift records", ClipboardList], ["search", "Search", Search]] as const).map(([k, label, Icon]) => <button key={k} onClick={() => setTab(k)} aria-current={tab === k ? "page" : undefined} className={`flex min-h-16 flex-col items-center justify-center gap-1 text-xs font-medium ${tab === k ? "text-orange-700" : "text-slate-500"}`}><Icon aria-hidden className="size-5" />{label}</button>)}</nav>
  </div>;
}

function WorkspaceShell() {
  const session = useSession();
  const { brand, userEmail, role } = session;
  const [open, setOpen] = useState(false);
  const { route, navigate } = useNav();
  const allowed = (item: { module?: string; capability?: Capability; anyOf?: Capability[] }) => (!item.module || session.module(item.module)) && (!item.capability || session.can(item.capability)) && (!item.anyOf?.length || item.anyOf.some(c => session.can(c)));
  // An area with sub-pages is shown only when at least one of them is permitted.
  const areas = AREAS.filter(a => allowed(a) && (!a.subs || a.subs.some(allowed)));
  const area = areas.find(a => a.key === route.area) ?? (route.area === "Search" ? null : areas[0]);
  const subs = area?.subs?.filter(allowed) ?? [];
  const sub = subs.find(s => s.key === route.sub)?.key ?? subs[0]?.key;

  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") { event.preventDefault(); navigate("Search"); } };
    window.addEventListener("keydown", shortcut);
    return () => window.removeEventListener("keydown", shortcut);
  }, [navigate]);

  const go = (a: string, s?: string) => { navigate(a, s); setOpen(false); };
  const legacyNavigate = (label: NavLabel) => {
    const map: Partial<Record<NavLabel, [string, string?]>> = { Planning: ["Operations", "Schedule"], Resources: ["Operations", "Resources"], Dockets: ["Operations", "Dockets"], Field: ["Operations", "Schedule"], Jobs: ["Projects"], Delivery: ["Projects"], Commercial: ["Commercial"], Compliance: ["IMS & HSEQ"], "IMS & Compliance": ["IMS & HSEQ"], Reports: ["Reports"], Settings: ["Admin", "Settings"], "Admin/Settings": ["Admin", "Settings"], Opportunities: ["Pipeline", "Opportunities"], "Estimates & Quotes": ["Pipeline", "Estimates"] };
    const next = map[label] ?? ["Home"];
    navigate(next[0], next[1]);
  };

  const sidebar = <>
    <div className="flex h-20 items-center gap-3 px-5"><span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary"><Building2 aria-hidden className="size-5" /></span><div className="min-w-0"><p className="truncate text-sm font-semibold tracking-tight">{brand.productName}</p><p className="mt-0.5 truncate text-xs text-slate-400">{brand.companyName}</p></div></div>
    <nav aria-label="Primary application areas" className="space-y-1 px-3 pb-5">{areas.map(a => { const Icon = a.icon; const current = area?.key === a.key; return <div key={a.key}>
      <button aria-current={current ? "page" : undefined} onClick={() => go(a.key)} onPointerEnter={() => void a.preload().catch(() => {})} onFocus={() => void a.preload().catch(() => {})} className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-medium transition-colors ${current ? "bg-white/10 text-white" : "text-slate-400 hover:bg-white/5 hover:text-white"}`}><Icon aria-hidden className={`size-[18px] ${current ? "text-orange-400" : ""}`} />{a.label}</button>
      {current && a.subs && <div className="ml-9 mt-1 grid gap-0.5 border-l border-white/10 pl-2">{a.subs.filter(allowed).map(s => <button key={s.key} onClick={() => go(a.key, s.key)} className={`rounded px-2 py-1.5 text-left text-xs ${sub === s.key ? "text-white" : "text-slate-400 hover:text-white"}`}>{s.key}</button>)}</div>}
    </div>; })}</nav>
    <div className="mt-auto border-t border-white/10 p-3"><button onClick={() => go("Search")} className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-medium text-slate-400 hover:bg-white/10 hover:text-white"><Search aria-hidden className="size-4" />Search</button><Link href="/account" className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-slate-400 hover:bg-white/10 hover:text-white"><CircleUserRound aria-hidden className="size-4" />{role === "admin" ? "Account & team" : "Account"}</Link></div>
  </>;

  let content: ReactNode = null;
  const k = route.area === "Search" ? "Search" : area?.key;
  if (k === "Search") content = <SearchV1 />;
  else if (k === "Home") content = <HomeV1 />;
  else if (k === "Pipeline") content = sub === "Tenders" ? <TendersView /> : sub === "Estimates" ? <EstimatesQuotes key={route.id || "all"} initialEstimateId={route.id} /> : <OpportunitiesView />;
  else if (k === "Projects") content = <ProjectsView />;
  else if (k === "Operations") content = sub === "Dockets" ? <DocketDashboard /> : sub === "Resources" ? <ResourcesArea key="resources" other={<OperationsPage module="Resources" initialResource="crews" resourceTypes={otherResources} onNavigate={legacyNavigate} />} /> : <OperationsPage key="schedule" module="Planning" onNavigate={legacyNavigate} />;
  else if (k === "Commercial") content = <CommercialArea />;
  else if (k === "IMS & HSEQ") content = <HseqArea />;
  else if (k === "Reports") content = <ReportsV1 />;
  else if (k === "Admin") content = sub === "People" ? <ResourcesArea key="people" initial="workers" /> : sub === "Plant" ? <ResourcesArea key="plant" initial="plant" /> : sub === "Company Library" ? <LibraryArea /> : <AdminArea sub={sub || "Company"} onNavigate={() => {}} />;

  const mobile = areas.filter(a => !["Admin", "Reports"].includes(a.key)).slice(0, 4);
  return <div className="app-shell min-h-screen bg-[#f6f7f9] text-slate-900">
    <a href="#main-content" className="skip-link sr-only focus:not-sr-only">Skip to content</a>
    <nav aria-label="Quick navigation" className="mobile-quick-nav fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t bg-white pb-[env(safe-area-inset-bottom)] lg:hidden">{mobile.map(a => { const Icon = a.icon; return <button key={a.key} onClick={() => go(a.key)} aria-current={area?.key === a.key ? "page" : undefined} className={`flex min-h-16 flex-col items-center justify-center gap-1 px-1 text-[10px] font-medium sm:text-xs ${area?.key === a.key ? "text-orange-700" : "text-slate-500"}`}><Icon aria-hidden className="size-5" />{a.label}</button>; })}<button className="flex min-h-16 flex-col items-center justify-center gap-1 text-[10px] font-medium text-slate-500" onClick={() => setOpen(true)}><Menu aria-hidden className="size-5" />More</button></nav>
    <Toaster position="top-right" richColors />
    <div className="flex min-h-screen">
      <aside className="hidden w-64 shrink-0 bg-[#111c27] text-white lg:block"><div className="sticky top-0 flex h-dvh flex-col overflow-y-auto">{sidebar}</div></aside>
      <Sheet open={open} onOpenChange={setOpen}><SheetContent side="left" className="w-[min(90vw,320px)] overflow-y-auto border-0 bg-[#101a24] p-0 text-white"><SheetTitle className="sr-only">Navigation</SheetTitle><SheetDescription className="sr-only">Choose a work area</SheetDescription><div className="flex min-h-full flex-col">{sidebar}</div></SheetContent></Sheet>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex min-h-[72px] items-center justify-between gap-3 border-b bg-white px-4 sm:px-8">
          <div className="flex min-w-0 items-center"><button className="flex size-11 shrink-0 items-center justify-center lg:hidden" onClick={() => setOpen(true)} aria-label="Open navigation"><Menu /></button><p className="ml-2 truncate text-sm font-semibold text-slate-800 lg:ml-0">{k === "Search" ? "Search" : area?.label}{sub && <span className="font-normal text-slate-500"> · {sub}</span>}</p></div>
          <div className="flex items-center gap-2"><button onClick={() => navigate("Search")} className="flex h-10 items-center gap-3 rounded-lg border bg-slate-50 px-3 text-sm text-slate-500 hover:border-slate-300 hover:bg-white" aria-label="Search"><Search aria-hidden className="size-4" /><span className="hidden md:inline">Search your workspace</span><kbd className="ml-5 hidden rounded border bg-white px-1.5 py-0.5 text-[10px] lg:inline">Ctrl K</kbd></button><Link href="/account" title={userEmail || "Account"} aria-label="Account" className="flex size-10 items-center justify-center rounded-full border border-slate-200 bg-slate-100 text-xs font-semibold text-slate-700 hover:border-primary">{userEmail ? userEmail.slice(0, 2).toUpperCase() : <CircleUserRound className="size-5" />}</Link></div>
        </header>
        <main id="main-content" tabIndex={-1} className="mx-auto w-full min-w-0 max-w-[1600px] flex-1 p-4 pb-24 outline-none sm:p-6 sm:pb-24 lg:p-8">
          {subs.length > 0 && !(k === "Pipeline" && route.id) && <nav aria-label={`${area?.label} sections`} className="workspace-tabs mb-6 flex min-w-0 gap-1 overflow-x-auto border-b">{subs.map(s => <button key={s.key} aria-current={sub === s.key ? "page" : undefined} onClick={() => go(area!.key, s.key)} className={`shrink-0 border-b-2 px-4 pb-3 pt-1 text-sm transition-colors ${sub === s.key ? "border-primary font-semibold text-slate-900" : "border-transparent text-slate-500 hover:text-slate-900"}`}>{s.key}</button>)}</nav>}
          {areas.length === 1 && k === "Home" && <p className="mb-4 rounded-lg border bg-white p-3 text-sm text-slate-600">No modules are enabled for your role or organisation. Contact an administrator.</p>}
          {content}
        </main>
      </div>
    </div>
  </div>;
}

function LibraryArea() {
  const [tab, setTab] = useState<"items" | "responses">("items");
  return <div><Tabs label="Company library" active={tab} onChange={setTab} tabs={[{ key: "items", label: "Library items" }, { key: "responses", label: "Responses, templates & plans" }]} />{tab === "items" ? <LibraryRegister /> : <PreparationWorkspace scope="company" />}</div>;
}
const LibraryRegister = dynamic(() => import("@/components/v1/register-view").then(m => function Library() { return <m.RegisterView register="library" description="Policies, procedures, certifications, licences, insurances, capability statements, CVs, project examples and standard tender responses. Tender returnables link to these items." />; }), { loading });
