import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import "./App.css";

/* ---------- tuning knobs ---------- */
const PAD = 24;                    // min gap between button and the edge of the game area
const NEAR_MOUSE = 40;             // px from the button that triggers a dodge (mouse / pen)
const NEAR_TOUCH = 56;             // bigger "danger zone" for fingers
const MIN_MOVE = 110;              // a dodge always travels at least this far
const COOLDOWN_MS = 140;           // stops proximity events from re-triggering mid-flight
const RETURN_AFTER = [3000, 6500]; // random delay (ms) before it tries to go home
const RETURN_MS = 1300;            // must match .returning transition in App.css

const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), Math.max(lo, hi));

// distance from a point to a rectangle (0 when the point is inside it)
const rectDist = (px, py, r) =>
  Math.hypot(
    Math.max(r.left - px, 0, px - r.right),
    Math.max(r.top - py, 0, py - r.bottom)
  );

export default function App() {
  const areaRef = useRef(null);
  const runnerRef = useRef(null);

  // "logical" state kept in refs so event handlers never read stale values
  const posRef = useRef({ x: 0, y: 0 });
  const modeRef = useRef("home"); // home | dodging | returning
  const lastDodge = useRef(0);
  const returnTimer = useRef(null);
  const settleTimer = useRef(null);

  // state that drives rendering
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [mode, setMode] = useState("home");
  const [tilt, setTilt] = useState(0);
  const [ready, setReady] = useState(false);
  const [dodges, setDodges] = useState(0);

  const move = useCallback((p, m) => {
    posRef.current = p;
    modeRef.current = m;
    setPos(p);
    setMode(m);
  }, []);

  /* Measure the play area + button and derive the legal bounds and home spot. */
  const measure = useCallback(() => {
    const w = areaRef.current.clientWidth;
    const h = areaRef.current.clientHeight;
    const bw = runnerRef.current.offsetWidth;
    const bh = runnerRef.current.offsetHeight;
    return {
      w, h, bw, bh,
      minX: PAD, maxX: w - bw - PAD,
      minY: PAD, maxY: h - bh - PAD,
      home: { x: (w - bw) / 2, y: (h - bh) / 2 },
    };
  }, []);

  /* ---------- automatic return ---------- */
  const goHome = useCallback(() => {
    returnTimer.current = null;
    const { home } = measure();
    setTilt(0);
    move(home, "returning");
    clearTimeout(settleTimer.current);
    settleTimer.current = setTimeout(() => {
      if (modeRef.current === "returning") {
        modeRef.current = "home";
        setMode("home");
      }
    }, RETURN_MS + 80);
  }, [measure, move]);

  // Starts a countdown to "go home" unless one is already running.
  const scheduleReturn = useCallback(() => {
    if (returnTimer.current) return;
    returnTimer.current = setTimeout(goHome, rand(RETURN_AFTER[0], RETURN_AFTER[1]));
  }, [goHome]);

  /* ---------- the dodge ---------- */
  // pointer = {x, y} relative to the game area, or null (keyboard / unknown)
  const dodge = useCallback(
    (pointer) => {
      clearTimeout(settleTimer.current);
      lastDodge.current = performance.now();

      const m = measure();
      const areaRect = areaRef.current.getBoundingClientRect();
      const r = runnerRef.current.getBoundingClientRect();
      // where the button visually is right now (it may be mid-flight)
      const from = { x: r.left - areaRect.left, y: r.top - areaRect.top };

      const px = pointer ? pointer.x : from.x + m.bw / 2;
      const py = pointer ? pointer.y : from.y + m.bh / 2;
      const reach = Math.max(MIN_MOVE + 40, Math.min(m.w, m.h) * 0.7);

      // Try several random directions/distances and pick one that lands
      // far from the pointer (plus some noise so it stays unpredictable).
      let best = null;
      let bestScore = -Infinity;
      for (let i = 0; i < 12; i++) {
        const angle = rand(0, Math.PI * 2);
        const dist = rand(MIN_MOVE, reach);
        const x = clamp(from.x + Math.cos(angle) * dist, m.minX, m.maxX);
        const y = clamp(from.y + Math.sin(angle) * dist, m.minY, m.maxY);
        if (Math.hypot(x - from.x, y - from.y) < MIN_MOVE * 0.7) continue; // squashed by a wall
        const away = Math.hypot(x + m.bw / 2 - px, y + m.bh / 2 - py);
        const score = away + rand(0, 120);
        if (score > bestScore) {
          bestScore = score;
          best = { x, y };
        }
      }
      // cornered? jump anywhere in the area
      if (!best) best = { x: rand(m.minX, m.maxX), y: rand(m.minY, m.maxY) };

      setTilt(rand(-22, 22));
      setDodges((n) => n + 1);
      move(best, "dodging");
      scheduleReturn();
    },
    [measure, move, scheduleReturn]
  );

  /* ---------- proximity detection (mouse move, touch drag, touch down) ---------- */
  const onAreaPointer = useCallback(
    (e) => {
      if (performance.now() - lastDodge.current < COOLDOWN_MS) return;

      const a = areaRef.current.getBoundingClientRect();
      const px = e.clientX - a.left;
      const py = e.clientY - a.top;
      const m = measure();

      // where the button is right now (animated) ...
      const r = runnerRef.current.getBoundingClientRect();
      const live = {
        left: r.left - a.left, top: r.top - a.top,
        right: r.right - a.left, bottom: r.bottom - a.top,
      };
      // ... and where it is heading
      const goal = {
        left: posRef.current.x, top: posRef.current.y,
        right: posRef.current.x + m.bw, bottom: posRef.current.y + m.bh,
      };

      const limit = e.pointerType === "touch" ? NEAR_TOUCH : NEAR_MOUSE;
      if (Math.min(rectDist(px, py, live), rectDist(px, py, goal)) < limit) {
        dodge({ x: px, y: py });
      }
    },
    [dodge, measure]
  );

  // Direct attempts on the button itself always dodge (no cooldown).
  const localPoint = (e) => {
    const a = areaRef.current.getBoundingClientRect();
    return { x: e.clientX - a.left, y: e.clientY - a.top };
  };
  const onEnter = (e) => dodge(localPoint(e));
  const onDown = (e) => {
    e.preventDefault();
    dodge(localPoint(e));
  };
  // Safety net: if a click ever slips through, it does nothing but dodge.
  const onClick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    dodge(null);
  };
  const onKeyDown = (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      dodge(null);
    }
  };

  /* ---------- initial placement + resize / rotation handling ---------- */
  useLayoutEffect(() => {
    const place = () => {
      const m = measure();
      const p =
        modeRef.current === "home"
          ? m.home
          : {
              x: clamp(posRef.current.x, m.minX, m.maxX),
              y: clamp(posRef.current.y, m.minY, m.maxY),
            };
      posRef.current = p;
      setPos(p);
    };
    place();
    setReady(true);
    const ro = new ResizeObserver(place);
    ro.observe(areaRef.current);
    return () => ro.disconnect();
  }, [measure]);

  useEffect(
    () => () => {
      clearTimeout(returnTimer.current);
      clearTimeout(settleTimer.current);
    },
    []
  );

  return (
    <main
      className="game"
      ref={areaRef}
      onPointerMove={onAreaPointer}
      onPointerDown={onAreaPointer}
    >
      <p className="hud" aria-live="off">
        {dodges === 0 ? "Go on, click it." : `Dodged ${dodges} ${dodges === 1 ? "time" : "times"}`}
      </p>

      <div
        ref={runnerRef}
        className={`runner ${mode}${ready ? " ready" : ""}`}
        style={{ transform: `translate3d(${pos.x}px, ${pos.y}px, 0)` }}
      >
        <button
          type="button"
          className="make-btn"
          style={{ "--tilt": `${tilt}deg` }}
          onPointerEnter={onEnter}
          onPointerDown={onDown}
          onClick={onClick}
          onKeyDown={onKeyDown}
          onContextMenu={(e) => e.preventDefault()}
        >
          Make Button
        </button>
      </div>
    </main>
  );
}
