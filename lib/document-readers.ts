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
      GlobalWorkerOptions: { workerSrc: string };
      getDocument: (options: { data: ArrayBuffer }) => {
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

export async function loadTesseract() {
  if (window.Tesseract) return;
  await new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>("script[data-docket-ocr]");
    if (existing) {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error("OCR failed to load")), { once: true });
      return;
    }
    const script = document.createElement("script");
    script.src = "https://cdn.jsdelivr.net/npm/tesseract.js@7/dist/tesseract.min.js";
    script.async = true;
    script.dataset.docketOcr = "true";
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("OCR failed to load"));
    document.head.appendChild(script);
  });
}

export async function loadPdfReader() {
  if (window.pdfjsLib) return;
  await new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
    script.async = true;
    script.dataset.docketPdf = "true";
    script.onload = () => {
      if (!window.pdfjsLib) {
        reject(new Error("PDF reader failed to load"));
        return;
      }
      window.pdfjsLib.GlobalWorkerOptions.workerSrc =
        "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
      resolve();
    };
    script.onerror = () => reject(new Error("PDF reader failed to load"));
    document.head.appendChild(script);
  });
}

