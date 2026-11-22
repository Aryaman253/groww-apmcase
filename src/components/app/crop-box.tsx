"use client";
import { useRef } from "react";

export type Crop = { x: number; y: number; width: number; height: number };

/** Optional crop: drag on the image to select a rectangle (fractions of the image). */
export function CropBox({ src, value, onChange, alt }: { src: string; value: Crop | null; onChange: (c: Crop | null) => void; alt: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const pos = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) };
  };
  return (
    <div
      ref={ref}
      className="relative touch-none overflow-hidden rounded-xl border select-none"
      onPointerDown={(e) => {
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
        start.current = pos(e);
        onChange(null);
      }}
      onPointerMove={(e) => {
        if (!start.current) return;
        const p = pos(e);
        const s = start.current;
        onChange({ x: Math.min(s.x, p.x), y: Math.min(s.y, p.y), width: Math.abs(p.x - s.x), height: Math.abs(p.y - s.y) });
      }}
      onPointerUp={() => {
        start.current = null;
        if (value && (value.width < 0.05 || value.height < 0.05)) onChange(null);
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt={alt} className="block max-h-[50dvh] w-full object-contain" draggable={false} />
      {value ? (
        <div
          className="pointer-events-none absolute border-2 border-brand bg-brand/10"
          style={{ left: `${value.x * 100}%`, top: `${value.y * 100}%`, width: `${value.width * 100}%`, height: `${value.height * 100}%` }}
        />
      ) : null}
    </div>
  );
}
