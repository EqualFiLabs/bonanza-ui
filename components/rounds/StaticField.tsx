"use client";

import { useEffect, useRef } from "react";

import { ticketLabel } from "@/lib/protocol/format";

export type Reveal = Readonly<{ roundId: bigint; winner: number; startedAt: number }>;

export const REVEAL_MS = 3_200;
const WINNER_SHOWS_AT = 0.82;
const FRAME_MS = 90;
const TUNE_MS = 320;

type FieldProps = Readonly<{
  ticketCount: number;
  sold: number;
  mine: readonly Readonly<{ start: number; end: number }>[];
  winner: number | null;
  accentVariable: string;
  reveal?: Reveal | null;
  tuneKey?: string;
  label?: string;
  plate?: React.RefObject<HTMLElement | null>;
}>;

const seeded = (index: number) => {
  const value = Math.sin(index * 12.9898) * 43_758.5453;
  return value - Math.floor(value);
};

function tokenColor(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function paint(
  canvas: HTMLCanvasElement,
  props: FieldProps,
  still: boolean,
  tuning: boolean,
  now: number
) {
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  if (!width || !height) return;
  if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) {
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
  }
  const context = canvas.getContext("2d");
  if (!context) return;
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, width, height);

  const ink = tokenColor("--ink");
  const line = tokenColor("--line");
  const accent = tokenColor(props.accentVariable);
  const { ticketCount, sold, reveal } = props;
  const columns = Math.max(1, Math.ceil(Math.sqrt((ticketCount * width) / height)));
  const rows = Math.ceil(ticketCount / columns);
  const step = Math.min(width / columns, height / rows);
  const gap = step >= 6 ? 1.5 : step >= 3 ? 0.75 : 0;
  const cell = step - gap;
  const offsetX = (width - columns * step) / 2;
  const offsetY = (height - rows * step) / 2;
  const owned = (index: number) =>
    props.mine.some((range) => index >= range.start && index < range.end);

  const progress = reveal ? Math.min((now - reveal.startedAt) / REVEAL_MS, 1) : 0;
  const settled = !reveal && props.winner !== null;
  const shownWinner = reveal ? (progress >= WINNER_SHOWS_AT ? reveal.winner : null) : props.winner;

  for (let index = 0; index < ticketCount; index += 1) {
    const x = offsetX + (index % columns) * step;
    const y = offsetY + Math.floor(index / columns) * step;
    if (tuning) {
      context.globalAlpha = Math.random();
      context.fillStyle = ink;
      context.fillRect(x, y, cell, cell);
      continue;
    }
    if (index >= sold) {
      context.globalAlpha = 1;
      context.fillStyle = line;
      const dot = Math.max(cell * 0.3, 0.6);
      context.fillRect(x + (cell - dot) / 2, y + (cell - dot) / 2, dot, dot);
      continue;
    }
    if (index === shownWinner) continue;
    if (reveal && index !== reveal.winner && seeded(index) < Math.pow(progress, 1.5)) continue;
    if (owned(index)) {
      context.globalAlpha = settled ? 0.55 : 1;
      context.fillStyle = accent;
      context.fillRect(x, y, cell, cell);
      continue;
    }
    context.globalAlpha = settled
      ? 0.16
      : still
        ? 0.25 + 0.6 * seeded(index)
        : 0.14 + 0.86 * Math.pow(Math.random(), 2);
    context.fillStyle = ink;
    context.fillRect(x, y, cell, cell);
  }

  if (shownWinner !== null) {
    const x = offsetX + (shownWinner % columns) * step;
    const y = offsetY + Math.floor(shownWinner / columns) * step;
    context.fillStyle = accent;
    context.globalAlpha = 0.75;
    context.fillRect(0, y + cell / 2 - 0.5, width, 1);
    context.fillRect(x + cell / 2 - 0.5, 0, 1, height);
    context.globalAlpha = 1;
    const mark = Math.max(cell, 7);
    context.fillRect(x + cell / 2 - mark / 2, y + cell / 2 - mark / 2, mark, mark);
  }
  context.globalAlpha = 1;
}

export function StaticField(props: FieldProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const latest = useRef(props);
  const tunedAt = useRef(0);

  useEffect(() => {
    latest.current = props;
  });

  useEffect(() => {
    tunedAt.current = performance.now();
  }, [props.tuneKey]);

  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let frame = 0;
    let last = 0;
    const draw = (time: number) => {
      const current = latest.current;
      if (current.plate?.current && current.reveal) {
        const done = (Date.now() - current.reveal.startedAt) / REVEAL_MS >= WINNER_SHOWS_AT;
        current.plate.current.textContent = done
          ? ticketLabel(current.reveal.winner).slice(1)
          : String(Math.floor(Math.random() * current.sold) + 1).padStart(4, "0");
      }
      const tuning = !reduced && time - tunedAt.current < TUNE_MS;
      paint(element, current, reduced, tuning, Date.now());
    };
    const loop = (time: number) => {
      if ((latest.current.reveal || time - last > FRAME_MS) && !document.hidden) {
        last = time;
        draw(time);
      }
      frame = requestAnimationFrame(loop);
    };
    if (reduced) {
      draw(performance.now());
      const interval = setInterval(() => draw(performance.now()), 500);
      return () => clearInterval(interval);
    }
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <canvas
      ref={canvas}
      role={props.label ? "img" : undefined}
      aria-label={props.label}
      aria-hidden={props.label ? undefined : true}
    />
  );
}
