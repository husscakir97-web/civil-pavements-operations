"use client";

import { useEffect, useMemo, useState } from "react";
import dynamic from 'next/dynamic';
import Link from 'next/link';
import {
  ArrowRight,
  CalendarDays,
  CheckCheck,
  ChevronRight,
  CircleUserRound,
  FileCheck2,
  BarChart3,
  BriefcaseBusiness,
  Building2,
  DollarSign,
  HardHat,
  Home,
  Menu,
  Search,
  Settings,
  ShieldCheck,
  Workflow,
  type LucideIcon,
} from "lucide-react";

import type { NavLabel } from "@/components/operations-workspace";
import { LiveReport, useLiveReport } from "@/components/live-report";
import { Toaster } from "@/components/ui/sonner";
import { Sheet, SheetContent, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { WorkspaceBrandProvider, useWorkspaceBrand } from "@/components/workspace-brand";
const loading = () => <div role="status" className="workspace-placeholder"><span className="sr-only">Loading workspace…</span><div className="h-7 w-52 rounded bg-slate-200/70"/><div className="mt-3 h-4 w-72 max-w-full rounded bg-slate-200/50"/><div className="mt-8 grid gap-4 sm:grid-cols-3">{[0,1,2].map(i=><div key={i} className="h-28 rounded-xl border bg-white"/>)}</div><div className="mt-5 h-64 rounded-xl border bg-white"/></div>;
const loadDockets = () => import('@/components/docket-dashboard');
const loadEstimates = () => import('@/components/estimates-quotes');
const loadOperations = () => import('@/components/operations-workspace');
const loadField = () => import('@/components/field-workspace');
const loadCommercial = () => import('@/components/commercial-workspace');
const loadProjects = () => import('@/components/job-hub');
const loadPipeline = () => import('@/components/pipeline-workspace');
const loadPreparation = () => import('@/components/preparation-workspace');
const loadIMS = () => import('@/components/ims-workspace');
const loadSearch = () => import('@/components/universal-search');
const DocketDashboard = dynamic(() => loadDockets().then(m => m.DocketDashboard), {loading});
const EstimatesQuotes = dynamic(() => loadEstimates().then(m => m.EstimatesQuotes), {loading});
const OperationsPage = dynamic(() => loadOperations().then(m => m.OperationsPage), {loading});
const FieldWorkspace = dynamic(() => loadField().then(m => m.FieldWorkspace), {loading});
const CommercialWorkspace = dynamic(() => loadCommercial().then(m => m.CommercialWorkspace), {loading});
const JobHub = dynamic(() => loadProjects().then(m => m.JobHub), {loading});
const UniversalSearch = dynamic(() => loadSearch().then(m => m.UniversalSearch), {loading});
const PipelineWorkspace = dynamic(() => loadPipeline().then(m => m.PipelineWorkspace), {loading});
const PreparationWorkspace = dynamic(() => loadPreparation().then(m => m.PreparationWorkspace), {loading});
const IMSWorkspace = dynamic(() => loadIMS().then(m => m.IMSWorkspace), {loading});

function preloadArea(area: string, subview?: string) {
  const loader = area === 'Pipeline' ? (subview === 'Estimates' ? loadEstimates : loadPipeline)
    : area === 'Search' ? loadSearch : area === 'Projects' ? loadProjects : area === 'Commercial' ? loadCommercial
    : area === 'IMS & HSEQ' ? loadIMS : area === 'Admin' ? (subview === 'Settings' ? loadOperations : loadPreparation)
    : area === 'Operations' ? (subview === 'Dockets' ? loadDockets : subview === 'Field' ? loadField : loadOperations) : null;
  if (loader) void loader().catch(() => {});
}

type AppArea =
  | "Home"
  | "Pipeline"
  | "Projects"
  | "Operations"
  | "Commercial"
  | "IMS & HSEQ"
  | "Reports"
  | "Admin"
  | "Search";

type Subview =
  | "Opportunities"
  | "Tenders"
  | "Estimates"
  | "Schedule"
  | "Resources"
  | "Dockets"
  | "Field"
  | "Company Library"
  | "Settings";

const primaryNav: Array<[Exclude<AppArea, "Search">, LucideIcon]> = [
  ["Home", Home],
  ["Pipeline", BriefcaseBusiness],
  ["Projects", HardHat],
  ["Operations", Workflow],
  ["Commercial", DollarSign],
  ["IMS & HSEQ", ShieldCheck],
  ["Reports", BarChart3],
  ["Admin", Settings],
];

const subviews: Partial<Record<AppArea, Subview[]>> = {
  Pipeline: ["Opportunities", "Tenders", "Estimates"],
  Operations: ["Schedule", "Resources", "Dockets", "Field"],
  Admin: ["Company Library", "Settings"],
};

const defaults: Partial<Record<AppArea, Subview>> = {
  Pipeline: "Opportunities",
  Operations: "Schedule",
  Admin: "Company Library",
};

function parseHash(): { area: AppArea; subview?: Subview } {
  if (typeof window === "undefined") return { area: "Home" };
  const raw = decodeURIComponent(window.location.hash.slice(1));
  if (!raw) return { area: "Home" };
  const [areaRaw, subviewRaw] = raw.split("/");
  const allAreas: AppArea[] = ["Home", "Pipeline", "Projects", "Operations", "Commercial", "IMS & HSEQ", "Reports", "Admin", "Search"];
  const area = allAreas.includes(areaRaw as AppArea) ? (areaRaw as AppArea) : "Home";
  const allowed = subviews[area] ?? [];
  const subview = allowed.includes(subviewRaw as Subview) ? (subviewRaw as Subview) : defaults[area];
  return { area, subview };
}

export function PavementOS() {
  return (
    <WorkspaceBrandProvider>
      <WorkspaceShell />
    </WorkspaceBrandProvider>
  );
}

function WorkspaceShell() {
  const { brand, userEmail, role } = useWorkspaceBrand();
  const initial = useMemo(() => ({ area: "Home" as AppArea, subview: undefined as Subview | undefined }), []);
  const [area, setArea] = useState<AppArea>(initial.area);
  const [subview, setSubview] = useState<Subview | undefined>(initial.subview);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const restore = () => {
      if(window.location.hash==='#main-content')return;
      try {
        const next = parseHash();
        setArea(next.area);
        setSubview(next.subview);
      } catch {
        setArea("Home");
        setSubview(undefined);
      }
    };
    restore();
    window.addEventListener("hashchange", restore);
    return () => window.removeEventListener("hashchange", restore);
  }, []);

  useEffect(()=>{
    const searchShortcut=(event:KeyboardEvent)=>{
      if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='k'){
        event.preventDefault();preloadArea('Search');setArea('Search');setSubview(undefined);setOpen(false);
        document.getElementById('workspace-search')?.focus();
        if(window.location.hash!=='#Search')window.history.pushState(null,'','#Search');
      }
    };
    window.addEventListener('keydown',searchShortcut);
    return()=>window.removeEventListener('keydown',searchShortcut);
  },[]);

  const report = useLiveReport();
  const homeActions = useMemo(() => {
    const s = report.summary;
    if (!s) return [] as Array<{title:string;detail:string;area:AppArea;subview?:Subview}>;
    const r = role.toLowerCase();
    const admin = r.includes("owner") || r === "admin" || r.includes("admin");
    const commercial = r === "office" || r.includes("commercial") || r.includes("estimator") || r.includes("accounts");
    const delivery = r === "office" || r === "field" || r.includes("project manager") || r.includes("supervisor") || r.includes("operations") || r.includes("scheduler");
    const hseq = r.includes("hseq") || r.includes("safety") || r.includes("quality");
    const actions:Array<{title:string;detail:string;area:AppArea;subview?:Subview;show:boolean}> = [
      {title:"Review active pipeline",detail:s.openOpportunities+" open opportunit"+(s.openOpportunities===1?"y":"ies"),area:"Pipeline",subview:"Opportunities",show:s.openOpportunities>0&&(admin||commercial)},
      {title:"Review upcoming shifts",detail:s.upcomingShifts+" upcoming shift"+(s.upcomingShifts===1?"":"s"),area:"Operations",subview:"Schedule",show:s.upcomingShifts>0&&(admin||delivery)},
      {title:"Resolve docket review queue",detail:s.reviewCount+" docket"+(s.reviewCount===1?"":"s")+" need review",area:"Operations",subview:"Dockets",show:s.reviewCount>0&&(admin||delivery||commercial)},
      {title:"Review potential / unapproved variations",detail:s.unapprovedVariations+" variation"+(s.unapprovedVariations===1?"":"s")+" require attention",area:"Commercial",show:s.unapprovedVariations>0&&(admin||commercial||delivery)},
      {title:"Review unbilled completed work",detail:new Intl.NumberFormat("en-AU",{style:"currency",currency:"AUD",maximumFractionDigits:0}).format(s.unbilledValue)+" currently unbilled",area:"Commercial",show:s.unbilledValue>0&&(admin||commercial)},
      {title:"Resolve QA / HSEQ actions",detail:s.openQA+" open QA / HSEQ record"+(s.openQA===1?"":"s"),area:"IMS & HSEQ",show:s.openQA>0&&(admin||delivery||hseq)},
      {title:"Review worker compliance",detail:s.expiredWorkers+" worker record"+(s.expiredWorkers===1?"":"s")+" with expired evidence",area:"Operations",subview:"Resources",show:s.expiredWorkers>0&&(admin||delivery||hseq)},
      {title:"Review unavailable plant",detail:s.unavailablePlant+" plant item"+(s.unavailablePlant===1?"":"s")+" unavailable, overdue or in maintenance",area:"Operations",subview:"Resources",show:s.unavailablePlant>0&&(admin||delivery)},
    ];
    return actions.filter(action=>action.show).map(action=>({title:action.title,detail:action.detail,area:action.area,subview:action.subview}));
  }, [report.summary, role]);

  function navigate(nextArea: AppArea, nextSubview?: Subview) {
    const resolvedSubview = nextSubview ?? defaults[nextArea];
    setArea(nextArea);
    setSubview(resolvedSubview);
    const hash = resolvedSubview ? `${nextArea}/${resolvedSubview}` : nextArea;
    if (window.location.hash.slice(1) !== encodeURIComponent(hash)) {
      window.history.pushState(null, "", `#${encodeURIComponent(hash)}`);
    }
    window.scrollTo({ top: 0 });
    setOpen(false);
  }

  function navigateLegacy(label: NavLabel) {
    const map: Partial<Record<NavLabel, [AppArea, Subview?]>> = {
      Today: ["Home"],
      Overview: ["Home"],
      Pipeline: ["Pipeline", "Opportunities"],
      Opportunities: ["Pipeline", "Opportunities"],
      "Tender Review": ["Pipeline", "Tenders"],
      "Estimates & Quotes": ["Pipeline", "Estimates"],
      Delivery: ["Projects"],
      Jobs: ["Projects"],
      Planning: ["Operations", "Schedule"],
      Resources: ["Operations", "Resources"],
      Dockets: ["Operations", "Dockets"],
      Field: ["Operations", "Field"],
      Commercial: ["Commercial"],
      Variations: ["Commercial"],
      Claims: ["Commercial"],
      Compliance: ["IMS & HSEQ"],
      "IMS & Compliance": ["IMS & HSEQ"],
      "QA & Safety": ["IMS & HSEQ"],
      Insights: ["Reports"],
      Reports: ["Reports"],
      Search: ["Search"],
      Preparation: ["Admin", "Company Library"],
      "Admin/Settings": ["Admin", "Settings"],
      Settings: ["Admin", "Settings"],
    };
    const next = map[label] ?? ["Home"];
    navigate(next[0], next[1]);
  }

  const visiblePrimaryNav = useMemo(() => {
    const r=role.toLowerCase();
    const isAdmin=r.includes('owner')||r.includes('admin');
    const field=r==='field'||r.includes('field worker')||r.includes('supervisor');
    const accounts=r.includes('accounts');
    const hseq=r.includes('hseq')||r.includes('safety')||r.includes('quality');
    const operations=r.includes('operations')||r.includes('scheduler');
    const commercial=r.includes('commercial')||r.includes('estimator');
    const allowed = isAdmin ? null :
      field ? new Set<AppArea>(['Home','Projects','Operations','IMS & HSEQ']) :
      accounts ? new Set<AppArea>(['Home','Commercial','Reports']) :
      hseq ? new Set<AppArea>(['Home','Projects','IMS & HSEQ','Reports']) :
      operations ? new Set<AppArea>(['Home','Projects','Operations','IMS & HSEQ','Reports']) :
      commercial ? new Set<AppArea>(['Home','Pipeline','Projects','Commercial','Reports']) :
      new Set<AppArea>(['Home','Pipeline','Projects','Operations','Commercial','IMS & HSEQ','Reports']);
    return primaryNav.filter(([label])=>!allowed||allowed.has(label));
  },[role]);
  const mobileAreas=visiblePrimaryNav.map(([label])=>label).filter(label=>!['Admin','Reports'].includes(label)).slice(0,4);

  const navigation = (
    <>
      <div className="flex h-20 items-center px-5">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary">
            <Building2 className="size-5" />
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold tracking-tight" title={brand.productName}>{brand.productName}</p>
            <p className="mt-0.5 truncate text-xs text-slate-400" title={brand.companyName}>{brand.companyName}</p>
          </div>
        </div>
      </div>
      <p className="px-6 pb-2 pt-5 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">Workspace</p>
      <nav aria-label="Primary application areas" className="space-y-1 px-3 pb-5">
        {visiblePrimaryNav.map(([label, Icon]) => (
          <button
            key={label}
            aria-current={area === label ? "page" : undefined}
            onClick={() => navigate(label)}
            onPointerEnter={() => preloadArea(label)}
            onFocus={() => preloadArea(label)}
            className={`sidebar-item flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left text-sm font-medium transition-colors ${area === label ? "bg-white/10 text-white" : "text-slate-400 hover:bg-white/5 hover:text-white"}`}
          >
            <Icon aria-hidden="true" className={`size-[18px] ${area===label?'text-orange-400':''}`} />
            {label}
            {label === "Operations" && (
              <span className="ml-auto min-w-5 rounded-md bg-white/10 px-1.5 py-0.5 text-center text-[10px] text-slate-200" aria-label="Dockets needing review">
                {report.error ? "!" : report.summary?.reviewCount ?? "…"}
              </span>
            )}
          </button>
        ))}
      </nav>
      <div className="border-t border-white/10 p-3">
        <button onPointerEnter={()=>preloadArea('Search')} onFocus={()=>preloadArea('Search')} onClick={() => navigate("Search")} className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-medium text-slate-400 hover:bg-white/10 hover:text-white">
          <Search className="size-4" /> Global search
        </button>
      </div>
      <div className="mt-auto p-4 text-xs text-slate-400">
        <div className="rounded-xl border border-white/10 p-3"><p className="font-medium text-slate-200">{brand.workspaceName}</p><p className="mt-1">Your company workspace</p></div>
      </div>
    </>
  );

  const areaSubviews = subviews[area] ?? [];
  const activeSubview = subview ?? defaults[area];

  return (
    <div className="app-shell min-h-screen bg-[#f6f7f9] text-slate-900">
      <a href="#main-content" className="skip-link sr-only focus:not-sr-only">Skip to content</a>
      <nav aria-label="Quick navigation" className="mobile-quick-nav fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t bg-white lg:hidden">
        {mobileAreas.map(label => {const Icon=primaryNav.find(([name])=>name===label)![1];return (
          <button key={label} onClick={() => navigate(label)} aria-current={area === label ? "page" : undefined} className={`flex min-h-16 flex-col items-center justify-center gap-1 px-1 text-[10px] font-medium sm:text-xs ${area === label ? "text-orange-700" : "text-slate-500"}`}>
            <Icon aria-hidden="true" className="size-5"/>{label}
          </button>
        );})}
        <button className="flex min-h-16 flex-col items-center justify-center gap-1 text-[10px] font-medium text-slate-500" onClick={() => setOpen(true)}><Menu aria-hidden="true" className="size-5"/>More</button>
      </nav>

      <Toaster position="top-right" richColors />
      <div className="flex min-h-screen">
        <aside className="hidden w-64 shrink-0 bg-[#111c27] text-white lg:block">
          <div className="sticky top-0 flex h-dvh flex-col overflow-y-auto">{navigation}</div>
        </aside>

        <Sheet open={open} onOpenChange={setOpen}>
          <SheetContent side="left" className="w-[min(90vw,320px)] overflow-y-auto border-0 bg-[#101a24] p-0 text-white">
            <SheetTitle className="sr-only">Navigation</SheetTitle>
            <SheetDescription className="sr-only">Choose a work area</SheetDescription>
            {navigation}
          </SheetContent>
        </Sheet>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-20 flex min-h-[72px] items-center justify-between gap-3 border-b bg-white px-4 sm:px-8">
            <div className="flex min-w-0 items-center">
              <button className="flex size-11 shrink-0 items-center justify-center lg:hidden" onClick={() => setOpen(true)} aria-label="Open navigation"><Menu /></button>
              <div className="ml-3 min-w-0 lg:ml-0">
                <p className="flex items-center gap-2 truncate text-sm font-semibold text-slate-800">
                  {area}{activeSubview && <><ChevronRight aria-hidden="true" className="size-3.5 shrink-0 text-slate-400"/><span className="truncate font-normal text-slate-500">{activeSubview}</span></>}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button onPointerEnter={()=>preloadArea('Search')} onFocus={()=>preloadArea('Search')} onClick={() => navigate("Search")} className="flex h-10 items-center gap-3 rounded-lg border bg-slate-50 px-3 text-sm text-slate-500 hover:border-slate-300 hover:bg-white" aria-label="Global search"><Search aria-hidden="true" className="size-4" /><span className="hidden md:inline">Search your workspace</span><kbd className="ml-5 hidden rounded border bg-white px-1.5 py-0.5 text-[10px] lg:inline">Ctrl K</kbd></button>
              <Link href="/account" title={userEmail||'Account & team'} aria-label="Account & team" className="ml-2 flex size-10 items-center justify-center rounded-full border border-slate-200 bg-slate-100 text-xs font-semibold text-slate-700 hover:border-primary">{userEmail?userEmail.slice(0,2).toUpperCase():<CircleUserRound className="size-5"/>}</Link>
            </div>
          </header>

          <main id="main-content" tabIndex={-1} className="mx-auto w-full min-w-0 max-w-[1600px] flex-1 p-4 pb-24 outline-none sm:p-6 sm:pb-24 lg:p-8">
            {areaSubviews.length > 0 && (
              <nav aria-label={`${area} workspace sections`} className="workspace-tabs mb-6 flex min-w-0 gap-1 overflow-x-auto border-b">
                {areaSubviews.map(item => (
                  <button key={item} aria-current={activeSubview===item?'page':undefined} onPointerEnter={() => preloadArea(area,item)} onFocus={() => preloadArea(area,item)} onClick={() => navigate(area, item)} className={`shrink-0 border-b-2 px-4 pb-3 pt-1 text-sm transition-colors ${activeSubview === item ? "border-primary font-semibold text-slate-900" : "border-transparent text-slate-500 hover:text-slate-900"}`}>
                    {item}
                  </button>
                ))}
              </nav>
            )}

            {area === "Home" && <div className="space-y-7">
              <div className="flex flex-wrap items-end justify-between gap-5">
                <div><p className="mb-2 text-xs font-medium text-slate-500">{new Intl.DateTimeFormat('en-AU',{timeZone:'Australia/Sydney',dateStyle:'full'}).format(new Date())}</p><h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Your operations, at a glance.</h1><p className="mt-2 text-sm text-slate-500">Keep work moving. See what needs your attention today.</p></div>
                <div className="flex flex-wrap gap-2"><button onPointerEnter={()=>preloadArea('Operations','Schedule')} onFocus={()=>preloadArea('Operations','Schedule')} onClick={()=>navigate('Operations','Schedule')} className="quick-action"><CalendarDays aria-hidden="true" className="size-4"/>Open schedule</button><button onPointerEnter={()=>preloadArea('Operations','Dockets')} onFocus={()=>preloadArea('Operations','Dockets')} onClick={()=>navigate('Operations','Dockets')} className="quick-action quick-action-primary"><FileCheck2 aria-hidden="true" className="size-4"/>Review dockets</button></div>
              </div>
              <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
                <LiveReport {...report} overview />
                <section className="surface overflow-hidden">
                  <div className="flex items-center justify-between border-b px-5 py-4"><div><h2 className="font-semibold">Needs attention</h2><p className="mt-1 text-xs text-slate-500">Your next actions</p></div><span className="rounded-full bg-orange-50 px-2.5 py-1 text-xs font-semibold text-orange-800">{report.error?'!':report.summary?homeActions.length:'…'}</span></div>
                  {report.error?<p role="alert" className="p-5 text-sm text-red-700">Actions could not be refreshed. Use Refresh to try again.</p>:!report.summary?<p role="status" className="p-5 text-sm text-slate-500">Loading your actions…</p>:homeActions.length?<div className="divide-y">{homeActions.map(action=><button key={action.title} onPointerEnter={()=>preloadArea(action.area,action.subview)} onFocus={()=>preloadArea(action.area,action.subview)} onClick={()=>navigate(action.area,action.subview)} className="group flex w-full items-center gap-4 p-5 text-left transition-colors hover:bg-slate-50"><span className="min-w-0 flex-1"><span className="block text-sm font-medium leading-5">{action.title}</span><span className="mt-1.5 block text-xs text-slate-500">{action.detail}</span></span><ArrowRight aria-hidden="true" className="size-4 shrink-0 text-slate-400 group-hover:text-primary"/></button>)}</div>:<div className="p-6"><CheckCheck aria-hidden="true" className="mb-3 size-6 text-emerald-600"/><p className="text-sm font-medium">You’re up to date</p><p className="mt-1 text-xs leading-5 text-slate-500">No priority actions in your current dashboard. Your workspaces are ready when you need them.</p></div>}
                  <div className="border-t bg-slate-50/60 px-5 py-3 text-xs text-slate-500">{role==='read-only'?'Your workspace':`${role.charAt(0).toUpperCase()+role.slice(1)} workspace`} · {brand.workspaceName}</div>
                </section>
              </div>
            </div>}
            {area === "Pipeline" && activeSubview === "Opportunities" && <PipelineWorkspace mode="pipeline" onOpenTender={()=>navigate("Pipeline","Tenders")} />}
            {area === "Pipeline" && activeSubview === "Tenders" && <PipelineWorkspace mode="tenders" />}
            {area === "Pipeline" && activeSubview === "Estimates" && <EstimatesQuotes />}
            {area === "Projects" && <JobHub onNavigate={navigateLegacy} />}
            {area === "Operations" && activeSubview === "Schedule" && <OperationsPage key="operations-schedule" module="Planning" onNavigate={navigateLegacy} />}
            {area === "Operations" && activeSubview === "Resources" && <OperationsPage key="operations-resources" module="Resources" onNavigate={navigateLegacy} />}
            {area === "Operations" && activeSubview === "Dockets" && <DocketDashboard />}
            {area === "Operations" && activeSubview === "Field" && <FieldWorkspace />}
            {area === "Commercial" && <CommercialWorkspace />}
            {area === "IMS & HSEQ" && <IMSWorkspace onNavigate={label => navigateLegacy(label as NavLabel)} />}
            {area === "Reports" && <LiveReport {...report} overview={false} />}
            {area === "Admin" && activeSubview === "Company Library" && <PreparationWorkspace scope="company" />}
            {area === "Admin" && activeSubview === "Settings" && <OperationsPage key="admin-settings" module="Settings" onNavigate={navigateLegacy} />}
            {area === "Search" && <UniversalSearch />}
          </main>
        </div>
      </div>
    </div>
  );
}
