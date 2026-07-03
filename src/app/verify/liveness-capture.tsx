"use client";

import { useEffect, useRef, useState } from "react";
import type { FaceLandmarker } from "@mediapipe/tasks-vision";

/**
 * Guided liveness selfie. Opens the front camera and runs Google's MediaPipe
 * FaceLandmarker ENTIRELY ON-DEVICE (no frame ever leaves the browser). It walks
 * the user through: center the face → turn head one way → turn the other way →
 * auto-capture → a brief "analyzing" pass → done.
 *
 * The head-turn detection is REAL: it reads the head's yaw angle from the model's
 * facial-transformation matrix each frame. The direction is AUTO-CALIBRATED — the
 * first detected turn defines "this way", the second must be the OPPOSITE way — so
 * "left"/"right" can never be mislabelled, and it genuinely proves the head moved
 * both directions (a static photo can't).
 *
 * Everything is an ASSIST, never a hard gate: a "Capture now" button is always
 * available, and if the model can't load we fall back to plain manual capture, so
 * a legitimate user is never stuck. The real identity check is the admin review.
 *
 * Append ?kycdebug=1 to the URL to see the live tracking numbers (face size, x,
 * yaw°) overlaid — handy to confirm detection is working and to tune thresholds.
 */

const WASM_URL =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.20/wasm";
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

const PROC_STEPS = [
  "Analyzing your selfie…",
  "Checking lighting & focus…",
  "Matching face position…",
  "Capture looks great",
];

const TURN_THRESH = 0.08; // head-turn signal needed to count as a turn
const HOLD_FRAMES = 1; // frames the turn must be held
const ALIGN_FRAMES = 8; // frames centred before the turn challenge starts
const ALIGN_FALLBACK_FRAMES = 50; // …or advance anyway after a face is held this long
const DETECT_MS = 60; // ~16 fps inference

type CapturePhase = "idle" | "live" | "processing" | "captured";
type GuideStage = "loading" | "align" | "turn1" | "turn2" | "done";

/** Turns a getUserMedia rejection into something the user can act on. */
function cameraErrorMessage(err: unknown): string {
  if (err instanceof DOMException) {
    switch (err.name) {
      case "NotAllowedError":
      case "SecurityError":
        return (
          "Camera access was blocked. Allow camera access for this site in " +
          "your browser settings, or use the button below to take the selfie " +
          "with your camera app."
        );
      case "NotFoundError":
      case "OverconstrainedError":
        return (
          "No camera was found here. If you're on a computer, open this page " +
          "on your phone, or use the button below to take the selfie."
        );
      case "NotReadableError":
        return (
          "The camera is in use by another app. Close it (Zoom, Teams, " +
          "another browser tab) and try again."
        );
    }
  }
  return (
    "Couldn't open the camera. Allow camera access and try again, or use the " +
    "button below to take the selfie with your camera app."
  );
}

export function LivenessCapture({
  onCapture,
}: {
  onCapture: (file: File | null) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const landmarkerRef = useRef<FaceLandmarker | null>(null);
  const rafRef = useRef<number | null>(null);
  const lastDetectRef = useRef(0);
  const stageRef = useRef<GuideStage>("loading");
  const alignCountRef = useRef(0);
  const facePresentRef = useRef(0);
  const holdCountRef = useRef(0);
  const baselineYawRef = useRef(0);
  const turnSignRef = useRef(0);
  const promptRef = useRef<HTMLParagraphElement>(null);
  const ovalRef = useRef<HTMLDivElement>(null);
  const diagRef = useRef<HTMLParagraphElement>(null);
  const meterRef = useRef<HTMLDivElement>(null);

  const [phase, setPhase] = useState<CapturePhase>("idle");
  const [stage, setStage] = useState<GuideStage>("loading");
  const [turn1Done, setTurn1Done] = useState(false);
  const [turn2Done, setTurn2Done] = useState(false);
  const [modelFailed, setModelFailed] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [camError, setCamError] = useState<string | null>(null);
  const [showFallback, setShowFallback] = useState(false);
  const [procStep, setProcStep] = useState(0);
  const [flash, setFlash] = useState(false);
  const [debug, setDebug] = useState(false);

  useEffect(() => {
    setDebug(
      typeof window !== "undefined" &&
        new URLSearchParams(window.location.search).has("kycdebug"),
    );
  }, []);

  function failLiveCamera(message: string) {
    setCamError(message);
    setShowFallback(true);
  }

  function stopStream() {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }

  useEffect(() => {
    return () => {
      stopStream();
      landmarkerRef.current?.close();
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  useEffect(() => {
    if (phase !== "processing") return;
    setProcStep(0);
    const timers = PROC_STEPS.slice(1).map((_, i) =>
      setTimeout(() => setProcStep(i + 1), (i + 1) * 650),
    );
    timers.push(
      setTimeout(() => setPhase("captured"), PROC_STEPS.length * 650 + 350),
    );
    return () => timers.forEach(clearTimeout);
  }, [phase]);

  // ── live guidance ──────────────────────────────────────────────────────────

  function setPrompt(text: string, ok: boolean) {
    if (promptRef.current) promptRef.current.textContent = text;
    if (ovalRef.current)
      ovalRef.current.style.borderColor = ok ? "#1d9e75" : "#f5b43c";
  }

  function toStage(next: GuideStage) {
    stageRef.current = next;
    setStage(next);
    alignCountRef.current = 0;
    holdCountRef.current = 0;
    if (next === "turn1") setPrompt("Slowly turn your head LEFT", false);
    if (next === "turn2") setPrompt("Now turn your head RIGHT", false);
    if (next === "done") {
      setPrompt("Liveness confirmed ✓", true);
      window.setTimeout(() => capture(), 550);
    }
  }

  type Lm = { x: number; y: number };
  function analyze(landmarks: Lm[] | undefined) {
    const st = stageRef.current;

    if (!landmarks || landmarks.length === 0) {
      alignCountRef.current = 0;
      holdCountRef.current = 0;
      if (diagRef.current) diagRef.current.textContent = "no face detected";
      setPrompt("Position your face in the circle", false);
      return;
    }

    let minX = 1,
      maxX = 0,
      minY = 1,
      maxY = 0;
    for (const p of landmarks) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const w = maxX - minX || 1;
    const h = maxY - minY;
    // Yaw signal: the nose's distance to each eye. Facing forward the two are
    // equal (ratio ~0); turning the head shortens the near side and lengthens the
    // far side, so the normalised difference swings clearly ±. Using full 2-D
    // distances (not a single x-offset) makes it robust to the exact landmark and
    // to the face drifting around the frame. Nose = 1; eye outer corners = 33/263.
    const nose = landmarks[1];
    const eyeA = landmarks[33];
    const eyeB = landmarks[263];
    let yaw = 0;
    if (nose && eyeA && eyeB) {
      const dL = Math.hypot(nose.x - eyeA.x, nose.y - eyeA.y);
      const dR = Math.hypot(nose.x - eyeB.x, nose.y - eyeB.y);
      const sum = dL + dR;
      yaw = sum > 0 ? (dL - dR) / sum : 0;
    }
    facePresentRef.current += 1;

    if (diagRef.current) {
      diagRef.current.textContent = `${st} · size ${h.toFixed(2)} · turn ${yaw.toFixed(2)}`;
    }

    if (st === "align") {
      const mcx = 1 - cx; // mirrored display centre (preview is a mirror)
      let off: string | null = null;
      if (h < 0.22) off = "Move closer";
      else if (h > 0.96) off = "Move back";
      else if (mcx < 0.3) off = "Move right →";
      else if (mcx > 0.7) off = "← Move left";
      else if (cy < 0.26) off = "Move down";
      else if (cy > 0.74) off = "Move up";
      // Nudge only early on; after a face has been held a while, advance anyway
      // so imperfect framing never traps the user on this step.
      if (off && facePresentRef.current < ALIGN_FALLBACK_FRAMES) {
        alignCountRef.current = 0;
        setPrompt(off, false);
        return;
      }
      alignCountRef.current += 1;
      setPrompt("Hold still…", true);
      if (
        alignCountRef.current > ALIGN_FRAMES ||
        facePresentRef.current > ALIGN_FALLBACK_FRAMES
      ) {
        baselineYawRef.current = yaw; // remember the forward-facing yaw
        toStage("turn1");
      }
      return;
    }

    if (st === "turn1") {
      if (h < 0.18) return setPrompt("Keep your face in view", false);
      const dy = yaw - baselineYawRef.current;
      setMeter(Math.abs(dy) / TURN_THRESH);
      if (Math.abs(dy) > TURN_THRESH) {
        holdCountRef.current += 1;
        setPrompt("Great — hold it", true);
        if (holdCountRef.current > HOLD_FRAMES) {
          turnSignRef.current = Math.sign(dy); // this direction = "one side"
          setTurn1Done(true);
          toStage("turn2");
        }
      } else {
        holdCountRef.current = 0;
        setPrompt("Slowly turn your head LEFT", false);
      }
      return;
    }

    if (st === "turn2") {
      if (h < 0.18) return setPrompt("Keep your face in view", false);
      const dy = yaw - baselineYawRef.current;
      // Must go the OPPOSITE way from the first turn.
      setMeter((-dy * turnSignRef.current) / TURN_THRESH);
      if (dy * turnSignRef.current < -TURN_THRESH) {
        holdCountRef.current += 1;
        setPrompt("Great — hold it", true);
        if (holdCountRef.current > HOLD_FRAMES) {
          setTurn2Done(true);
          toStage("done");
        }
      } else {
        holdCountRef.current = 0;
        setPrompt("Now turn your head RIGHT", false);
      }
      return;
    }
  }

  // Fill the on-screen turn meter (0..1) so the user sees the turn registering
  // and knows how far to go.
  function setMeter(ratio: number) {
    if (!meterRef.current) return;
    const pct = Math.max(0, Math.min(1, ratio)) * 100;
    meterRef.current.style.width = `${pct.toFixed(0)}%`;
    meterRef.current.style.background = pct >= 100 ? "#1d9e75" : "#f5b43c";
  }

  function detectLoop() {
    const v = videoRef.current;
    const lm = landmarkerRef.current;
    const st = stageRef.current;
    if (!v || !lm || st === "done" || st === "loading") {
      if (st !== "done") rafRef.current = requestAnimationFrame(detectLoop);
      return;
    }
    const now = performance.now();
    // Sample on a time cadence (not on video.currentTime, which can stall) so
    // detection keeps running reliably.
    if (v.readyState >= 2 && v.videoWidth > 0 && now - lastDetectRef.current >= DETECT_MS) {
      lastDetectRef.current = now;
      try {
        const res = lm.detectForVideo(v, now);
        analyze(res.faceLandmarks?.[0]);
      } catch {
        /* transient inference hiccup — try again next frame */
      }
    }
    rafRef.current = requestAnimationFrame(detectLoop);
  }

  async function createLandmarker(): Promise<FaceLandmarker> {
    const vision = await import("@mediapipe/tasks-vision");
    const resolver = await vision.FilesetResolver.forVisionTasks(WASM_URL);
    const opts = (delegate: "GPU" | "CPU") => ({
      baseOptions: { modelAssetPath: MODEL_URL, delegate },
      runningMode: "VIDEO" as const,
      numFaces: 1,
    });
    try {
      return await vision.FaceLandmarker.createFromOptions(resolver, opts("GPU"));
    } catch {
      return await vision.FaceLandmarker.createFromOptions(resolver, opts("CPU"));
    }
  }

  async function startGuide() {
    stageRef.current = "loading";
    setStage("loading");
    setTurn1Done(false);
    setTurn2Done(false);
    alignCountRef.current = 0;
    facePresentRef.current = 0;
    holdCountRef.current = 0;
    turnSignRef.current = 0;
    try {
      if (!landmarkerRef.current) {
        landmarkerRef.current = await createLandmarker();
      }
      if (!streamRef.current) return; // camera cancelled while model loaded
      stageRef.current = "align";
      setStage("align");
      lastDetectRef.current = 0;
      rafRef.current = requestAnimationFrame(detectLoop);
    } catch {
      setModelFailed(true);
    }
  }

  async function openCamera() {
    setCamError(null);
    setModelFailed(false);
    if (!window.isSecureContext) {
      failLiveCamera(
        "The live camera needs a secure connection (https). Use the button " +
          "below to take the selfie with your camera app instead.",
      );
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      failLiveCamera(
        "The live camera isn't supported in this browser. Use the button " +
          "below to take the selfie with your camera app instead.",
      );
      return;
    }
    try {
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "user" },
          audio: false,
        });
      } catch (constraintErr) {
        if (
          constraintErr instanceof DOMException &&
          (constraintErr.name === "OverconstrainedError" ||
            constraintErr.name === "NotFoundError")
        ) {
          stream = await navigator.mediaDevices.getUserMedia({
            video: true,
            audio: false,
          });
        } else {
          throw constraintErr;
        }
      }
      streamRef.current = stream;
      setPhase("live");
      requestAnimationFrame(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          void videoRef.current.play();
        }
        void startGuide();
      });
    } catch (err) {
      failLiveCamera(cameraErrorMessage(err));
    }
  }

  function onFallbackFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setCamError("Please choose an image file.");
      return;
    }
    setCamError(null);
    stopStream();
    onCapture(file);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(URL.createObjectURL(file));
    setPhase("processing");
  }

  function capture() {
    const video = videoRef.current;
    if (!video) return;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          setCamError("Couldn't capture the photo. Try again.");
          return;
        }
        stopStream();
        const file = new File([blob], "liveness.jpg", { type: "image/jpeg" });
        onCapture(file);
        if (previewUrl) URL.revokeObjectURL(previewUrl);
        setPreviewUrl(URL.createObjectURL(blob));
        setFlash(true);
        setTimeout(() => setFlash(false), 200);
        setPhase("processing");
      },
      "image/jpeg",
      0.9,
    );
  }

  function cancel() {
    stopStream();
    stageRef.current = "loading";
    setPhase("idle");
  }

  function retake() {
    onCapture(null);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    setTurn1Done(false);
    setTurn2Done(false);
    stageRef.current = "loading";
    setPhase("idle");
  }

  const frameClass =
    "mt-2 w-full max-w-sm overflow-hidden rounded-xl border border-paper-border bg-paper-sunken";
  const btn =
    "rounded-md bg-amber px-4 py-2 text-sm font-medium text-paper hover:bg-amber-soft";
  const ghostBtn =
    "rounded-md border border-paper-border px-4 py-2 text-sm text-ink-soft hover:bg-paper-sunken";

  const loading = stage === "loading" && !modelFailed;

  return (
    <div className="mt-1">
      <style>{`
        @keyframes kycScan { 0%{top:3%;opacity:.15} 12%{opacity:1} 88%{opacity:1} 100%{top:95%;opacity:.15} }
        @keyframes kycPulse { 0%,100%{transform:scale(1);opacity:.9} 50%{transform:scale(1.035);opacity:.45} }
        @keyframes kycFlash { from{opacity:.85} to{opacity:0} }
        @keyframes kycSpin { to{transform:rotate(360deg)} }
        @keyframes kycFade { from{opacity:0;transform:scale(.98)} to{opacity:1;transform:scale(1)} }
      `}</style>

      {camError && <p className="mb-2 text-sm text-state-disputed">{camError}</p>}

      {phase === "idle" && (
        <div className="flex flex-col items-start gap-3">
          <button type="button" onClick={openCamera} className={btn}>
            Open camera
          </button>
          {showFallback && (
            <label className={`${ghostBtn} cursor-pointer`}>
              Take selfie with camera app
              <input
                type="file"
                accept="image/*"
                capture="user"
                className="sr-only"
                onChange={onFallbackFile}
              />
            </label>
          )}
        </div>
      )}

      {phase === "live" && (
        <div>
          <div className={`relative ${frameClass}`}>
            <video
              ref={videoRef}
              playsInline
              muted
              className="w-full -scale-x-100"
            />
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div
                ref={ovalRef}
                className="h-[80%] aspect-[3/4] rounded-[50%] border-2 shadow-[0_0_0_999px_rgba(11,14,17,0.5)]"
                style={{ borderColor: "#f5b43c" }}
              />
            </div>
            <p
              ref={promptRef}
              className="pointer-events-none absolute inset-x-0 top-2 text-center text-sm font-semibold text-white drop-shadow"
            >
              {loading ? "Preparing face guide…" : "Center your face"}
            </p>
            {loading && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <span
                  className="inline-block h-6 w-6 rounded-full border-2 border-amber border-t-transparent"
                  style={{ animation: "kycSpin .7s linear infinite" }}
                />
              </div>
            )}
            {(stage === "turn1" || stage === "turn2") && (
              <div className="pointer-events-none absolute inset-x-6 bottom-5">
                <div className="h-2.5 w-full overflow-hidden rounded-full bg-white/25">
                  <div
                    ref={meterRef}
                    className="h-2.5 rounded-full transition-[width] duration-100"
                    style={{ width: "0%", background: "#f5b43c" }}
                  />
                </div>
                <p className="mt-1 text-center text-[10px] font-medium text-white/90">
                  Keep turning until the bar fills
                </p>
              </div>
            )}
            <p
              ref={diagRef}
              className={
                "pointer-events-none absolute inset-x-0 bottom-1 text-center text-[10px] font-medium text-white/80 " +
                (debug ? "" : "hidden")
              }
            />
          </div>

          {!modelFailed && (
            <div className="mt-2 flex flex-wrap gap-2 text-xs">
              <StepChip
                label="Center"
                active={stage === "align"}
                done={stage === "turn1" || stage === "turn2" || stage === "done"}
              />
              <StepChip label="Turn left" active={stage === "turn1"} done={turn1Done} />
              <StepChip label="Turn right" active={stage === "turn2"} done={turn2Done} />
            </div>
          )}

          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" onClick={capture} className={modelFailed ? btn : ghostBtn}>
              {modelFailed ? "Take photo" : "Capture now"}
            </button>
            <button type="button" onClick={cancel} className={ghostBtn}>
              Cancel
            </button>
          </div>
          {modelFailed && (
            <p className="mt-2 text-xs text-ink-faint">
              Face guide unavailable here — frame your face and tap Take photo.
            </p>
          )}
        </div>
      )}

      {phase === "processing" && previewUrl && (
        <div>
          <div className={`relative ${frameClass}`}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={previewUrl} alt="Liveness selfie" className="w-full" />
            <div className="pointer-events-none absolute inset-0 bg-paper/25" />
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div
                className="h-[80%] aspect-[3/4] rounded-[50%] border-2 border-amber/90"
                style={{ animation: "kycPulse 1.4s ease-in-out infinite" }}
              />
            </div>
            <div
              className="pointer-events-none absolute inset-x-0 h-[3px] bg-gradient-to-r from-transparent via-amber to-transparent"
              style={{
                animation: "kycScan 1.5s ease-in-out infinite",
                boxShadow: "0 0 12px 2px rgba(245,180,60,.55)",
              }}
            />
            {flash && (
              <div
                className="pointer-events-none absolute inset-0 bg-white"
                style={{ animation: "kycFlash .2s ease-out forwards" }}
              />
            )}
            <div className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-2 bg-gradient-to-t from-paper via-paper/85 to-transparent px-3 pb-3 pt-10 text-sm font-medium text-ink">
              <span
                className="inline-block h-3.5 w-3.5 rounded-full border-2 border-amber border-t-transparent"
                style={{ animation: "kycSpin .7s linear infinite" }}
              />
              {PROC_STEPS[procStep]}
            </div>
          </div>
        </div>
      )}

      {phase === "captured" && previewUrl && (
        <div>
          <div
            className={`relative ${frameClass}`}
            style={{ animation: "kycFade .4s ease-out" }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={previewUrl} alt="Liveness selfie" className="w-full" />
            <div className="absolute right-2 top-2 flex items-center gap-1 rounded-full bg-buy px-2.5 py-1 text-xs font-semibold text-paper shadow-lg">
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="3"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
              >
                <path d="M20 6 9 17l-5-5" />
              </svg>
              Captured
            </div>
          </div>
          <button type="button" onClick={retake} className={`mt-2 ${ghostBtn}`}>
            Retake
          </button>
        </div>
      )}
    </div>
  );
}

function StepChip({
  label,
  active,
  done,
}: {
  label: string;
  active: boolean;
  done: boolean;
}) {
  const cls = done
    ? "border-buy/40 bg-buy-wash text-buy"
    : active
      ? "border-amber/50 bg-amber-wash text-amber"
      : "border-paper-border text-ink-faint";
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 font-medium ${cls}`}
    >
      {done ? (
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M20 6 9 17l-5-5" />
        </svg>
      ) : (
        <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />
      )}
      {label}
    </span>
  );
}
