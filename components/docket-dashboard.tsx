"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowDownToLine,
  CalendarDays,
  Check,
  ChevronRight,
  CircleDollarSign,
  Clock3,
  FileSearch,
  FileText,
  Filter,
  LoaderCircle,
  Pencil,
  ScanLine,
  Search,
  Sparkles,
  Trash2,
  UploadCloud,
  Users,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Progress } from "@/components/ui/progress";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { Toaster } from "@/components/ui/sonner";
import {loadPdfReader,loadTesseract,type OcrWorker} from '@/lib/document-readers';
import {PaidAiScan} from '@/components/paid-ai-scan';
import {
  parseDocket,
  parseDocketPage,
  docketCandidateScore,
  type DocketCandidate,
  splitDocketText,
  type DocketRecord as Docket,
  type DocketStatus,
} from "@/lib/docket-parser";

type PendingFile = {
  id: string;
  file: File;
  progress: number;
  state: "queued" | "reading" | "saving" | "done" | "error";
  message?: string;
  docketCount?: number;
};

const money = new Intl.NumberFormat("en-AU", {
  style: "currency", currency: "AUD", maximumFractionDigits: 0,
});
const decimal = new Intl.NumberFormat("en-AU", { maximumFractionDigits: 1 });

function monthTitle(value: string) {
  const [year, month] = value.split("-").map(Number);
  return new Intl.DateTimeFormat("en-AU", { month: "long", year: "numeric" })
    .format(new Date(year, month - 1, 1));
}

function displayDate(value: string) {
  if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(value)) return value || "—";
  return new Intl.DateTimeFormat("en-AU", { day: "2-digit", month: "short" })
    .format(new Date(`${value}T00:00:00`));
}

function statusLabel(status: DocketStatus) {
  const labels: Record<string,string> = { ready:"Ready", uploaded:"Uploaded", processing:"Processing", review:"Needs review", matched:"Matched", approved:"Approved", included_claim:"Included in claim", invoiced:"Invoiced", rejected:"Rejected", duplicate:"Duplicate" };
  return labels[status] || "Needs review";
}

function StatusBadge({ status }: { status: DocketStatus }) {
  const styles = status === "ready"
    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
    : status === "duplicate"
      ? "border-red-200 bg-red-50 text-red-700"
      : "border-amber-200 bg-amber-50 text-amber-800";
  return (
    <Badge variant="outline" className={`rounded-md px-2 py-1 font-semibold ${styles}`}>
      {statusLabel(status)}
    </Badge>
  );
}

type OcrPage = {
  text: string;
  candidates?: DocketCandidate[];
  confidence: number;
  pageNumber: number;
  pageCount: number;
};

function prepareOcrCanvas(source: HTMLCanvasElement, mode: "normalised" | "binary") {
  const canvas = document.createElement("canvas");
  canvas.width = source.width;
  canvas.height = source.height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return source;
  context.fillStyle = "white";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(source, 0, 0);
  const image = context.getImageData(0, 0, canvas.width, canvas.height);
  const data = image.data;
  const histogram = new Uint32Array(256);
  for (let index = 0; index < data.length; index += 4) {
    const grey = Math.round(data[index] * 0.299 + data[index + 1] * 0.587 + data[index + 2] * 0.114);
    histogram[grey] += 1;
  }
  const pixels = canvas.width * canvas.height;
  const percentile = (target: number) => {
    let count = 0;
    for (let value = 0; value < histogram.length; value += 1) {
      count += histogram[value];
      if (count >= target) return value;
    }
    return 255;
  };
  const blackPoint = percentile(pixels * 0.015);
  const whitePoint = percentile(pixels * 0.985);
  const range = Math.max(35, whitePoint - blackPoint);
  const blockSize = 40;
  const columns = Math.ceil(canvas.width / blockSize);
  const rows = Math.ceil(canvas.height / blockSize);
  const blockTotals = new Float64Array(columns * rows);
  const blockCounts = new Uint32Array(columns * rows);

  for (let y = 0; y < canvas.height; y += 1) {
    for (let x = 0; x < canvas.width; x += 1) {
      const index = (y * canvas.width + x) * 4;
      const grey = data[index] * 0.299 + data[index + 1] * 0.587 + data[index + 2] * 0.114;
      const normalised = Math.max(0, Math.min(255, ((grey - blackPoint) * 255) / range));
      data[index] = normalised;
      data[index + 1] = normalised;
      data[index + 2] = normalised;
      const block = Math.floor(y / blockSize) * columns + Math.floor(x / blockSize);
      blockTotals[block] += normalised;
      blockCounts[block] += 1;
    }
  }

  if (mode === "binary") {
    for (let y = 0; y < canvas.height; y += 1) {
      for (let x = 0; x < canvas.width; x += 1) {
        const index = (y * canvas.width + x) * 4;
        const block = Math.floor(y / blockSize) * columns + Math.floor(x / blockSize);
        const localAverage = blockTotals[block] / Math.max(1, blockCounts[block]);
        const threshold = Math.max(115, Math.min(225, localAverage - 18));
        const value = data[index] < threshold ? 0 : 255;
        data[index] = value;
        data[index + 1] = value;
        data[index + 2] = value;
      }
    }
  }
  context.putImageData(image, 0, 0);
  return canvas;
}

function ocrTextScore(text: string, confidence: number) {
  const compact = text.replace(/\s/g, "");
  if (!compact) return 0;
  const alphanumeric = compact.match(/[a-z0-9]/gi)?.length ?? 0;
  const suspicious = compact.match(/[^a-z0-9.,:/()$%+\-]/gi)?.length ?? 0;
  const usefulLabels = text.match(
    /docket|date|order|contractor|client|customer|project|job location|rego|start|finish|hours|quantity|total|signature/gi,
  )?.length ?? 0;
  const words = text.match(/\b[a-z]{3,}\b/gi)?.length ?? 0;
  return confidence * 0.52
    + (alphanumeric / compact.length) * 28
    + Math.min(14, usefulLabels) * 1.8
    + Math.min(30, words) * 0.25
    - (suspicious / compact.length) * 45;
}

async function recogniseDocketCanvas(
  worker: OcrWorker,
  source: HTMLCanvasElement,
  onProgress: (progress: number, message: string) => void,
) {
  const passes: Array<{ mode: "original" | "normalised" | "binary"; pageMode: string; label: string }> = [
    { mode: "original", pageMode: "11", label: "Reading original image" },
    { mode: "normalised", pageMode: "6", label: "Reading form layout" },
    { mode: "binary", pageMode: "11", label: "Checking faint fields" },
  ];
  const results: Array<{ text: string; confidence: number; score: number }> = [];
  for (const [index, pass] of passes.entries()) {
    await worker.setParameters({
      preserve_interword_spaces: "1",
      user_defined_dpi: "300",
      tessedit_pageseg_mode: pass.pageMode,
    });
    const canvas = pass.mode==='original'?source:prepareOcrCanvas(source, pass.mode);
    onProgress(index / passes.length, pass.label);
    const result = await worker.recognize(canvas, { rotateAuto: true });
    results.push({
      text: result.data.text,
      confidence: result.data.confidence,
      score: docketCandidateScore(result.data) + ocrTextScore(result.data.text, result.data.confidence)*0.05,
    });
    onProgress((index + 1) / passes.length, pass.label);
  }
  return {...results.sort((a, b) => b.score - a.score)[0],candidates:results};
}

async function imageToCanvas(file: File) {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  const longest = Math.max(bitmap.width, bitmap.height);
  const scale = Math.min(3.5, 3400 / longest);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("The image could not be prepared.");
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.fillStyle='white';
  context.fillRect(0,0,canvas.width,canvas.height);
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas;
}

function textFromPdfItems(items: Array<{ str?: string; transform?: number[] }>) {
  const positioned = items
    .filter((item) => item.str?.trim())
    .map((item) => ({
      text: item.str!.trim(),
      x: item.transform?.[4] ?? 0,
      y: item.transform?.[5] ?? 0,
    }))
    .sort((a, b) => Math.abs(b.y - a.y) > 3 ? b.y - a.y : a.x - b.x);
  const lines: Array<{ y: number; values: Array<{ x: number; text: string }> }> = [];
  for (const item of positioned) {
    let line = lines.find((candidate) => Math.abs(candidate.y - item.y) <= 3);
    if (!line) {
      line = { y: item.y, values: [] };
      lines.push(line);
    }
    line.values.push({ x: item.x, text: item.text });
  }
  return lines
    .sort((a, b) => b.y - a.y)
    .map((line) => line.values.sort((a, b) => a.x - b.x).map((item) => item.text).join("  "))
    .join("\n");
}

function hasUsefulPdfText(text: string) {
  const compact = text.replace(/\s/g, "");
  const labels = text.match(/docket|ticket|date|client|customer|project|site|quantity|total|hours?/gi)?.length ?? 0;
  const parsed = parseDocket(text, "", 99);
  // A PDF can contain selectable printed labels but scanned handwritten values.
  return compact.length >= 80 && labels >= 2 && parsed.status === "ready";
}

async function readPdf(
  file: File,
  worker: OcrWorker,
  setOcrProgress: (handler: (message: { status: string; progress: number }) => void) => void,
  onProgress: (progress: number, message: string) => void,
) {
  await loadPdfReader();
  if (!window.pdfjsLib) throw new Error("PDF reader unavailable");
  const pdfDocument = await window.pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
  if (pdfDocument.numPages > 60) throw new Error("PDFs can contain up to 60 pages.");
  const pages: OcrPage[] = [];
  for (let pageNumber = 1; pageNumber <= pdfDocument.numPages; pageNumber += 1) {
    const page = await pdfDocument.getPage(pageNumber);
    const embeddedText = textFromPdfItems((await page.getTextContent()).items);
    if (hasUsefulPdfText(embeddedText)) {
      pages.push({
        text: embeddedText,
        confidence: 99,
        pageNumber,
        pageCount: pdfDocument.numPages,
      });
      onProgress(
        Math.max(8, Math.round((pageNumber / pdfDocument.numPages) * 80)),
        `Read page ${pageNumber} of ${pdfDocument.numPages}`,
      );
      continue;
    }

    const initialViewport = page.getViewport({ scale: 2.35 });
    const renderScale = Math.min(1, 3600 / Math.max(initialViewport.width, initialViewport.height));
    const viewport = page.getViewport({ scale: 2.35 * renderScale });
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const context = canvas.getContext("2d");
    if (!context) continue;
    await page.render({ canvasContext: context, viewport }).promise;
    let passProgress = 0;
    setOcrProgress((message) => {
      if (message.status === "recognizing text") {
        const pageProgress = (pageNumber - 1 + passProgress + message.progress / 2) / pdfDocument.numPages;
        onProgress(Math.max(8, Math.round(pageProgress * 80)), `Scanning page ${pageNumber} of ${pdfDocument.numPages}`);
      }
    });
    const result = await recogniseDocketCanvas(worker, canvas, (progress, message) => {
      passProgress = progress;
      const pageProgress = (pageNumber - 1 + progress) / pdfDocument.numPages;
      onProgress(Math.max(8, Math.round(pageProgress * 80)), `${message} — page ${pageNumber} of ${pdfDocument.numPages}`);
    });
    pages.push({
      text: result.text,
      candidates: [...(result.candidates||[result]), ...(embeddedText.trim()?[{text:embeddedText,confidence:99}]:[])],
      confidence: result.confidence,
      pageNumber,
      pageCount: pdfDocument.numPages,
    });
  }
  return pages;
}

function escapeCsv(value: string | number) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function EmptyState({ onUpload }: { onUpload: () => void }) {
  return (
    <div className="flex min-h-64 flex-col items-center justify-center px-6 text-center">
      <span className="mb-4 flex size-12 items-center justify-center rounded-2xl bg-orange-50 text-primary">
        <FileSearch className="size-6" />
      </span>
      <h3 className="text-base font-bold text-slate-900">No dockets in this month</h3>
      <p className="mt-1 max-w-md text-sm text-slate-500">
        Upload scans, phone photos or a multi-page PDF. Each docket is extracted into its own row.
      </p>
      <Button onClick={onUpload} className="mt-5"><UploadCloud /> Upload dockets</Button>
    </div>
  );
}

export function DocketDashboard() {
  const currentMonth = new Date().toISOString().slice(0, 7);
  const [selectedMonth, setSelectedMonth] = useState(currentMonth);
  const [records, setRecords] = useState<Docket[]>([]);
  const [isSample, setIsSample] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "ready" | "flagged">("all");
  const [pending, setPending] = useState<PendingFile[]>([]);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [editing, setEditing] = useState<Docket | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let active = true;
    fetch(`/api/dockets?month=${selectedMonth}`, { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("load failed");
        return (await response.json()) as { dockets: Docket[] };
      })
      .then(({ dockets }) => {
        if (!active) return;
        setLoadError("");
        if (dockets.length) {
          setRecords(dockets);
          setIsSample(false);
        } else {
          setRecords([]);
          setIsSample(false);
        }
      })
      .catch(() => {
        if (!active) return;
        setRecords([]);
        setIsSample(false);
        setLoadError("Your saved dockets could not be loaded. Refresh to retry; no records have been removed.");
      })
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [selectedMonth]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return records.filter((record) => {
      const statusMatch = statusFilter === "all"
        || (statusFilter === "ready" ? record.status === "ready" : record.status !== "ready");
      const queryMatch = !needle || [
        record.docketNo, record.client, record.project, record.crew, record.poNumber,
      ].join(" ").toLowerCase().includes(needle);
      return statusMatch && queryMatch;
    });
  }, [records, query, statusFilter]);

  const entryNumbers = useMemo(
    () => new Map(records.map((record, index) => [record.id, index + 1])),
    [records],
  );

  function displayEntryNumber(record: Docket) {
    return String(entryNumbers.get(record.id) ?? 0).padStart(3, "0");
  }

  const summary = useMemo(() => {
    const ready = records.filter((record) => record.status === "ready");
    const clients = Object.entries(
      records.reduce<Record<string, { count: number; amount: number }>>((result, record) => {
        const key = record.client || "Client not read";
        result[key] ??= { count: 0, amount: 0 };
        result[key].count += 1;
        result[key].amount += Number(record.amount || 0);
        return result;
      }, {}),
    ).sort((a, b) => b[1].amount - a[1].amount).slice(0, 4);
    return {
      ready: ready.length,
      flagged: records.length - ready.length,
      amount: ready.reduce((total, record) => total + Number(record.amount || 0), 0),
      hours: records.reduce((total, record) => total + Number(record.labourHours || 0), 0),
      missingPo: records.filter((record) => !record.poNumber).length,
      averageConfidence: records.length
        ? Math.round(records.reduce((total, record) => total + record.confidence, 0) / records.length) : 0,
      clients,
      completion: records.length ? Math.round((ready.length / records.length) * 100) : 0,
    };
  }, [records]);

  function chooseFiles(files: FileList | File[]) {
    const supported = Array.from(files).filter(
      (file) => file.type.startsWith("image/") || file.type === "application/pdf",
    );
    const accepted = supported.filter((file) => file.size <= 25 * 1024 * 1024);
    if (!supported.length) {
      toast.error("Choose JPG, PNG, WebP or PDF dockets.");
      return;
    }
    if (accepted.length !== supported.length) toast.error("Files over 25 MB were not added.");
    if (!accepted.length) return;
    const additions: PendingFile[] = accepted.map((file) => ({
      id: crypto.randomUUID(), file, progress: 0, state: "queued",
    }));
    setPending((current) => uploadOpen ? [...current, ...additions] : additions);
    setUploadOpen(true);
    if (fileInput.current) fileInput.current.value = "";
  }

  function updatePending(id: string, change: Partial<PendingFile>) {
    setPending((files) => files.map((item) => item.id === id ? { ...item, ...change } : item));
  }

  async function saveRecords(records: Docket[], file: File) {
    const form = new FormData();
    form.append("records", JSON.stringify(records));
    form.append("file", file);
    const response = await fetch("/api/dockets", { method: "POST", body: form });
    if (!response.ok) throw new Error("save failed");
    return ((await response.json()) as { dockets: Docket[] }).dockets;
  }

  async function processFiles() {
    if (!pending.length || processing) return;
    setProcessing(true);
    const uploaded: Docket[] = [];
    let progressHandler: (message: { status: string; progress: number }) => void = () => undefined;
    let worker: OcrWorker | null = null;
    try {
      await loadTesseract();
      if (!window.Tesseract) throw new Error("OCR unavailable");
      worker = await window.Tesseract.createWorker("eng", 1, {
        // rotateAuto (used below for every recognise pass) relies on Tesseract's
        // orientation/script detection, which only runs on the legacy engine.
        // Without these two flags the legacy model never loads, so rotateAuto
        // silently has no effect and angled or upside-down phone photos get
        // OCR'd in the wrong orientation, producing unreadable text.
        legacyCore: true,
        legacyLang: true,
        logger: (message) => progressHandler(message),
      });
      for (const [fileIndex, item] of pending.entries()) {
        if (item.state === "done") continue;
        try {
          updatePending(item.id, { state: "reading", progress: 6, message: "Preparing file" });
          let pages: OcrPage[] = [];
          if (item.file.type.startsWith("image/")) {
            const canvas = await imageToCanvas(item.file);
            let passProgress = 0;
            progressHandler = (message) => {
              if (message.status === "recognizing text") {
                updatePending(item.id, {
                  progress: Math.max(8, Math.round((passProgress + message.progress / 2) * 80)),
                  message: "Scanning image",
                });
              }
            };
            const result = await recogniseDocketCanvas(worker, canvas, (progress, message) => {
              passProgress = progress;
              updatePending(item.id, {
                progress: Math.max(8, Math.round(progress * 80)),
                message,
              });
            });
            pages = [{ text: result.text, candidates:result.candidates, confidence: result.confidence, pageNumber: 1, pageCount: 1 }];
          } else if (item.file.type === "application/pdf") {
            pages = await readPdf(
              item.file,
              worker,
              (handler) => { progressHandler = handler; },
              (progress, message) => updatePending(item.id, { progress, message }),
            );
          }
          const parsed = pages.flatMap(page=>parseDocketPage(page.candidates||[page],item.file.name,{pageNumber:page.pageNumber,pageCount:page.pageCount}));
          if (!parsed.length) throw new Error("No docket pages found");
          updatePending(item.id, {
            state: "saving",
            progress: 88,
            message: `${parsed.length} ${parsed.length === 1 ? "docket" : "dockets"} found`,
          });
          const saved = await saveRecords(parsed, item.file);
          uploaded.push(...saved);
          updatePending(item.id, {
            state: "done",
            progress: 100,
            docketCount: saved.length,
            message: `${saved.length} ${saved.length === 1 ? "docket" : "dockets"} added`,
          });
        } catch (error) {
          updatePending(item.id, {
            state: "error",
            progress: 100,
            message: error instanceof Error ? error.message.slice(0, 60) : "Could not process",
          });
        }
        if (fileIndex < pending.length - 1) progressHandler = () => undefined;
      }
      if (uploaded.length) {
        const inMonth = uploaded.filter((record) => record.workDate.startsWith(selectedMonth));
        window.dispatchEvent(new Event('records-changed'));
        setRecords((existing) => [...inMonth, ...existing]);
        setIsSample(false);
        toast.success(`${uploaded.length} ${uploaded.length === 1 ? "docket" : "dockets"} extracted and added.`);
        const otherMonths = [...new Set(uploaded.filter((record) => !record.workDate.startsWith(selectedMonth)).map((record) => record.workDate.slice(0, 7)))];
        if (otherMonths.length) toast.info(`Other dockets were filed under ${otherMonths.map(monthTitle).join(", ")}. Change the month to review them.`);
      }
    } catch {
      toast.error("OCR could not start. Check your connection and try again.");
    } finally {
      if (worker) await worker.terminate().catch(() => undefined);
      setProcessing(false);
    }
  }

  function exportCsv() {
    const headings = [
      "Entry No", "Date", "Docket No", "Client", "Project / Site", "Crew", "Vehicle",
      "Start", "Finish", "Break Hours", "Labour Hours", "Quantity", "Unit",
      "Amount ex GST", "PO / WOL", "Status", "OCR Confidence", "Source File", "Notes",
    ];
    const rows = filtered.map((record) => [
      displayEntryNumber(record), record.workDate, record.docketNo, record.client, record.project, record.crew,
      record.vehicle, record.startTime, record.finishTime, record.breakHours,
      record.labourHours, record.quantity, record.quantityUnit, record.amount,
      record.poNumber, statusLabel(record.status), `${record.confidence}%`,
      record.sourceName, record.notes,
    ]);
    const csv = [headings, ...rows].map((row) => row.map(escapeCsv).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `docket-reconciliation-${selectedMonth}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
    toast.success("Reconciliation CSV downloaded.");
  }

  async function saveEdit() {
    if (!editing || isSample) return;
    setSavingEdit(true);
    try {
      const response = await fetch("/api/dockets", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editing),
      });
      if (!response.ok) { const problem=await response.json().catch(()=>({})) as {error?:string}; throw new Error(problem.error || 'Changes could not be saved.'); }
      const { docket } = (await response.json()) as { docket: Docket };
      window.dispatchEvent(new Event('records-changed'));
      setRecords((items) => items.map((item) => item.id === docket.id ? docket : item).filter((item) => item.workDate.startsWith(selectedMonth)));
      setEditing(null);
      toast.success("Docket updated.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Changes could not be saved.');
    } finally {
      setSavingEdit(false);
    }
  }

  async function deleteDocket(record: Docket) {
    if (isSample || deletingId) return;
    const confirmed = window.confirm(
      `Archive entry #${displayEntryNumber(record)}, docket ${record.docketNo}?\n\nThe record and its original file will be retained.`,
    );
    if (!confirmed) return;

    setDeletingId(record.id);
    try {
      const response = await fetch("/api/dockets/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: record.id }),
      });
      const result = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(result.error || "The docket could not be deleted.");
      window.dispatchEvent(new Event('records-changed'));
      setRecords((items) => items.filter((item) => item.id !== record.id));
      if (editing?.id === record.id) setEditing(null);
      toast.success(`Docket ${record.docketNo} deleted.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The docket could not be deleted.");
    } finally {
      setDeletingId(null);
    }
  }

  async function docketAction(action: string, record: Docket) {
    if(action==='reparse'){
      if(!record.rawText.trim()){toast.error('No saved OCR text. Use Reprocess to scan the original.');return;}
      const parsed=parseDocket(record.rawText,record.sourceName,record.confidence,{pageNumber:record.sourcePage});
      setEditing({...record,...parsed,id:record.id,status:'review',links:record.links,sourceCrop:record.sourceCrop,notes:parsed.notes+' Re-read saved OCR text. Review before saving.'});
      toast.info('Updated extraction opened for review. Save changes to update this docket.');return;
    }
    if(action!=='reprocess') { toast.error('Boundary editing is unavailable until source regions are selected. No records have been changed.'); return; }
    let worker: OcrWorker | null=null;
    try {
      const response=await fetch('/api/dockets/file?id='+encodeURIComponent(record.id));
      if(!response.ok)throw new Error('The original file could not be opened.');
      const blob=await response.blob(), file=new File([blob],record.sourceName,{type:blob.type});
      await loadTesseract();
      if(!window.Tesseract)throw new Error('OCR could not load.');
      worker=await window.Tesseract.createWorker('eng',1,{legacyCore:true,legacyLang:true,logger:()=>{}});
      toast.info('Reading the original document again…');
      const pages=file.type==='application/pdf'?await readPdf(file,worker,()=>{},()=>{}):[{...await recogniseDocketCanvas(worker,await imageToCanvas(file),()=>{}),pageNumber:1,pageCount:1}];
      const page=pages.find(p=>p.pageNumber===(record.sourcePage||1));
      if(!page)throw new Error('Source page was not found.');
      const sections=splitDocketText(page.text);
      if(sections.length>1)throw new Error('This page contains multiple dockets. Select the source region before replacing a record.');
      const parsed=parseDocketPage(page.candidates||[page],record.sourceName,{pageNumber:page.pageNumber,pageCount:page.pageCount})[0];
      if(!parsed)throw new Error('No readable text found. Saved data is unchanged.');
      if(!window.confirm('Review newly extracted fields? This replaces the open draft only. Saved values remain unchanged until you choose Save changes.'))return;
      setEditing({...record,...parsed,id:record.id,status:'review',links:record.links,notes:parsed.notes+' New OCR draft from original source; review before saving.'});
      toast.success('New OCR draft ready. Check the fields before saving.');
    } catch(e) { toast.error(e instanceof Error?e.message:'Reprocessing failed. Saved data is unchanged.'); }
    finally { if(worker)await worker.terminate(); }
  }

  const completedFiles = pending.filter((item) => item.state === "done").length;
  const upload = () => fileInput.current?.click();

  return (
    <div className="min-h-screen">
      <Toaster position="top-right" richColors />
      {loadError && <p role="alert" className="border-b border-red-200 bg-red-50 px-6 py-4 text-red-800">{loadError}</p>}
      <input
        ref={fileInput}
        className="sr-only"
        type="file"
        accept="image/jpeg,image/png,image/webp,application/pdf"
        multiple
        onChange={(event) => event.target.files && chooseFiles(event.target.files)}
      />

      <header className="border-b border-slate-800 bg-[#101a24] text-white">
        <div className="mx-auto flex max-w-[1600px] flex-wrap items-center justify-between gap-4 px-4 py-4 sm:px-6 lg:px-8">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary shadow-[0_7px_18px_rgba(232,93,37,.3)]">
              <ScanLine className="size-5" strokeWidth={2.3} />
            </span>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h1 className="truncate text-lg font-bold tracking-tight">Docket Recon</h1>
                <Badge className="hidden rounded-md border-white/10 bg-white/10 text-[11px] text-slate-200 sm:inline-flex">
                  MONTHLY CLOSE
                </Badge>
              </div>
              <p className="truncate text-sm text-slate-400">{monthTitle(selectedMonth)} reconciliation</p>
            </div>
          </div>
          <div className="flex w-full items-center gap-2 sm:w-auto">
            <div className="relative min-w-0 flex-1 sm:w-44">
              <CalendarDays className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
              <Input
                type="month"
                value={selectedMonth}
                onChange={(event) => {
                  setLoading(true);
                  setSelectedMonth(event.target.value);
                }}
                aria-label="Reconciliation month"
                className="h-10 border-slate-700 bg-slate-900/60 pl-9 text-white shadow-none [color-scheme:dark]"
              />
            </div>
            <Button
              variant="outline"
              onClick={exportCsv}
              disabled={!filtered.length}
              className="h-10 border-slate-700 bg-transparent text-white hover:bg-slate-800 hover:text-white"
            >
              <ArrowDownToLine /> <span className="hidden md:inline">Export CSV</span>
            </Button>
            <Button className="h-10 shadow-[0_8px_20px_rgba(232,93,37,.24)]" onClick={upload}>
              <UploadCloud /> <span className="hidden sm:inline">Upload dockets</span>
            </Button>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-[1600px] px-4 py-5 sm:px-6 lg:px-8 lg:py-7">
        {isSample && (
          <div className="mb-4 flex items-start gap-3 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">
            <Sparkles className="mt-0.5 size-4 shrink-0 text-blue-600" />
            <p><strong>Sample month shown.</strong> Upload your first docket to replace these examples with your live reconciliation.</p>
          </div>
        )}

        <section aria-label="Month summary" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {[
            {
              label: "Dockets captured", value: records.length.toLocaleString("en-AU"),
              note: `${summary.ready} ready to reconcile`, icon: FileText,
              tone: "bg-blue-50 text-blue-700",
            },
            {
              label: "Ready to invoice", value: money.format(summary.amount),
              note: "Ex GST from ready dockets", icon: CircleDollarSign,
              tone: "bg-emerald-50 text-emerald-700",
            },
            {
              label: "Labour captured", value: `${decimal.format(summary.hours)} hrs`,
              note: "Across all uploaded dockets", icon: Clock3,
              tone: "bg-violet-50 text-violet-700",
            },
            {
              label: "Needs attention", value: summary.flagged.toLocaleString("en-AU"),
              note: summary.flagged ? "Review before month close" : "No checks outstanding",
              icon: AlertTriangle,
              tone: summary.flagged ? "bg-amber-50 text-amber-700" : "bg-emerald-50 text-emerald-700",
            },
          ].map((item) => (
            <article key={item.label} className="rounded-xl border bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,.03)] sm:p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-slate-500">{item.label}</p>
                  <p className="mt-2 text-2xl font-bold tracking-tight text-slate-950">{item.value}</p>
                  <p className="mt-1 text-sm text-slate-500">{item.note}</p>
                </div>
                <span className={`flex size-10 shrink-0 items-center justify-center rounded-xl ${item.tone}`}>
                  <item.icon className="size-5" />
                </span>
              </div>
            </article>
          ))}
        </section>

        <div className="mt-5 grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_310px]">
          <section className="min-w-0 overflow-hidden rounded-xl border bg-white shadow-[0_1px_3px_rgba(15,23,42,.04)]">
            <div className="flex flex-col gap-3 border-b px-4 py-4 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <h2 className="text-base font-bold text-slate-950">Monthly docket register</h2>
                <p className="mt-0.5 text-sm text-slate-500">Resolve flags, then export the final month.</p>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row">
                <div className="relative sm:w-64">
                  <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
                  <Input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Search docket, client or PO"
                    aria-label="Search dockets"
                    className="pl-9"
                  />
                </div>
                <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-1">
                  <Filter className="ml-1 size-4 text-slate-400" />
                  {(["all", "ready", "flagged"] as const).map((status) => (
                    <Button
                      key={status}
                      size="sm"
                      variant={statusFilter === status ? "default" : "ghost"}
                      onClick={() => setStatusFilter(status)}
                      className={statusFilter === status ? "shadow-sm" : "text-slate-600"}
                    >
                      {status === "all" ? "All" : status === "ready" ? "Ready" : "Flagged"}
                    </Button>
                  ))}
                </div>
              </div>
            </div>

            {loading ? (
              <div className="flex min-h-64 items-center justify-center gap-2 text-sm text-slate-500">
                <LoaderCircle className="size-4 animate-spin" /> Loading month
              </div>
            ) : !filtered.length ? (
              <EmptyState onUpload={upload} />
            ) : (
              <>
              <div className="space-y-3 p-3 md:hidden">{filtered.map(record => <article key={record.id} className="space-y-3 rounded-lg border p-4"><div className="flex flex-wrap items-start justify-between gap-2"><div><p className="font-semibold">Docket {record.docketNo || 'number missing'}</p><p className="text-sm text-slate-600">{displayDate(record.workDate)}</p></div><StatusBadge status={record.status}/></div><div><p className="font-semibold">{record.client || 'Client not read'}</p><p className="text-sm">{record.project || 'Project not read'}</p></div><dl className="grid grid-cols-2 gap-3 text-sm"><div><dt className="text-slate-500">Hours</dt><dd>{record.labourHours ? decimal.format(record.labourHours) : '—'}</dd></div><div><dt className="text-slate-500">Amount</dt><dd>{record.amount ? money.format(record.amount) : '—'}</dd></div><div><dt className="text-slate-500">Quantity</dt><dd>{record.quantity ? `${decimal.format(record.quantity)} ${record.quantityUnit}` : '—'}</dd></div><div><dt className="text-slate-500">Recognition confidence</dt><dd>{record.confidence}%</dd></div></dl><div className="flex flex-wrap gap-2"><Button disabled={isSample} onClick={() => setEditing({...record})}>Review docket</Button><Button variant="outline" disabled={isSample || !!deletingId} onClick={() => void deleteDocket(record)}>Delete</Button></div></article>)}</div>
              <div className="hidden md:block"><Table>
                <TableHeader className="bg-slate-50/90">
                  <TableRow className="hover:bg-slate-50/90">
                    <TableHead className="w-20 pl-4">Entry</TableHead>
                    <TableHead>Date / docket</TableHead>
                    <TableHead>Client / project</TableHead>
                    <TableHead>Crew</TableHead>
                    <TableHead className="text-right">Hours</TableHead>
                    <TableHead className="text-right">Quantity</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>OCR</TableHead>
                    <TableHead className="w-32 pr-4 text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((record) => (
                    <TableRow key={record.id} className={record.status !== "ready" ? "bg-amber-50/30" : undefined}>
                      <TableCell className="pl-4 font-mono text-sm font-bold text-slate-500">
                        #{displayEntryNumber(record)}
                      </TableCell>
                      <TableCell>
                        <p className="font-semibold text-slate-900">{displayDate(record.workDate)}</p>
                        <p className="mt-0.5 font-mono text-xs text-slate-500">{record.docketNo}</p>
                      </TableCell>
                      <TableCell className="max-w-[260px]">
                        <p className="truncate font-semibold text-slate-900">{record.client || "Client not read"}</p>
                        <p className="mt-0.5 truncate text-xs text-slate-500">{record.project || "Project not read"}</p>
                      </TableCell>
                      <TableCell>
                        <p className="max-w-40 truncate text-slate-700">{record.crew || "—"}</p>
                        <p className="mt-0.5 text-xs text-slate-400">{record.vehicle || record.poNumber || "No PO / vehicle"}</p>
                      </TableCell>
                      <TableCell className="text-right font-semibold text-slate-800">
                        {record.labourHours ? decimal.format(record.labourHours) : "—"}
                      </TableCell>
                      <TableCell className="text-right text-slate-700">
                        {record.quantity ? `${decimal.format(record.quantity)} ${record.quantityUnit}` : "—"}
                      </TableCell>
                      <TableCell className="text-right font-semibold text-slate-900">
                        {record.amount ? money.format(record.amount) : "—"}
                      </TableCell>
                      <TableCell><StatusBadge status={record.status} /></TableCell>
                      <TableCell>
                        <span className={`font-semibold ${record.confidence >= 85 ? "text-emerald-700" : record.confidence >= 70 ? "text-amber-700" : "text-red-700"}`}>
                          {record.confidence}%
                        </span>
                      </TableCell>
                      <TableCell className="pr-4">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            size="icon-sm"
                            variant="ghost"
                            aria-label={`Edit entry ${displayEntryNumber(record)}, docket ${record.docketNo}`}
                            disabled={isSample}
                            onClick={() => setEditing({ ...record })}
                          >
                            <Pencil />
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            aria-label={`Delete entry ${displayEntryNumber(record)}, docket ${record.docketNo}`}
                            disabled={isSample || !!deletingId}
                            onClick={() => void deleteDocket(record)}
                            className="border-red-200 text-red-700 hover:border-red-300 hover:bg-red-50 hover:text-red-800"
                          >
                            {deletingId === record.id ? <LoaderCircle className="animate-spin" /> : <Trash2 />}
                            Delete
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table></div></>
            )}

            {!!filtered.length && (
              <div className="flex flex-wrap items-center justify-between gap-2 border-t bg-slate-50/70 px-4 py-3 text-sm text-slate-500">
                <span>{filtered.length} of {records.length} dockets shown</span>
                <span className="font-semibold text-slate-700">
                  Visible total {money.format(filtered.reduce((sum, item) => sum + item.amount, 0))}
                </span>
              </div>
            )}
          </section>

          <aside className="space-y-4">
            <section className="overflow-hidden rounded-xl border bg-white shadow-[0_1px_3px_rgba(15,23,42,.04)]">
              <div className="border-b px-4 py-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h2 className="font-bold text-slate-950">Month check</h2>
                    <p className="mt-0.5 text-sm text-slate-500">What still needs action</p>
                  </div>
                  <span className="text-2xl font-bold text-slate-950">{summary.completion}%</span>
                </div>
                <Progress value={summary.completion} className="mt-3 h-2 bg-slate-100 [&_[data-slot=progress-indicator]]:bg-emerald-600" />
              </div>
              <div className="divide-y px-4">
                {[
                  {
                    label: "Low-confidence or incomplete",
                    value: records.filter((item) => item.status === "review").length,
                    icon: FileSearch, warn: true,
                  },
                  {
                    label: "Possible duplicates",
                    value: records.filter((item) => item.status === "duplicate").length,
                    icon: FileText, warn: true,
                  },
                  {
                    label: "Missing PO / WOL", value: summary.missingPo,
                    icon: AlertTriangle, warn: summary.missingPo > 0,
                  },
                  {
                    label: "Average OCR confidence", value: `${summary.averageConfidence}%`,
                    icon: ScanLine, warn: summary.averageConfidence < 80,
                  },
                ].map((item) => (
                  <div key={item.label} className="flex items-center gap-3 py-3.5">
                    <span className={`flex size-8 items-center justify-center rounded-lg ${item.warn ? "bg-amber-50 text-amber-700" : "bg-emerald-50 text-emerald-700"}`}>
                      <item.icon className="size-4" />
                    </span>
                    <span className="min-w-0 flex-1 text-sm text-slate-600">{item.label}</span>
                    <strong className="text-sm text-slate-950">{item.value}</strong>
                  </div>
                ))}
              </div>
            </section>

            <section className="rounded-xl border bg-white p-4 shadow-[0_1px_3px_rgba(15,23,42,.04)]">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="font-bold text-slate-950">By client</h2>
                  <p className="mt-0.5 text-sm text-slate-500">Captured value this month</p>
                </div>
                <Users className="size-5 text-slate-400" />
              </div>
              <div className="mt-4 space-y-4">
                {summary.clients.map(([client, data]) => {
                  const max = Math.max(...summary.clients.map((entry) => entry[1].amount), 1);
                  const percent = Math.max(4, Math.round((data.amount / max) * 100));
                  return (
                    <div key={client}>
                      <div className="flex items-center justify-between gap-3 text-sm">
                        <span className="truncate font-medium text-slate-700">{client}</span>
                        <span className="shrink-0 font-semibold text-slate-900">{money.format(data.amount)}</span>
                      </div>
                      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100">
                        <div className="h-full rounded-full bg-slate-700" style={{ width: `${percent}%` }} />
                      </div>
                      <p className="mt-1 text-xs text-slate-400">
                        {data.count} {data.count === 1 ? "docket" : "dockets"}
                      </p>
                    </div>
                  );
                })}
              </div>
            </section>

            <button
              type="button"
              onClick={upload}
              className="group flex w-full items-center gap-3 rounded-xl border border-dashed border-slate-300 bg-white/70 p-4 text-left transition hover:border-primary hover:bg-orange-50/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <span className="flex size-10 items-center justify-center rounded-xl bg-orange-50 text-primary">
                <UploadCloud className="size-5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-bold text-slate-900">Add the next batch</span>
                <span className="mt-0.5 block text-xs text-slate-500">Images or multi-page PDFs · up to 25 MB each</span>
              </span>
              <ChevronRight className="size-4 text-slate-400 transition-transform group-hover:translate-x-0.5" />
            </button>
          </aside>
        </div>
      </div>

      <Dialog open={uploadOpen} onOpenChange={(open) => !processing && setUploadOpen(open)}>
        <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-xl">
              <span className="flex size-9 items-center justify-center rounded-xl bg-orange-50 text-primary">
                <ScanLine className="size-5" />
              </span>
              Read digital dockets / standard OCR
            </DialogTitle>
            <DialogDescription>
              Read digital PDFs directly or use standard OCR for printed scans. Handwriting can use the separate paid AI option after upload.
            </DialogDescription>
          </DialogHeader>

          <div
            className="rounded-xl border-2 border-dashed border-slate-200 bg-slate-50/80 p-4"
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              if (!processing) chooseFiles(event.dataTransfer.files);
            }}
          >
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="font-semibold text-slate-900">
                  {pending.length} {pending.length === 1 ? "file" : "files"} selected
                </p>
                <p className="text-sm text-slate-500">Multi-page PDFs and different job docket formats are supported.</p>
              </div>
              <Button variant="outline" size="sm" disabled={processing} onClick={upload}>Add files</Button>
            </div>
          </div>

          <div className="space-y-2">
            {pending.map((item) => (
              <div key={item.id} className="rounded-xl border bg-white p-3.5">
                <div className="flex items-center gap-3">
                  <span className={`flex size-9 shrink-0 items-center justify-center rounded-lg ${
                    item.state === "error" ? "bg-red-50 text-red-600"
                      : item.state === "done" ? "bg-emerald-50 text-emerald-700"
                        : "bg-slate-100 text-slate-600"
                  }`}>
                    {item.state === "done" ? <Check className="size-4" />
                      : item.state === "error" ? <X className="size-4" />
                        : item.state === "reading" || item.state === "saving"
                          ? <LoaderCircle className="size-4 animate-spin" />
                          : <FileText className="size-4" />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-3">
                      <p className="truncate text-sm font-semibold text-slate-900">{item.file.name}</p>
                      <span className="shrink-0 text-xs font-medium text-slate-500">
                        {(item.file.size / 1024 / 1024).toFixed(1)} MB
                      </span>
                    </div>
                    <div className="mt-2 flex items-center gap-3">
                      <Progress value={item.progress} className="h-1.5 flex-1 [&_[data-slot=progress-indicator]]:bg-primary" />
                      <span className="w-28 truncate text-right text-xs text-slate-500">
                        {item.message || "Ready to scan"}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="rounded-lg bg-blue-50 px-3.5 py-3 text-sm text-blue-900">
            <strong>Standard OCR — no AI charge.</strong> Digital PDF text is read directly; scanned pages are enhanced before OCR. Missing fields and duplicate docket numbers are sent to review.
          </div>

          <DialogFooter>
            <Button variant="outline" disabled={processing} onClick={() => setUploadOpen(false)}>Cancel</Button>
            <Button
              disabled={processing || !pending.length || completedFiles === pending.length}
              onClick={processFiles}
            >
              {processing
                ? <><LoaderCircle className="animate-spin" /> Reading {Math.min(completedFiles + 1, pending.length)} of {pending.length}</>
                : <><ScanLine /> Read & add dockets</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!editing} onOpenChange={(open) => !open && !savingEdit && setEditing(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Review docket {editing?.docketNo}</DialogTitle>
            <DialogDescription>Correct the extracted values against the original, then mark it ready.</DialogDescription>
          </DialogHeader>
          {editing && (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex items-center justify-between gap-3 rounded-lg border bg-slate-50 px-3 py-2 sm:col-span-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-slate-800">{editing.sourceName}</p><div className="mt-2"><PaidAiScan kind="docket" sourceId={editing.id}/></div>
                  <p className="text-xs text-slate-500">Standard OCR / digital text · original uploaded docket</p>
                </div>
              <div className="rounded-lg border border-orange-200 bg-orange-50 p-3 text-sm sm:col-span-2"><p className="font-semibold text-orange-900">Source and boundary review</p><p className="mt-1 text-orange-800">Page {editing.sourcePage || "Source page not captured"} · {editing.sourceCrop || "full-page"} · {editing.extractionMethod || "local-ocr"} · Profile {editing.profileId || "generic"}</p><div className="mt-2 flex flex-wrap gap-2"><Button type="button" variant="outline" size="sm" onClick={() => docketAction("split", editing).catch((e) => toast.error(e.message))}>Split record</Button><Button type="button" variant="outline" size="sm" onClick={() => docketAction("merge", editing).catch((e) => toast.error(e.message))}>Merge adjacent</Button><Button type="button" variant="outline" size="sm" onClick={() => docketAction("reprocess", editing).catch((e) => toast.error(e.message))}>Reprocess</Button></div></div>
              {!!editing.fieldConfidence && <div className="rounded-lg border p-3 text-sm sm:col-span-2"><p className="font-semibold">Uncertain fields</p><div className="mt-2 flex flex-wrap gap-2">{Object.entries(editing.fieldConfidence).filter(([,v])=>Number(v)<78).map(([k,v])=><span key={k} className="rounded-full bg-amber-100 px-2 py-1 text-amber-900">{k}: {v}%</span>)}</div></div>}
              <div className="rounded-lg border bg-slate-50 p-3 text-sm sm:col-span-2"><p className="font-semibold">Suggested OS links</p><p className="mt-1 text-slate-600">Client {editing.client||"confirm"} · Job {editing.project||"confirm"} · Shift {editing.startTime||"suggest"} · PO/WOL {editing.poNumber||"confirm"} · Vehicle {editing.vehicle||"confirm"} · Claim {editing.workDate.slice(0,7)}</p><p className="mt-1 text-amber-800">Confirm uncertain matches before Matched or Approved.</p></div>
              {!!editing.lineItems?.length && <div className="rounded-lg border p-3 text-sm sm:col-span-2"><p className="font-semibold">Line items</p>{editing.lineItems.map((item,i)=><div key={i} className="flex justify-between border-b py-2"><span>{String(item.description||"Item")}</span><span>{String(item.quantity||0)} {String(item.unit||"")} · {item.valueSource === "document" ? "document" : "system rate pending"}</span></div>)}</div>}
                <Button asChild variant="outline" size="sm">
                  <a href={`/api/dockets/file?id=${encodeURIComponent(editing.id)}`} target="_blank" rel="noreferrer">
                    <FileSearch /> Open original
                  </a>
                </Button>
              </div>
              <div className="min-h-56 rounded-lg border bg-slate-100 p-2 sm:col-span-1"><p className="mb-2 text-xs font-semibold text-slate-600">Source document</p><object data={`/api/dockets/file?id=${encodeURIComponent(editing.id)}`} type="application/pdf" className="h-56 w-full"><a href={`/api/dockets/file?id=${encodeURIComponent(editing.id)}`} target="_blank" rel="noreferrer">Open source</a></object></div>
              <div className="rounded-lg border p-3 text-sm sm:col-span-1"><p className="font-semibold">Extracted record</p><p className="mt-2 text-slate-600">Fields with confidence below 78% are highlighted below for manual confirmation.</p></div>
              <div className="rounded-lg border border-orange-200 bg-orange-50 p-3 text-sm sm:col-span-2"><p>Previously saved dockets keep their original extraction until reviewed. Re-read saved text to apply the latest parsing rules without rescanning.</p><Button type="button" className="mt-2" variant="outline" onClick={()=>void docketAction('reparse',editing)}>Re-read saved text</Button></div>
              {[
                ["Docket number", "docketNo", "text"], ["Work date", "workDate", "date"],
                ["Client", "client", "text"], ["Project / site", "project", "text"],
                ["Crew", "crew", "text"], ["Vehicle / rego", "vehicle", "text"],
                ["Start time", "startTime", "time"], ["Finish time", "finishTime", "time"],
                ["Break hours", "breakHours", "number"], ["Labour hours", "labourHours", "number"],
                ["Quantity", "quantity", "number"], ["Quantity unit", "quantityUnit", "text"],
                ["Amount ex GST", "amount", "number"], ["PO / WOL", "poNumber", "text"],
              ].map(([label, key, type]) => (
                <div key={key} className="space-y-2">
                  <Label htmlFor={`edit-${key}`}>{label}</Label>
                  <Input
                    id={`edit-${key}`}
                    type={type}
                    step={type === "number" ? "0.1" : undefined}
                    value={String(editing[key as keyof Docket] ?? "")}
                    onChange={(event) => setEditing((current) => current ? {
                      ...current,
                      [key]: type === "number" ? Number(event.target.value) : event.target.value,
                    } : current)}
                  />
                </div>
              ))}
              <div className="space-y-2">
                <Label htmlFor="edit-status">Reconciliation status</Label>
                <NativeSelect
                  id="edit-status"
                  className="w-full"
                  value={editing.status}
                  onChange={(event) => setEditing({ ...editing, status: event.target.value as DocketStatus })}
                >
                  <NativeSelectOption value="ready">Ready</NativeSelectOption>
                  <NativeSelectOption value="review">Needs review</NativeSelectOption>
                  <NativeSelectOption value="duplicate">Possible duplicate</NativeSelectOption>
                </NativeSelect>
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-confidence">OCR confidence</Label>
                <Input id="edit-confidence" value={`${editing.confidence}%`} disabled />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="edit-notes">Notes</Label>
                <Textarea
                  id="edit-notes"
                  value={editing.notes}
                  onChange={(event) => setEditing({ ...editing, notes: event.target.value })}
                />
              </div>
              {!!editing.rawText && (
                <details className="rounded-lg border bg-slate-50 p-3 text-sm sm:col-span-2">
                  <summary className="cursor-pointer font-semibold text-slate-700">View raw OCR text</summary>
                  <pre className="mt-3 max-h-40 overflow-auto whitespace-pre-wrap font-mono text-xs text-slate-500">
                    {editing.rawText}
                  </pre>
                </details>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" disabled={savingEdit} onClick={() => setEditing(null)}>Cancel</Button>
            <Button disabled={savingEdit} onClick={saveEdit}>
              {savingEdit ? <LoaderCircle className="animate-spin" /> : <Check />} Save docket
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  );
}
