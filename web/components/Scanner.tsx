// Camera barcode scanner. Lazy-loaded, so its cost is only paid on scan.
import { Flashlight, Keyboard, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createDetector } from "../lib/barcode.ts";
import { Button, Input } from "./ui.tsx";

function cameraError(err: unknown): string {
  if (!window.isSecureContext) return "The camera needs a secure (HTTPS) connection. Open Larder through its https:// address.";
  const name = (err as { name?: string })?.name;
  if (name === "NotAllowedError") return "Camera access is blocked. Allow it for this site in your browser settings, then try again.";
  if (name === "NotFoundError" || name === "OverconstrainedError") return "No camera found on this device.";
  return "Couldn't start the camera.";
}

export default function Scanner({ onDetected, onClose }: { onDetected: (code: string) => void; onClose: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [manual, setManual] = useState(false);
  const [code, setCode] = useState("");
  const [torch, setTorch] = useState<boolean | null>(null);
  const track = useRef<MediaStreamTrack | null>(null);
  const done = useRef(false);
  // Keep the latest callback without restarting the camera on every render.
  const onDetectedRef = useRef(onDetected);
  onDetectedRef.current = onDetected;

  useEffect(() => {
    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;

    (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw Object.assign(new Error("no media"), { name: "NotFoundError" });
        const [detector, s] = await Promise.all([
          createDetector(),
          navigator.mediaDevices.getUserMedia({
            video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
            audio: false,
          }),
        ]);
        stream = s;
        if (cancelled) return;
        const v = video.current!;
        v.srcObject = s;
        await v.play();
        track.current = s.getVideoTracks()[0] ?? null;
        const caps = track.current?.getCapabilities?.() as { torch?: boolean } | undefined;
        if (caps?.torch) setTorch(false);

        const tick = async () => {
          if (cancelled || done.current) return;
          try {
            if (v.readyState >= 2) {
              const found = await detector.detect(v);
              const value = found.find((b) => b.rawValue)?.rawValue;
              if (value && !done.current) {
                done.current = true;
                navigator.vibrate?.(40);
                onDetectedRef.current(value);
                return;
              }
            }
          } catch {
            // A frame can fail to decode; keep going.
          }
          timer = setTimeout(tick, 180);
        };
        void tick();
      } catch (err) {
        if (!cancelled) {
          setError(cameraError(err));
          setManual(true);
        }
      }
    })();

    return () => {
      cancelled = true;
      clearTimeout(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const toggleTorch = async () => {
    if (!track.current || torch == null) return;
    try {
      await track.current.applyConstraints({ advanced: [{ torch: !torch } as MediaTrackConstraintSet] });
      setTorch(!torch);
    } catch {
      setTorch(null);
    }
  };

  const submitManual = () => {
    const c = code.replace(/\D/g, "");
    if (c.length >= 6) onDetected(c);
  };

  return (
    <div className="fixed inset-0 z-[70] flex flex-col bg-black text-white">
      <div className="pt-safe flex items-center justify-between px-2">
        <button type="button" aria-label="Close scanner" onClick={onClose} className="flex size-12 items-center justify-center rounded-full active:bg-white/10">
          <X className="size-6" />
        </button>
        <span className="font-semibold">Scan barcode</span>
        <div className="flex">
          {torch != null && (
            <button type="button" aria-label="Torch" onClick={toggleTorch} className={`flex size-12 items-center justify-center rounded-full ${torch ? "text-yellow-300" : ""}`}>
              <Flashlight className="size-6" />
            </button>
          )}
          <button type="button" aria-label="Type barcode" onClick={() => setManual((m) => !m)} className="flex size-12 items-center justify-center rounded-full active:bg-white/10">
            <Keyboard className="size-6" />
          </button>
        </div>
      </div>

      <div className="relative min-h-0 flex-1 overflow-hidden">
        <video ref={video} playsInline muted autoPlay className="absolute inset-0 h-full w-full object-cover" />
        {!error && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="h-36 w-[78%] max-w-sm rounded-2xl border-[3px] border-white/90 shadow-[0_0_0_100vmax_rgba(0,0,0,0.45)]" />
          </div>
        )}
        {error && <p className="absolute inset-x-6 top-1/3 text-center text-[15px] text-white/90">{error}</p>}
      </div>

      <div className="pb-safe bg-black px-4 pt-3 pb-4">
        {manual ? (
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              submitManual();
            }}
          >
            <Input
              autoFocus
              inputMode="numeric"
              placeholder="Type the barcode number"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              className="border-white/20 bg-white/10 text-white"
            />
            <Button type="submit" variant="primary">
              Use
            </Button>
          </form>
        ) : (
          <p className="text-center text-sm text-white/70">Point the camera at the barcode</p>
        )}
      </div>
    </div>
  );
}
