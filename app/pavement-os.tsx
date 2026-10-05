"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { BarChart3, BriefcaseBusiness, CalendarCheck, CalendarDays, CircleUserRound, ClipboardCheck, ClipboardList, Contact, DollarSign, FolderOpen, Home, Menu, Search, Settings, ShieldCheck, Truck, UsersRound, type LucideIcon } from "lucide-react";
import type { NavLabel } from "@/components/operations-workspace";
import { Toaster } from "@/components/ui/sonner";
import { Sheet, SheetContent, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { WorkspaceBrandProvider } from "@/components/workspace-brand";
import { useSession, Tabs } from "@/components/v1/kit";
import { createNavController, type HistoryPort, type NavController } from "@/lib/v1/nav-history";
import { NavContext, confirmLeave, parseRoute, routeHash, useNav, type Route } from "@/components/v1/nav";
import { OfflineProvider } from "@/components/v1/offline";
import { FIELD_SHELL_ROLES } from "@/lib/v1/navigation";
import { NotificationCenter } from "@/components/v1/notification-center";
import { navFor, resolveRoute, type NavArea } from "@/lib/v1/app-nav";
import { ENGINES, type EngineKey } from "@/lib/v1/engines";

const loading = () => <div role="status" className="workspace-placeholder"><span className="sr-only">Loading workspace…</span><div className="h-7 w-52 rounded bg-slate-200/70"/><div className="mt-3 h-4 w-72 max-w-full rounded bg-slate-200/50"/><div className="mt-8 grid gap-4 sm:grid-cols-3">{[0,1,2].map(i=><div key={i} className="h-28 rounded-xl border bg-white"/>)}</div><div className="mt-5 h-64 rounded-xl border bg-white"/></div>;
/** Today, as the reference shows it ("Monday, 05 October"). Rendered per request; the server and browser may differ near midnight, hence suppressHydrationWarning. */
const todayText = () => { const d = new Date(); return `${d.toLocaleDateString("en-AU", { weekday: "long" })}, ${String(d.getDate()).padStart(2, "0")} ${d.toLocaleDateString("en-AU", { month: "long" })}`; };
/** The Infrastruct mark (reference: Graphite Studio). */
const Mark = () => <svg aria-hidden viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="square"><path d="M9 20 15 4" /><path d="M15 4l2.2 16" /></svg>;
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
  documents: () => import("@/components/v1/documents"),
  engines: () => import("@/components/v1/engines"),
};
const HomeV1 = dynamic(() => loaders.home().then(m => m.HomeV1), { loading });
const OpportunitiesView = dynamic(() => loaders.pipeline().then(m => m.OpportunitiesView), { loading });
const TendersView = dynamic(() => loaders.pipeline().then(m => m.TendersView), { loading });
const EstimatesQuotes = dynamic(() => loaders.estimates().then(m => m.EstimatesQuotes), { loading });
const ProjectsView = dynamic(() => loaders.projects().then(m => m.ProjectsView), { loading });
const OperationsPage = dynamic(() => loaders.operations().then(m => m.OperationsPage), { loading });
const Planning = dynamic(() => import("@/components/v1/planning").then(m => m.Planning), { loading });
const Program = dynamic(() => import("@/components/v1/program").then(m => m.Program), { loading });
const Workshop = dynamic(() => import("@/components/v1/workshop").then(m => m.Workshop), { loading });
const JobsPlanning = dynamic(() => import("@/components/jobs-planning").then(m => m.JobsPlanning), { loading });
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
const DepotsArea = dynamic(() => import("@/components/v1/depots").then(m => m.DepotsArea), { loading });
const DocumentsWorkspace = dynamic(() => loaders.documents().then(m => m.DocumentsWorkspace), { loading });
const EngineOverview = dynamic(() => loaders.engines().then(m => m.EngineOverview), { loading });

type Area = NavArea & { icon: LucideIcon; preload: () => Promise<unknown> };
// Conventional business areas (lib/v1/app-nav.ts). The six-engine lifecycle is kept underneath and shown under Reports → Lifecycle.
const ICONS: Record<string, [LucideIcon, () => Promise<unknown>]> = {
  Home: [Home, loaders.home], Today: [CalendarCheck, loaders.field], CRM: [Contact, loaders.pipeline], Pipeline: [BriefcaseBusiness, loaders.pipeline],
  Projects: [ClipboardCheck, loaders.projects], Schedule: [CalendarDays, loaders.operations], Resources: [UsersRound, loaders.resources],
  Commercial: [DollarSign, loaders.commercial], "IMS & HSEQ": [ShieldCheck, loaders.hseq], Documents: [FolderOpen, loaders.documents], Reports: [BarChart3, loaders.reports], Admin: [Settings, loaders.admin],
};
const toArea = (n: NavArea): Area => ({ ...n, icon: ICONS[n.key]?.[0] ?? Truck, preload: ICONS[n.key]?.[1] ?? loaders.home });


export function PavementOS() {
  return <WorkspaceBrandProvider><Router /></WorkspaceBrandProvider>;
}

// Two URL spellings of the same screen (#Projects//id/tab and #Projects/Projects/id/tab) must compare equal.
const sameScreen = (a: string, b: string) => routeHash(resolveRoute(parseRoute(a))) === routeHash(resolveRoute(parseRoute(b)));

function useRoute(): [Route, (area: string, sub?: string, id?: string, tab?: string, focus?: string) => void] {
  const [route, setRoute] = useState<Route>({ area: "Home" });
  // The unsaved-work guard and the history model live in lib/v1/nav-history.ts (pure, tested against a simulated browser);
  // this only wires them to window.history and React state.
  const controller = useRef<NavController | null>(null);
  useEffect(() => {
    const port: HistoryPort = {
      state: () => window.history.state,
      hash: () => window.location.hash,
      push: (state, hash) => window.history.pushState(state, "", hash),
      replace: (state, hash) => window.history.replaceState(state, "", hash === undefined ? undefined : hash || window.location.pathname + window.location.search),
      go: delta => window.history.go(delta),
    };
    const makeId = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`);
    const c = createNavController(port, { confirmLeave, sameScreen, makeId, show: hash => setRoute(resolveRoute(parseRoute(hash))) });
    controller.current = c;
    c.mount();
    const onHash = () => c.onHashChange(), onPop = () => c.onPopState();
    window.addEventListener("hashchange", onHash);
    window.addEventListener("popstate", onPop);
    return () => { window.removeEventListener("hashchange", onHash); window.removeEventListener("popstate", onPop); controller.current = null; };
  }, []);
  const navigate = useCallback((area: string, sub?: string, id?: string, tab?: string, focus?: string) => {
    // Older area names (engines, Operations/…) are translated so every link lands in the current structure.
    const next = resolveRoute({ area, sub, id, tab, focus });
    const c = controller.current;
    // Moving to another place may drop unsaved work: the controller asks first. Re-selecting the current place is not leaving.
    if (!c) { setRoute(next); return; }
    if (c.navigate(routeHash(next))) window.scrollTo({ top: 0 });
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
    <header className="sticky top-0 z-20 flex items-center justify-between gap-3 border-b bg-white px-4 py-3"><div className="min-w-0"><p className="truncate font-semibold">{brand.companyName}</p><p className="text-xs text-slate-500">{role === "supervisor" ? "Supervisor" : "Field"}</p></div><div className="flex items-center gap-2"><NotificationCenter/><Link href="/account" className="flex min-h-11 items-center rounded-lg border px-3 text-sm" title={userEmail}>Account</Link></div></header>
    <Toaster position="top-center" richColors />
    <main className="p-4 sm:p-6">{tab === "today" ? <FieldToday /> : tab === "records" ? <FieldWorkspace /> : <SearchV1 />}</main>
    <nav aria-label="Field navigation" className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-3 border-t bg-white pb-[env(safe-area-inset-bottom)]">{([["today", "Today", Home], ["records", "Shift records", ClipboardList], ["search", "Search", Search]] as const).map(([k, label, Icon]) => <button key={k} onClick={() => setTab(k)} aria-current={tab === k ? "page" : undefined} className={`flex min-h-16 flex-col items-center justify-center gap-1 text-xs font-medium ${tab === k ? "text-orange-700" : "text-slate-500"}`}><Icon aria-hidden className="size-5" />{label}</button>)}</nav>
  </div>;
}

function WorkspaceShell() {
  const session = useSession();
  const { brand, userEmail, role } = session;
  const [open, setOpen] = useState(false);
  const { route, navigate } = useNav();
  const areas = navFor(session).map(toArea);
  const area = areas.find(a => a.key === route.area) ?? (route.area === "Search" ? null : areas[0]);
  const subs = area?.subs ?? [];
  const sub = subs.find(s => s.key === route.sub)?.key ?? subs.find(s => s.key === area?.defaultSub)?.key ?? subs[0]?.key;
  const [engine, setEngine] = useState<EngineKey>("Win Work");

  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") { event.preventDefault(); navigate("Search"); } };
    window.addEventListener("keydown", shortcut);
    return () => window.removeEventListener("keydown", shortcut);
  }, [navigate]);

  const go = (a: string, s?: string) => { navigate(a, s); setOpen(false); };
  const legacyNavigate = (label: NavLabel) => {
    const map: Partial<Record<NavLabel, [string, string?]>> = { Planning: ["Schedule", "Schedule"], Resources: ["Resources", "People"], Dockets: ["Commercial", "Dockets"], Field: ["Projects", "Projects"], Jobs: ["Projects", "Projects"], Delivery: ["Projects", "Projects"], Commercial: ["Commercial", "Commercial"], Compliance: ["IMS & HSEQ"], "IMS & Compliance": ["IMS & HSEQ"], Reports: ["Reports", "Reports"], Settings: ["Admin", "Settings"], "Admin/Settings": ["Admin", "Settings"], Opportunities: ["Pipeline", "Opportunities"], "Estimates & Quotes": ["Pipeline", "Estimates"] };
    const next = map[label] ?? ["Home"];
    navigate(next[0], next[1]);
  };

  // Desktop: a compact rail (icon + short caption), so the canvas owns the screen. Section tabs live in the page header, as in the reference.
  const rail = <div className="sticky top-0 flex h-dvh flex-col">
    <div className="flex h-[66px] shrink-0 items-center justify-center border-b border-[var(--gs-line)] text-[var(--gs-ink)]" title={brand.productName}><Mark /></div>
    <nav aria-label="Primary application areas" className="flex-1 overflow-y-auto py-2">{areas.map(a => { const Icon = a.icon; const current = area?.key === a.key; return <div key={a.key}>
      {a.key==="Admin"&&<div className="mx-4 my-2 border-t border-[var(--gs-line)]" role="presentation" />}
      <button aria-current={current ? "page" : undefined} onClick={() => go(a.key,a.defaultSub)} onPointerEnter={() => void a.preload().catch(() => {})} onFocus={() => void a.preload().catch(() => {})} className="gs-rail-btn" title={a.label}><Icon aria-hidden className="size-[19px]" strokeWidth={1.6} /><span className="max-w-full">{a.label}</span></button>
    </div>; })}</nav>
    <div className="shrink-0 border-t border-[var(--gs-line)] py-1"><button onClick={() => go("Search")} className="gs-rail-btn" aria-current={route.area === "Search" ? "page" : undefined} title="Search (Ctrl K)"><Search aria-hidden className="size-[19px]" strokeWidth={1.6} /><span>Search</span></button><Link href="/account" className="gs-rail-btn" title={role === "admin" ? "Account & team" : "Account"}><CircleUserRound aria-hidden className="size-[19px]" strokeWidth={1.6} /><span>Account</span></Link></div>
  </div>;
  // Phone navigation sheet: full labels, sections listed under the current area.
  const sidebar = <>
    <div className="flex h-[66px] items-center gap-3 border-b border-[var(--gs-line)] px-5"><span className="text-[var(--gs-ink)]"><Mark /></span><div className="min-w-0"><p className="gs-wordmark truncate">{brand.productName.toUpperCase()}</p><p className="mt-0.5 truncate text-[11px] tracking-[0.08em] text-slate-500">{brand.companyName}</p></div></div>
    <nav aria-label="Primary application areas" className="py-2">{areas.map(a => { const Icon = a.icon; const current = area?.key === a.key; return <div key={a.key}>
      {a.key==="Admin"&&<p className="gs-eyebrow mb-1 mt-4 px-5">System</p>}
      <button aria-current={current ? "page" : undefined} onClick={() => go(a.key,a.defaultSub)} className={`relative flex min-h-12 w-full items-center gap-3 px-5 text-left text-[15px] ${current ? "font-semibold text-[var(--gs-ink)] before:absolute before:inset-y-2 before:left-0 before:w-0.5 before:bg-[var(--gs-graphite)]" : "text-slate-600 hover:bg-[var(--gs-fog)]"}`}><Icon aria-hidden className="size-[19px]" strokeWidth={1.6} /><span className="min-w-0 flex-1 truncate">{a.label}</span></button>
      {current && a.subs && a.subs.length > 1 && <div className="mb-1 ml-[3.25rem] grid border-l border-[var(--gs-line)]">{a.subs.map(s => <button key={s.key} onClick={() => go(a.key, s.key)} className={`min-h-11 pl-4 text-left text-sm ${sub === s.key ? "font-semibold text-[var(--gs-ink)]" : "text-slate-500 hover:text-[var(--gs-ink)]"}`}>{s.label ?? s.key}</button>)}</div>}
    </div>; })}</nav>
    <div className="mt-auto border-t border-[var(--gs-line)] p-2"><button onClick={() => go("Search")} className="flex min-h-12 w-full items-center gap-3 px-3 text-left text-[15px] text-slate-600 hover:bg-[var(--gs-fog)]"><Search aria-hidden className="size-[19px]" strokeWidth={1.6} />Search</button><Link href="/account" className="flex min-h-12 items-center gap-3 px-3 text-[15px] text-slate-600 hover:bg-[var(--gs-fog)]"><CircleUserRound aria-hidden className="size-[19px]" strokeWidth={1.6} />{role === "admin" ? "Account & team" : "Account"}</Link></div>
  </>;

  let content: ReactNode = null;
  const k = route.area === "Search" ? "Search" : area?.key;
  const other = (types: string[]) => <OperationsPage key={types[0]} module="Resources" initialResource={types[0]} resourceTypes={types} onNavigate={legacyNavigate} />;
  if (k === "Search") content = <SearchV1 />;
  else if (k === "Home") content = <HomeV1 />;
  else if (k === "Today") content = <FieldToday />;
  else if (k === "CRM") content = <ClientsRegister key={route.id || "all"} initialQuery={route.id} />;
  else if (k === "Pipeline") content = sub === "Tenders" ? <TendersView /> : sub === "Planning" ? <Planning /> : sub === "Estimates" ? <EstimatesQuotes key={route.id || "all"} initialEstimateId={route.id} /> : <OpportunitiesView key={route.id || "all"} />;
  else if (k === "Projects") content = sub === "Programme" ? <Program /> : <ProjectsView />;
  else if (k === "Schedule") content = <JobsPlanning key={`schedule-${route.id || "all"}`} page="Planning" initialJobId={route.id} onBack={route.id ? () => navigate("Projects", "Projects", route.id) : undefined} />;
  else if (k === "Resources") content = sub === "Workshop" ? <Workshop /> : sub === "Crews" ? other(["crews"]) : sub === "Suppliers & Subcontractors" ? other(["suppliers", "subcontractors"]) : sub === "Depots" ? <DepotsArea /> : <ResourcesArea key={`${sub}-${route.id || ""}`} only initial={sub === "Plant & Equipment" ? "plant" : "workers"} initialQuery={route.id} />;
  else if (k === "Commercial") content = sub === "Dockets" ? <DocketDashboard /> : <CommercialArea />;
  else if (k === "IMS & HSEQ") content = <HseqArea />;
  else if (k === "Documents") content = sub === "Company Library" ? <LibraryArea /> : <DocumentsWorkspace key={route.id || "all-documents"} initialQuery={route.id} />;
  else if (k === "Reports") content = sub === "Lifecycle" ? <div className="grid gap-4"><div className="flex flex-wrap gap-2" role="group" aria-label="Lifecycle stage">{ENGINES.map(e => <button key={e.key} aria-pressed={engine === e.key} onClick={() => setEngine(e.key)} className={`rounded-lg border px-3 py-1.5 text-sm ${engine === e.key ? "border-slate-950 bg-slate-950 text-white" : "bg-white text-slate-600"}`}>{e.key}</button>)}</div><EngineOverview key={engine} engine={engine} /></div> : <ReportsV1 />;
  else if (k === "Admin") content = <AdminArea sub={sub || "Company"} onNavigate={() => {}} />;

  const preferredMobile = ["Home", "Today", "Projects", "Schedule", "Pipeline", "IMS & HSEQ", "Commercial", "Resources", "CRM"];
  const mobile = preferredMobile.map(key => areas.find(a => a.key === key)).filter((a): a is Area => Boolean(a)).slice(0, 4);
  const detailOpen = Boolean(route.id && ((k === "Pipeline" && sub === "Tenders") || (k === "Projects" && sub === "Projects")));
  return <div className="app-shell min-h-screen bg-[var(--gs-ivory)] text-slate-900">
    <a href="#main-content" className="skip-link sr-only focus:not-sr-only">Skip to content</a>
    <nav aria-label="Quick navigation" className="mobile-quick-nav fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 pb-[env(safe-area-inset-bottom)] lg:hidden">{mobile.map(a => { const Icon = a.icon; const current=area?.key === a.key; return <button key={a.key} onClick={() => go(a.key)} aria-current={current ? "page" : undefined} className={`relative flex min-h-[3.75rem] flex-col items-center justify-center gap-1 px-1 text-[11px] ${current ? "font-semibold text-[var(--gs-ink)] before:absolute before:inset-x-3 before:top-0 before:h-0.5 before:bg-[var(--gs-graphite)]" : "text-slate-500"}`}><Icon aria-hidden className="size-5" strokeWidth={1.6} />{a.label}</button>; })}<button className="flex min-h-[3.75rem] flex-col items-center justify-center gap-1 px-1 text-[11px] text-slate-500" onClick={() => setOpen(true)}><Menu aria-hidden className="size-5" strokeWidth={1.6} />More</button></nav>
    <Toaster position="top-right" richColors />
    <div className="flex min-h-screen">
      <aside className="gs-rail hidden shrink-0 border-r border-[var(--gs-line)] bg-[var(--gs-ivory)] lg:block" aria-label="Application navigation">{rail}</aside>
      <Sheet open={open} onOpenChange={setOpen}><SheetContent side="left" className="w-[min(88vw,320px)] overflow-y-auto border-r border-[var(--gs-line)] bg-[var(--gs-ivory)] p-0 text-slate-900"><SheetTitle className="sr-only">Navigation</SheetTitle><SheetDescription className="sr-only">Choose a work area</SheetDescription><div className="flex min-h-full flex-col">{sidebar}</div></SheetContent></Sheet>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="workspace-topbar sticky top-0 z-20 flex h-[66px] items-center justify-between gap-3 border-b border-[var(--gs-line)] bg-[var(--gs-ivory)] px-3 sm:px-8">
          <div className="flex min-w-0 items-center gap-3"><button className="flex size-11 shrink-0 items-center justify-center border border-[var(--gs-line-strong)] lg:hidden" onClick={() => setOpen(true)} aria-label="Open navigation"><Menu className="size-5" strokeWidth={1.6}/></button><p className="gs-wordmark hidden shrink-0 sm:block">{brand.productName.toUpperCase()}</p><span className="hidden h-4 w-px shrink-0 bg-[var(--gs-line-strong)] sm:block" aria-hidden /><p className="gs-crumb min-w-0 truncate">{k === "Search" ? "Search" : area?.label}{sub && <span className="hidden sm:inline"> / {subs.find(x => x.key === sub)?.label ?? sub}</span>}</p></div>
          <div className="flex items-center gap-2 sm:gap-4"><p className="hidden text-[13px] text-slate-600 md:block" suppressHydrationWarning>{todayText()}</p><button onClick={() => navigate("Search")} className="flex size-11 items-center justify-center border border-[var(--gs-line-strong)] text-slate-600 hover:border-[var(--gs-graphite)] md:w-auto md:gap-3 md:px-4" aria-label="Search"><Search aria-hidden className="size-4" strokeWidth={1.7} /><span className="hidden text-[13px] md:inline">Search your workspace</span><kbd className="hidden border border-[var(--gs-line)] px-1.5 py-0.5 text-[10px] text-slate-500 lg:inline">Ctrl K</kbd></button><NotificationCenter/><Link href="/account" title={userEmail || "Account"} aria-label="Account" className="flex size-11 items-center justify-center rounded-full bg-[var(--gs-fog)] text-xs font-semibold tracking-wide text-[var(--gs-ink)] hover:bg-[var(--gs-select)]">{userEmail ? userEmail.slice(0, 2).toUpperCase() : <CircleUserRound className="size-5" />}</Link></div>
        </header>
        <main id="main-content" tabIndex={-1} className="mx-auto w-full min-w-0 max-w-[1600px] flex-1 px-4 pb-28 pt-6 outline-none sm:px-8 sm:pb-28 lg:px-10 lg:pb-12 lg:pt-8">
          {subs.length > 1 && !detailOpen && <nav aria-label={`${area?.label} sections`} className="workspace-tabs gs-tabs mb-7 min-w-0">{subs.map(s => <button key={s.key} aria-current={sub === s.key ? "page" : undefined} onClick={() => go(area!.key, s.key)} className="gs-tab">{s.label ?? s.key}</button>)}</nav>}
          {areas.length === 1 && k === "Home" && <p className="gs-note mb-4">No modules are enabled for your role or organisation. Contact an administrator.</p>}
          {content}
        </main>
      </div>
    </div>
  </div>;
}

function LibraryArea() {
  const { route } = useNav();
  const { can } = useSession();
  const [tab, setTab] = useState<"items" | "responses">("items");
  // Library items keep the expiry focus and IMS draft assist that lived under Admin.
  return <div><Tabs label="Company library" active={tab} onChange={setTab} tabs={[{ key: "items", label: "Library items" }, { key: "responses", label: "Responses, templates & plans", hidden: !can("project.edit") && !can("library.edit") }]} />{tab === "items" ? <AdminArea sub="Company Library" initialQuery={route.id} onNavigate={() => {}} /> : <PreparationWorkspace scope="company" />}</div>;
}
const ClientsRegister = dynamic(() => import("@/components/v1/clients").then(m => m.ClientsArea), { loading });
