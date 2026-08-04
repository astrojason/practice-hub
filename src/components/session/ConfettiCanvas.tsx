import { forwardRef, useImperativeHandle, useRef } from "react";

export interface ConfettiCanvasHandle {
  fire: () => void;
}

/** Full-screen canvas particle burst, hidden until `fire()` is called via ref. */
export const ConfettiCanvas = forwardRef<ConfettiCanvasHandle>(function ConfettiCanvas(_props, ref) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useImperativeHandle(ref, () => ({
    fire() {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      canvas.style.display = "block";

      const colors = ["#ff6b6b", "#feca57", "#48dbfb", "#ff9ff3", "#54a0ff", "#5f27cd"];
      const particles = Array.from({ length: 120 }, () => ({
        x: Math.random() * canvas.width,
        y: -10,
        r: 4 + Math.random() * 6,
        color: colors[Math.floor(Math.random() * colors.length)],
        vx: (Math.random() - 0.5) * 4,
        vy: 2 + Math.random() * 4,
        alpha: 1,
      }));

      let frame = 0;
      function tick() {
        if (!ctx || !canvas) return;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        for (const p of particles) {
          p.x += p.vx;
          p.y += p.vy;
          p.vy += 0.1; // gravity
          p.alpha -= 0.008;
          ctx.globalAlpha = Math.max(0, p.alpha);
          ctx.fillStyle = p.color;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
        frame++;
        if (frame < 180) requestAnimationFrame(tick);
        else canvas.style.display = "none";
      }
      requestAnimationFrame(tick);
    },
  }));

  return <canvas ref={canvasRef} className="confetti-canvas" style={{ display: "none" }} />;
});
