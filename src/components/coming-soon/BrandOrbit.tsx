"use client";

/**
 * The coming-soon composition: the Zunia mark at the centre of concentric
 * rings, with brand chevrons travelling slow orbits around it.
 *
 * Three layers drift a few pixels against the pointer over `targetRef`
 * (deeper layers move more), written straight to `style.transform` in one
 * animation frame per pointer move, so React never re-renders for it. Mouse
 * only; nothing moves under prefers-reduced-motion (the CSS stops the orbits,
 * the effect below never attaches).
 */

import { useEffect, useId, useRef, type RefObject } from "react";
import { useReducedMotion } from "@/components/ui";
import { ZuniaMark } from "@/components/landing/ZuniaMark";
import { cn } from "@/lib/cn";
import styles from "./coming-soon.module.css";

/** How far each layer travels at the edge of the target, px. */
const DEPTHS = [5, 14, 3] as const;

/** A brand chevron (the mark's double stroke) flying along an orbit. */
function Chevron({ symbol, x, y, size, angle, opacity = 1 }: { symbol: string; x: number; y: number; size: number; angle: number; opacity?: number }) {
  const height = (size * 120) / 96;
  return (
    <use
      href={`#${symbol}`}
      x={-size / 2}
      y={-height / 2}
      width={size}
      height={height}
      transform={`translate(${x} ${y}) rotate(${angle})`}
      opacity={opacity}
    />
  );
}

export function BrandOrbit({ targetRef, className }: { targetRef: RefObject<HTMLElement | null>; className?: string }) {
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const reduced = useReducedMotion();
  const ringsRef = useRef<HTMLDivElement>(null);
  const orbitsRef = useRef<HTMLDivElement>(null);
  const markRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const target = targetRef.current;
    if (!target || reduced) return;
    const layers = [ringsRef.current, orbitsRef.current, markRef.current];
    let frame = 0;
    const move = (x: number, y: number) => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        layers.forEach((layer, index) => {
          if (layer) layer.style.transform = `translate3d(${(x * DEPTHS[index]).toFixed(2)}px, ${(y * DEPTHS[index]).toFixed(2)}px, 0)`;
        });
      });
    };
    const onMove = (event: PointerEvent) => {
      if (event.pointerType !== "mouse") return;
      const rect = target.getBoundingClientRect();
      move(((event.clientX - rect.left) / rect.width) * 2 - 1, ((event.clientY - rect.top) / rect.height) * 2 - 1);
    };
    const onLeave = () => move(0, 0);
    target.addEventListener("pointermove", onMove);
    target.addEventListener("pointerleave", onLeave);
    return () => {
      cancelAnimationFrame(frame);
      target.removeEventListener("pointermove", onMove);
      target.removeEventListener("pointerleave", onLeave);
    };
  }, [targetRef, reduced]);

  const upper = `${id}-upper`;
  const lower = `${id}-lower`;
  const ring = `${id}-ring`;
  const chevron = `${id}-chevron`;
  return (
    <div aria-hidden className={cn(styles.stage, className)}>
      {/* Rings */}
      <div ref={ringsRef} className={styles.layer}>
        <svg viewBox="0 0 400 400">
          <defs>
            <linearGradient id={ring} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#FF1B0C" />
              <stop offset="0.5" stopColor="#FF6A10" />
              <stop offset="1" stopColor="#FFC414" />
            </linearGradient>
          </defs>
          <circle cx="200" cy="200" r="194" fill="none" stroke="currentColor" strokeOpacity="0.07" />
          <g className={cn(styles.spin, styles.spinSlow)}>
            <circle cx="200" cy="200" r="158" fill="none" stroke="currentColor" strokeOpacity="0.16" strokeDasharray="2 7" strokeLinecap="round" />
          </g>
          <circle cx="200" cy="200" r="120" fill="none" stroke="currentColor" strokeOpacity="0.1" />
          <g className={cn(styles.spin, styles.reverse)}>
            <circle cx="200" cy="200" r="82" fill="none" stroke={`url(#${ring})`} strokeOpacity="0.6" strokeWidth="1.5" strokeDasharray="120 400" strokeLinecap="round" />
          </g>
        </svg>
      </div>

      {/* Orbits */}
      <div ref={orbitsRef} className={styles.layer}>
        <svg viewBox="0 0 400 400">
          <defs>
            <linearGradient id={upper} x1="0.1" y1="0" x2="0.95" y2="0.9">
              <stop offset="0" stopColor="#FF1B0C" />
              <stop offset="0.55" stopColor="#FF4E12" />
              <stop offset="1" stopColor="#FF8A17" />
            </linearGradient>
            <linearGradient id={lower} x1="0.1" y1="1" x2="0.95" y2="0.1">
              <stop offset="0" stopColor="#FF9A05" />
              <stop offset="0.55" stopColor="#FFBE14" />
              <stop offset="1" stopColor="#FFE05C" />
            </linearGradient>
            <symbol id={chevron} viewBox="0 0 96 120">
              <path d="M26 20 L70 46 L26 72" fill="none" stroke={`url(#${upper})`} strokeWidth="24" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M26 48 L70 74 L26 100" fill="none" stroke={`url(#${lower})`} strokeWidth="24" strokeLinecap="round" strokeLinejoin="round" />
            </symbol>
          </defs>
          {/* Clockwise orbits point their chevrons down the path (90°), the
              reverse one up it (−90°): they fly, rather than spin. */}
          <g className={styles.spin}>
            <Chevron symbol={chevron} x={320} y={200} size={22} angle={90} />
            <Chevron symbol={chevron} x={80} y={200} size={14} angle={-90} opacity={0.55} />
            <circle cx="200" cy="80" r="2.5" fill="currentColor" fillOpacity="0.35" />
          </g>
          <g className={cn(styles.spin, styles.spinFast, styles.reverse)}>
            <Chevron symbol={chevron} x={241} y={271} size={15} angle={-30} />
            <circle cx="118" cy="200" r="2" fill="currentColor" fillOpacity="0.3" />
          </g>
          <g className={cn(styles.spin, styles.spinSlow)}>
            <Chevron symbol={chevron} x={88} y={88} size={18} angle={-45} opacity={0.8} />
            <circle cx="358" cy="200" r="2.5" fill="currentColor" fillOpacity="0.25" />
            <circle cx="200" cy="394" r="2" fill="currentColor" fillOpacity="0.2" />
          </g>
        </svg>
      </div>

      {/* The mark */}
      <div ref={markRef} className={styles.layer}>
        <span className={cn(styles.glow, "zunia-gate-glow")} />
        <span className={cn(styles.pulse, "zunia-gate-ring")} />
        <span className={cn(styles.pulse, "zunia-gate-ring zunia-gate-ring--late")} />
        <span className={styles.core}>
          <ZuniaMark id={`${id}-mark`} size={46} className="h-auto w-[40%]" />
        </span>
      </div>
    </div>
  );
}
