"use client";

import { useEffect, useRef } from "react";

const CELLS = 8;
const SIZE = 72;
const PRIZE_CELL = 27;

export function Logo() {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const element = canvas.current;
    const context = element?.getContext("2d");
    if (!context) return;
    const paint = (moving: boolean) => {
      const styles = getComputedStyle(document.documentElement);
      const ink = styles.getPropertyValue("--ink").trim();
      const signal = styles.getPropertyValue("--signal").trim();
      const step = SIZE / CELLS;
      context.clearRect(0, 0, SIZE, SIZE);
      for (let index = 0; index < CELLS * CELLS; index += 1) {
        const prize = index === PRIZE_CELL;
        const noise = moving ? Math.random() : ((index * 7) % 11) / 11;
        context.globalAlpha = prize ? 1 : Math.pow(noise, 2.2);
        context.fillStyle = prize ? signal : ink;
        context.fillRect(
          (index % CELLS) * step,
          Math.floor(index / CELLS) * step,
          step - 1,
          step - 1
        );
      }
      context.globalAlpha = 1;
    };
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      paint(false);
      return;
    }
    paint(true);
    const interval = setInterval(() => paint(true), 120);
    return () => clearInterval(interval);
  }, []);
  return <canvas ref={canvas} width={SIZE} height={SIZE} aria-hidden="true" />;
}
