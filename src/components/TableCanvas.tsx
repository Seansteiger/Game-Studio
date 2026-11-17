import { useEffect, useRef } from 'react';
import {
  BezierFlightPool,
  CameraTrauma,
  FIXED_DT,
} from '../studio/core/springPhysics';

export interface TableCanvasProps {
  shuffleTriggerKey: number;
  roundDealTriggerKey: number;
  capturePulseKey: number;
  sweepTriggerKey: number;
  activeDragPoint: { x: number; y: number } | null;
  handOriginPoint: { x: number; y: number } | null;
}

interface ShockwaveRing {
  active: boolean;
  x: number;
  y: number;
  radius: number;
  maxRadius: number;
  progress: number;
  duration: number;
  delay: number;
  lineWidth: number;
  variant: 'gold' | 'emerald';
  octagonal: boolean;
}

const SHOCKWAVE_POOL_SIZE = 16;
const CARD_MINI_W = 38;
const CARD_MINI_H = 54;

function drawRoundedRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
): void {
  const radius = Math.min(r, w * 0.5, h * 0.5);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

function drawMiniCardBack(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  w: number,
  h: number,
  rotRad: number,
  scale: number
): void {
  ctx.save();
  ctx.translate(cx, cy);
  if (rotRad !== 0) ctx.rotate(rotRad);
  if (scale !== 1) ctx.scale(scale, scale);

  const hw = w * 0.5;
  const hh = h * 0.5;

  // Soft cast shadow
  ctx.fillStyle = 'rgba(0, 0, 0, 0.42)';
  drawRoundedRectPath(ctx, -hw + 1.5, -hh + 2.5, w, h, 4);
  ctx.fill();

  // Warm ivory rim
  ctx.fillStyle = '#f2ebdc';
  ctx.strokeStyle = '#d4c8af';
  ctx.lineWidth = 0.8;
  drawRoundedRectPath(ctx, -hw, -hh, w, h, 4);
  ctx.fill();
  ctx.stroke();

  // Mahogany inner back
  ctx.fillStyle = '#4e1414';
  drawRoundedRectPath(ctx, -hw + 2.5, -hh + 2.5, w - 5, h - 5, 2.5);
  ctx.fill();

  // Burnished gold filigree border
  ctx.strokeStyle = '#c89d54';
  ctx.lineWidth = 0.85;
  drawRoundedRectPath(ctx, -hw + 4, -hh + 4, w - 8, h - 8, 1.8);
  ctx.stroke();

  // Geometric center diamond emblem
  ctx.beginPath();
  ctx.moveTo(0, -8);
  ctx.lineTo(6, 0);
  ctx.lineTo(0, 8);
  ctx.lineTo(-6, 0);
  ctx.closePath();
  ctx.fillStyle = 'rgba(200, 157, 84, 0.25)';
  ctx.fill();
  ctx.stroke();

  ctx.restore();
}

function drawMiniCardFace(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  w: number,
  h: number,
  rotRad: number,
  scale: number,
  label: string,
  isRed: boolean
): void {
  ctx.save();
  ctx.translate(cx, cy);
  if (rotRad !== 0) ctx.rotate(rotRad);
  if (scale !== 1) ctx.scale(scale, scale);

  const hw = w * 0.5;
  const hh = h * 0.5;

  ctx.fillStyle = 'rgba(0, 0, 0, 0.44)';
  drawRoundedRectPath(ctx, -hw + 2, -hh + 3, w, h, 4);
  ctx.fill();

  ctx.fillStyle = '#fbf8f1';
  ctx.strokeStyle = '#d9cfb9';
  ctx.lineWidth = 0.9;
  drawRoundedRectPath(ctx, -hw, -hh, w, h, 4);
  ctx.fill();
  ctx.stroke();

  if (label) {
    ctx.fillStyle = isRed ? '#a91d24' : '#181a1f';
    ctx.font = '700 10px "JetBrains Mono", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, 0, 0);
  }

  ctx.restore();
}

function buildBaizePattern(ctx: CanvasRenderingContext2D): CanvasPattern | null {
  const tile = document.createElement('canvas');
  tile.width = 48;
  tile.height = 48;
  const tctx = tile.getContext('2d');
  if (!tctx) return null;

  tctx.clearRect(0, 0, 48, 48);
  tctx.strokeStyle = 'rgba(255, 255, 255, 0.045)';
  tctx.lineWidth = 1;

  // Deterministic woven wool diagonal twill lines
  for (let i = -48; i < 96; i += 6) {
    tctx.beginPath();
    tctx.moveTo(i, 0);
    tctx.lineTo(i + 48, 48);
    tctx.stroke();
  }

  tctx.strokeStyle = 'rgba(0, 0, 0, 0.08)';
  for (let i = -48; i < 96; i += 6) {
    tctx.beginPath();
    tctx.moveTo(i + 48, 0);
    tctx.lineTo(i, 48);
    tctx.stroke();
  }

  return ctx.createPattern(tile, 'repeat');
}

function paintStaticTableLayer(
  offscreen: HTMLCanvasElement,
  width: number,
  height: number,
  dpr: number,
  baizePattern: CanvasPattern | null
): void {
  offscreen.width = Math.max(1, Math.floor(width * dpr));
  offscreen.height = Math.max(1, Math.floor(height * dpr));
  const ctx = offscreen.getContext('2d');
  if (!ctx) return;

  ctx.save();
  ctx.scale(dpr, dpr);

  // 1. Deep walnut outer rim background
  const walnutGrad = ctx.createRadialGradient(
    width * 0.5,
    height * 0.48,
    Math.min(width, height) * 0.25,
    width * 0.5,
    height * 0.5,
    Math.max(width, height) * 0.72
  );
  walnutGrad.addColorStop(0, '#2b1b12');
  walnutGrad.addColorStop(0.75, '#1e130c');
  walnutGrad.addColorStop(1, '#120b07');
  ctx.fillStyle = walnutGrad;
  ctx.fillRect(0, 0, width, height);

  // 2. Outer padded walnut rail shadow & inset brass rim
  const padX = Math.max(18, width * 0.026);
  const padY = Math.max(16, height * 0.028);
  const rx = Math.max(120, width * 0.5 - padX);
  const ry = Math.max(90, height * 0.5 - padY);
  const cx = width * 0.5;
  const cy = height * 0.5;

  // Walnut rail bevel highlight
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx + 5, ry + 5, 0, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(200, 157, 84, 0.16)';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.restore();

  // 3. Dark emerald-slate baize felt surface (#0b291e -> #061811)
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
  ctx.clip();

  const feltGrad = ctx.createRadialGradient(
    cx,
    cy * 0.88,
    Math.min(rx, ry) * 0.1,
    cx,
    cy,
    Math.max(rx, ry) * 1.02
  );
  feltGrad.addColorStop(0, '#0f3628');
  feltGrad.addColorStop(0.45, '#0b291e');
  feltGrad.addColorStop(0.84, '#082017');
  feltGrad.addColorStop(1, '#061811');
  ctx.fillStyle = feltGrad;
  ctx.fillRect(0, 0, width, height);

  // Woven baize twill grain
  if (baizePattern) {
    ctx.fillStyle = baizePattern;
    ctx.fillRect(0, 0, width, height);
  }

  // Warm radial overhead lamp light
  const lampGrad = ctx.createRadialGradient(
    cx,
    cy * 0.82,
    12,
    cx,
    cy * 0.85,
    Math.max(rx, ry) * 0.72
  );
  lampGrad.addColorStop(0, 'rgba(250, 228, 178, 0.10)');
  lampGrad.addColorStop(0.45, 'rgba(232, 198, 130, 0.04)');
  lampGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = lampGrad;
  ctx.fillRect(0, 0, width, height);

  // Inner walnut rim drop shadow on felt edge
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.65)';
  ctx.lineWidth = 18;
  ctx.stroke();

  // Burnished brass double inlay ellipse
  ctx.beginPath();
  ctx.ellipse(cx, cy, Math.max(40, rx - 22), Math.max(30, ry - 20), 0, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(200, 157, 84, 0.28)';
  ctx.lineWidth = 1.4;
  ctx.stroke();

  ctx.beginPath();
  ctx.ellipse(cx, cy, Math.max(36, rx - 28), Math.max(26, ry - 26), 0, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(200, 157, 84, 0.12)';
  ctx.lineWidth = 0.8;
  ctx.stroke();

  // Subtle center table crest ring
  ctx.beginPath();
  ctx.ellipse(cx, cy, Math.min(180, rx * 0.28), Math.min(110, ry * 0.26), 0, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(200, 157, 84, 0.08)';
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.restore();
  ctx.restore();
}

export function TableCanvas({
  shuffleTriggerKey,
  roundDealTriggerKey,
  capturePulseKey,
  sweepTriggerKey,
  activeDragPoint,
  handOriginPoint,
}: TableCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const offscreenRef = useRef<HTMLCanvasElement | null>(null);
  const baizePatternRef = useRef<CanvasPattern | null>(null);

  const sizeRef = useRef({
    width: 1280,
    height: 760,
    dpr: 1,
    rectLeft: 0,
    rectTop: 0,
  });

  const propsRef = useRef({
    activeDragPoint,
    handOriginPoint,
  });

  propsRef.current.activeDragPoint = activeDragPoint;
  propsRef.current.handOriginPoint = handOriginPoint;

  const traumaRef = useRef(new CameraTrauma());
  const flightsRef = useRef(new BezierFlightPool(64));

  const shockwavesRef = useRef<ShockwaveRing[]>(
    Array.from({ length: SHOCKWAVE_POOL_SIZE }, () => ({
      active: false,
      x: 0,
      y: 0,
      radius: 10,
      maxRadius: 240,
      progress: 0,
      duration: 0.65,
      delay: 0,
      lineWidth: 2,
      variant: 'gold' as const,
      octagonal: false,
    }))
  );

  const prevTriggersRef = useRef({
    shuffle: shuffleTriggerKey,
    roundDeal: roundDealTriggerKey,
    capture: capturePulseKey,
    sweep: sweepTriggerKey,
  });

  const spawnShockwave = (
    x: number,
    y: number,
    maxRadius: number,
    duration: number,
    delay: number,
    lineWidth: number,
    variant: 'gold' | 'emerald',
    octagonal: boolean
  ) => {
    const pool = shockwavesRef.current;
    for (let i = 0; i < pool.length; i++) {
      const ring = pool[i];
      if (!ring.active) {
        ring.active = true;
        ring.x = x;
        ring.y = y;
        ring.radius = 18;
        ring.maxRadius = maxRadius;
        ring.progress = 0;
        ring.duration = duration;
        ring.delay = delay;
        ring.lineWidth = lineWidth;
        ring.variant = variant;
        ring.octagonal = octagonal;
        return;
      }
    }
  };

  // Handle shuffleTriggerKey changes
  useEffect(() => {
    if (shuffleTriggerKey === prevTriggersRef.current.shuffle) return;
    prevTriggersRef.current.shuffle = shuffleTriggerKey;
    if (shuffleTriggerKey <= 0) return;

    const { width, height } = sizeRef.current;
    const originX = width * 0.5;
    const originY = height * 0.18;

    const flights = flightsRef.current;
    const targets = [
      { x: width * 0.5, y: height * 0.84, rot: 0 }, // Bottom viewer seat
      { x: width * 0.5, y: height * 0.16, rot: Math.PI }, // Top seat
      { x: width * 0.16, y: height * 0.5, rot: Math.PI * 0.5 }, // Left seat
      { x: width * 0.84, y: height * 0.5, rot: -Math.PI * 0.5 }, // Right seat
    ];

    for (let i = 0; i < 12; i++) {
      const seat = targets[i % targets.length];
      const spreadX = ((i % 4) - 1.5) * 14;
      flights.spawn(
        originX,
        originY,
        seat.x + spreadX,
        seat.y,
        -0.12,
        seat.rot + (i % 2 === 0 ? 0.04 : -0.04),
        0.42,
        0.15 + i * 0.04,
        -75,
        false,
        '',
        false
      );
    }

    // 4 initial table face-up cards
    for (let t = 0; t < 4; t++) {
      flights.spawn(
        originX,
        originY,
        width * 0.5 + (t - 1.5) * 86,
        height * 0.49 + (t % 2 === 0 ? -8 : 8),
        -0.15,
        (t - 1.5) * 0.05,
        0.44,
        0.3 + t * 0.05,
        -68,
        true,
        '',
        false
      );
    }
  }, [shuffleTriggerKey]);

  // Handle roundDealTriggerKey changes
  useEffect(() => {
    if (roundDealTriggerKey === prevTriggersRef.current.roundDeal) return;
    prevTriggersRef.current.roundDeal = roundDealTriggerKey;
    if (roundDealTriggerKey <= 0) return;

    const { width, height } = sizeRef.current;
    const originX = width * 0.5;
    const originY = height * 0.18;

    const flights = flightsRef.current;
    const targets = [
      { x: width * 0.5, y: height * 0.84, rot: 0 },
      { x: width * 0.5, y: height * 0.16, rot: Math.PI },
      { x: width * 0.16, y: height * 0.5, rot: Math.PI * 0.5 },
      { x: width * 0.84, y: height * 0.5, rot: -Math.PI * 0.5 },
    ];

    for (let i = 0; i < 12; i++) {
      const seat = targets[i % targets.length];
      const spreadX = ((i % 4) - 1.5) * 12;
      flights.spawn(
        originX,
        originY,
        seat.x + spreadX,
        seat.y,
        -0.1,
        seat.rot,
        0.4,
        i * 0.045,
        -70,
        false,
        '',
        false
      );
    }
  }, [roundDealTriggerKey]);

  // Handle capturePulseKey changes
  useEffect(() => {
    if (capturePulseKey === prevTriggersRef.current.capture) return;
    prevTriggersRef.current.capture = capturePulseKey;
    if (capturePulseKey <= 0) return;

    const { width, height } = sizeRef.current;
    traumaRef.current.addTrauma(0.32);
    spawnShockwave(width * 0.5, height * 0.5, Math.min(width, height) * 0.24, 0.55, 0, 2.4, 'emerald', false);
    spawnShockwave(width * 0.5, height * 0.5, Math.min(width, height) * 0.19, 0.48, 0.06, 1.5, 'gold', false);
  }, [capturePulseKey]);

  // Handle sweepTriggerKey changes
  useEffect(() => {
    if (sweepTriggerKey === prevTriggersRef.current.sweep) return;
    prevTriggersRef.current.sweep = sweepTriggerKey;
    if (sweepTriggerKey <= 0) return;

    const { width, height } = sizeRef.current;
    const cx = width * 0.5;
    const cy = height * 0.5;
    traumaRef.current.addTrauma(0.75);

    const maxR = Math.min(width, height) * 0.42;
    spawnShockwave(cx, cy, maxR, 0.85, 0, 3.2, 'gold', false);
    spawnShockwave(cx, cy, maxR * 0.86, 0.78, 0.05, 2.2, 'emerald', true);
    spawnShockwave(cx, cy, maxR * 0.7, 0.68, 0.12, 1.8, 'gold', false);
  }, [sweepTriggerKey]);

  // Main resize observer + fixed-timestep 60fps RAF loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    if (!offscreenRef.current) {
      offscreenRef.current = document.createElement('canvas');
    }
    if (!baizePatternRef.current) {
      baizePatternRef.current = buildBaizePattern(ctx);
    }

    const syncCanvasDimensions = () => {
      const rect = canvas.getBoundingClientRect();
      const width = Math.max(1, rect.width || canvas.clientWidth || window.innerWidth);
      const height = Math.max(1, rect.height || canvas.clientHeight || window.innerHeight);
      const dpr = Math.min(2, window.devicePixelRatio || 1);

      sizeRef.current.width = width;
      sizeRef.current.height = height;
      sizeRef.current.dpr = dpr;
      sizeRef.current.rectLeft = rect.left;
      sizeRef.current.rectTop = rect.top;

      const targetW = Math.floor(width * dpr);
      const targetH = Math.floor(height * dpr);
      if (canvas.width !== targetW || canvas.height !== targetH) {
        canvas.width = targetW;
        canvas.height = targetH;
      }

      if (offscreenRef.current) {
        paintStaticTableLayer(offscreenRef.current, width, height, dpr, baizePatternRef.current);
      }
    };

    syncCanvasDimensions();

    const resizeObserver =
      typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(() => syncCanvasDimensions())
        : null;
    if (resizeObserver) {
      resizeObserver.observe(canvas);
    }
    window.addEventListener('resize', syncCanvasDimensions);

    let rafId = 0;
    let lastTimeMs = performance.now();
    let accumulator = 0;
    let elapsedSec = 0;

    const stepPhysics = (dt: number) => {
      elapsedSec += dt;
      traumaRef.current.update(dt, elapsedSec);
      flightsRef.current.update(dt);

      const rings = shockwavesRef.current;
      for (let i = 0; i < rings.length; i++) {
        const r = rings[i];
        if (!r.active) continue;
        if (r.delay > 0) {
          r.delay = Math.max(0, r.delay - dt);
          continue;
        }
        r.progress += dt / r.duration;
        if (r.progress >= 1) {
          r.active = false;
          continue;
        }
        const u = 1 - r.progress;
        const ease = 1 - u * u * u;
        r.radius = 18 + (r.maxRadius - 18) * ease;
      }
    };

    const renderFrame = () => {
      const { width, height, dpr, rectLeft, rectTop } = sizeRef.current;
      const trauma = traumaRef.current;

      ctx.save();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      // Apply camera trauma shake around table center
      if (trauma.offsetX !== 0 || trauma.offsetY !== 0 || trauma.rotationRad !== 0) {
        ctx.translate(width * 0.5 + trauma.offsetX, height * 0.5 + trauma.offsetY);
        ctx.rotate(trauma.rotationRad);
        ctx.translate(-width * 0.5, -height * 0.5);
      }

      // 1. Blit cached static walnut + baize + brass inlay layer
      if (offscreenRef.current) {
        ctx.drawImage(offscreenRef.current, 0, 0, width, height);
      }

      // 2. Expanding Geometric Capture / Sweep Shockwave Rings
      const rings = shockwavesRef.current;
      for (let i = 0; i < rings.length; i++) {
        const ring = rings[i];
        if (!ring.active || ring.delay > 0) continue;

        const alpha = (1 - ring.progress) * 0.72;
        ctx.save();
        ctx.strokeStyle =
          ring.variant === 'gold'
            ? `rgba(216, 173, 94, ${alpha.toFixed(3)})`
            : `rgba(52, 211, 153, ${alpha.toFixed(3)})`;
        ctx.lineWidth = ring.lineWidth * (1 - ring.progress * 0.45);

        if (ring.octagonal) {
          ctx.beginPath();
          for (let v = 0; v < 8; v++) {
            const ang = (v * Math.PI) / 4 + ring.progress * 0.25;
            const px = ring.x + Math.cos(ang) * ring.radius;
            const py = ring.y + Math.sin(ang) * ring.radius * 0.72;
            if (v === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
          }
          ctx.closePath();
          ctx.stroke();
        } else {
          ctx.beginPath();
          ctx.ellipse(ring.x, ring.y, ring.radius, ring.radius * 0.72, 0, 0, Math.PI * 2);
          ctx.stroke();
        }
        ctx.restore();
      }

      // 4. Golden Quadratic Bezier Drag Aim Arc
      const dragPt = propsRef.current.activeDragPoint;
      const originPt = propsRef.current.handOriginPoint;
      if (dragPt && originPt) {
        const sx = originPt.x - rectLeft;
        const sy = originPt.y - rectTop;
        const ex = dragPt.x - rectLeft;
        const ey = dragPt.y - rectTop;
        const dx = ex - sx;
        const dy = ey - sy;
        const dist = Math.hypot(dx, dy);
        const ctrlX = (sx + ex) * 0.5 + dx * 0.05;
        const ctrlY = (sy + ey) * 0.5 - Math.max(42, Math.min(130, dist * 0.24));

        ctx.save();
        // Soft warm under-glow
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.quadraticCurveTo(ctrlX, ctrlY, ex, ey);
        ctx.strokeStyle = 'rgba(200, 157, 84, 0.24)';
        ctx.lineWidth = 6;
        ctx.lineCap = 'round';
        ctx.stroke();

        // Crisp animated dashed brass trajectory
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.quadraticCurveTo(ctrlX, ctrlY, ex, ey);
        ctx.strokeStyle = 'rgba(235, 196, 118, 0.88)';
        ctx.lineWidth = 2;
        ctx.setLineDash([8, 6]);
        ctx.lineDashOffset = -(elapsedSec * 42);
        ctx.stroke();
        ctx.setLineDash([]);

        // Geometric brass target reticle at drag cursor
        ctx.beginPath();
        ctx.arc(ex, ey, 11, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(235, 196, 118, 0.82)';
        ctx.lineWidth = 1.5;
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(ex, ey - 5);
        ctx.lineTo(ex + 5, ey);
        ctx.lineTo(ex, ey + 5);
        ctx.lineTo(ex - 5, ey);
        ctx.closePath();
        ctx.fillStyle = 'rgba(235, 196, 118, 0.9)';
        ctx.fill();
        ctx.restore();
      }

      // 5. Active Bezier Card Flights
      const flightItems = flightsRef.current.items;
      for (let i = 0; i < flightItems.length; i++) {
        const f = flightItems[i];
        if (!f.active || f.delay > 0) continue;
        if (f.faceUp) {
          drawMiniCardFace(
            ctx,
            f.x,
            f.y,
            CARD_MINI_W * 1.15,
            CARD_MINI_H * 1.15,
            f.rot,
            f.scale,
            f.label,
            f.isRed
          );
        } else {
          drawMiniCardBack(
            ctx,
            f.x,
            f.y,
            CARD_MINI_W * 1.1,
            CARD_MINI_H * 1.1,
            f.rot,
            f.scale
          );
        }
      }

      ctx.restore();
    };

    const loop = (nowMs: number) => {
      const deltaSec = Math.min(0.05, Math.max(0, (nowMs - lastTimeMs) / 1000));
      lastTimeMs = nowMs;
      accumulator += deltaSec;

      while (accumulator >= FIXED_DT) {
        stepPhysics(FIXED_DT);
        accumulator -= FIXED_DT;
      }

      renderFrame();
      rafId = requestAnimationFrame(loop);
    };

    rafId = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(rafId);
      if (resizeObserver) {
        resizeObserver.disconnect();
      }
      window.removeEventListener('resize', syncCanvasDimensions);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="absolute inset-0 w-full h-full pointer-events-none select-none block"
    />
  );
}

export default TableCanvas;
