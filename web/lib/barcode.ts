// Barcode decoding: native BarcodeDetector where it exists (Chrome on Android),
// otherwise a self-hosted ZXing WebAssembly build (Safari on iPhone). Nothing is
// fetched from a CDN, so scanning works on a VPN with no internet.
import wasmUrl from "zxing-wasm/reader/zxing_reader.wasm?url";

const FORMATS = ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "code_39", "itf"];

export interface Detector {
  detect(source: CanvasImageSource): Promise<{ rawValue: string }[]>;
}

export async function createDetector(): Promise<Detector> {
  const Native = (window as unknown as { BarcodeDetector?: { new (o: { formats: string[] }): Detector; getSupportedFormats(): Promise<string[]> } }).BarcodeDetector;
  if (Native) {
    try {
      const supported = await Native.getSupportedFormats();
      const formats = FORMATS.filter((f) => supported.includes(f));
      if (formats.includes("ean_13")) return new Native({ formats });
    } catch {
      // fall through to the WebAssembly build
    }
  }
  const { BarcodeDetector, prepareZXingModule } = await import("barcode-detector/ponyfill");
  prepareZXingModule({
    overrides: { locateFile: (path: string, prefix: string) => (path.endsWith(".wasm") ? wasmUrl : prefix + path) },
  });
  return new BarcodeDetector({ formats: FORMATS as never });
}
