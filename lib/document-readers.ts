type OcrProgress = { status: string; progress: number };
export type OcrWorker = {
  setParameters: (parameters: Record<string, string>) => Promise<void>;
  recognize: (
    image: File | HTMLCanvasElement,
    options?: { rotateAuto?: boolean },
  ) => Promise<{ data: { text: string; confidence: number } }>;
  terminate: () => Promise<void>;
};

declare global {
  interface Window {
    Tesseract?: {
      createWorker: (
        language: string,
        oem: number,
        options: {
          logger: (message: OcrProgress) => void;
          legacyCore?: boolean;
          legacyLang?: boolean;
        },
      ) => Promise<OcrWorker>;
    };
    pdfjsLib?: {
      version: string;
      GlobalWorkerOptions: { workerSrc: string };
      getDocument: (options: { data: ArrayBuffer; isEvalSupported: false; cMapUrl: string; standardFontDataUrl: string; wasmUrl: string }) => {
        promise: Promise<{
          numPages: number;
          getPage: (page: number) => Promise<{
            getViewport: (options: { scale: number }) => { width: number; height: number };
            getTextContent: () => Promise<{
              items: Array<{ str?: string; transform?: number[] }>;
            }>;
            render: (options: {
              canvasContext: CanvasRenderingContext2D;
              viewport: { width: number; height: number };
            }) => { promise: Promise<void> };
          }>;
        }>;
      };
    };
  }
}

// Keep the API, module worker and auxiliary assets on one exact upstream release.
// The maintained legacy build includes polyfills for wider browser compatibility.
export const PDF_READER_VERSION = "6.3.289";
const PDF_ASSET_BASE = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDF_READER_VERSION}/`;
export const PDF_READER_MODULE_URL = `${PDF_ASSET_BASE}legacy/build/pdf.min.mjs`;
export const PDF_READER_WORKER_URL = `${PDF_ASSET_BASE}legacy/build/pdf.worker.min.mjs`;

// Retain the explicit no-eval policy as defence in depth after upgrading.
// https://github.com/mozilla/pdf.js/security/advisories/GHSA-wgrm-67xf-hhpq
export const PDF_READER_OPTIONS = Object.freeze({
  isEvalSupported: false as const,
  cMapUrl: `${PDF_ASSET_BASE}cmaps/`,
  standardFontDataUrl: `${PDF_ASSET_BASE}standard_fonts/`,
  wasmUrl: `${PDF_ASSET_BASE}wasm/`,
});

const SCRIPT_TIMEOUT_MS = 30_000;

// Concurrent callers share one bounded attempt. Failure removes stale scripts
// and handlers and clears the promise so the next user retry can start afresh.
function scriptLoader(src: string, marker: string, label: string, ready: () => boolean, moduleScript = false) {
  let pending: Promise<void> | undefined;
  let attemptNumber = 0;
  return function load(): Promise<void> {
    if (pending) return pending;
    if (ready()) return Promise.resolve();
    const attempt = new Promise<void>((resolve, reject) => {
      document.querySelector(`script[${marker}]`)?.remove();
      const script = document.createElement("script");
      let settled = false;
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        script.onload = script.onerror = null;
        if (error) { script.remove(); reject(error); }
        else resolve();
      };
      const timer = setTimeout(() => finish(new Error(`${label} load timed out. Check your connection and try again.`)), SCRIPT_TIMEOUT_MS);
      // Module failures can be cached by URL. A retry uses a fresh module-map key
      // while still fetching exactly the same pinned release.
      script.src = moduleScript && attemptNumber > 0 ? `${src}?readerRetry=${attemptNumber}` : src;
      attemptNumber += 1;
      if (moduleScript) script.type = "module";
      script.async = true;
      script.setAttribute(marker, "true");
      script.onload = () => finish(ready() ? undefined : new Error(`${label} failed to initialise. Try again.`));
      script.onerror = () => finish(new Error(`${label} failed to load. Check your connection and try again.`));
      try { document.head.appendChild(script); }
      catch { finish(new Error(`${label} could not start. Try again.`)); }
    });
    pending = attempt.finally(() => { pending = undefined; });
    return pending;
  };
}

export const loadTesseract = scriptLoader(
  "https://cdn.jsdelivr.net/npm/tesseract.js@7/dist/tesseract.min.js",
  "data-docket-ocr", "OCR",
  () => typeof window.Tesseract?.createWorker === "function",
);

const loadPdfScript = scriptLoader(
  PDF_READER_MODULE_URL,
  "data-docket-pdf", "PDF reader",
  () => window.pdfjsLib?.version === PDF_READER_VERSION
    && typeof window.pdfjsLib.getDocument === "function"
    && !!window.pdfjsLib.GlobalWorkerOptions,
  true,
);

export async function loadPdfReader() {
  await loadPdfScript();
  if (!window.pdfjsLib || window.pdfjsLib.version !== PDF_READER_VERSION) {
    throw new Error("PDF reader version mismatch. Reload and try again.");
  }
  window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDF_READER_WORKER_URL;
}
