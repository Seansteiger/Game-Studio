/**
 * Zero-allocation fixed-timestep spring physics, quadratic trauma shake,
 * and Bezier arc card flight pool for 60fps tabletop rendering.
 */

export const FIXED_DT = 1 / 60;

export interface SpringState {
  value: number;
  target: number;
  velocity: number;
}

export function stepSpring(
  spring: SpringState,
  stiffness: number,
  damping: number,
  dt: number = FIXED_DT
): void {
  const force = (spring.target - spring.value) * stiffness;
  spring.velocity = (spring.velocity + force * dt) * Math.exp(-damping * dt);
  spring.value += spring.velocity * dt;
}

export class Spring2D {
  public x: number;
  public y: number;
  public targetX: number;
  public targetY: number;
  public vx = 0;
  public vy = 0;

  constructor(initialX = 0, initialY = 0) {
    this.x = initialX;
    this.y = initialY;
    this.targetX = initialX;
    this.targetY = initialY;
  }

  public setTarget(x: number, y: number): void {
    this.targetX = x;
    this.targetY = y;
  }

  public snapTo(x: number, y: number): void {
    this.x = x;
    this.y = y;
    this.targetX = x;
    this.targetY = y;
    this.vx = 0;
    this.vy = 0;
  }

  public update(stiffness = 260, damping = 22, dt = FIXED_DT): void {
    const decay = Math.exp(-damping * dt);
    this.vx = (this.vx + (this.targetX - this.x) * stiffness * dt) * decay;
    this.vy = (this.vy + (this.targetY - this.y) * stiffness * dt) * decay;
    this.x += this.vx * dt;
    this.y += this.vy * dt;
  }
}

export class Spring3D {
  public x = 0;
  public y = 0;
  public z = 0;
  public targetX = 0;
  public targetY = 0;
  public targetZ = 0;
  public vx = 0;
  public vy = 0;
  public vz = 0;

  public update(stiffness = 260, damping = 22, dt = FIXED_DT): void {
    const decay = Math.exp(-damping * dt);
    this.vx = (this.vx + (this.targetX - this.x) * stiffness * dt) * decay;
    this.vy = (this.vy + (this.targetY - this.y) * stiffness * dt) * decay;
    this.vz = (this.vz + (this.targetZ - this.z) * stiffness * dt) * decay;
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.z += this.vz * dt;
  }
}

export class CardTransformSpring {
  public x = 0;
  public y = 0;
  public scale = 1;
  public rotation = 0;
  public targetX = 0;
  public targetY = 0;
  public targetScale = 1;
  public targetRotation = 0;
  public vx = 0;
  public vy = 0;
  public vScale = 0;
  public vRot = 0;

  public update(stiffness = 280, damping = 24, dt = FIXED_DT): void {
    const decay = Math.exp(-damping * dt);
    this.vx = (this.vx + (this.targetX - this.x) * stiffness * dt) * decay;
    this.vy = (this.vy + (this.targetY - this.y) * stiffness * dt) * decay;
    this.vScale = (this.vScale + (this.targetScale - this.scale) * stiffness * dt) * decay;
    this.vRot = (this.vRot + (this.targetRotation - this.rotation) * stiffness * dt) * decay;

    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.scale += this.vScale * dt;
    this.rotation += this.vRot * dt;
  }
}

/**
 * Quadratic trauma-based table camera shake (zero allocations in update).
 */
export class CameraTrauma {
  private trauma = 0;
  private readonly decay = 2.6;
  private readonly maxOffset = 10;
  private readonly maxAngle = 0.012;

  public offsetX = 0;
  public offsetY = 0;
  public rotationRad = 0;

  public addTrauma(amount: number): void {
    this.trauma = Math.min(1.0, this.trauma + amount);
  }

  public update(dt: number, elapsedSec: number): void {
    if (this.trauma <= 0.001) {
      this.trauma = 0;
      this.offsetX = 0;
      this.offsetY = 0;
      this.rotationRad = 0;
      return;
    }

    const shake = this.trauma * this.trauma;
    const t = elapsedSec * 34;
    this.offsetX = shake * this.maxOffset * Math.sin(t * 1.13);
    this.offsetY = shake * this.maxOffset * Math.cos(t * 1.47);
    this.rotationRad = shake * this.maxAngle * Math.sin(t * 0.91 + 1.7);
    this.trauma = Math.max(0, this.trauma - this.decay * dt);
  }
}

export interface BezierArcFlight {
  active: boolean;
  startX: number;
  startY: number;
  ctrlX: number;
  ctrlY: number;
  endX: number;
  endY: number;
  startRot: number;
  endRot: number;
  progress: number;
  duration: number;
  delay: number;
  faceUp: boolean;
  label: string;
  isRed: boolean;
  x: number;
  y: number;
  rot: number;
  scale: number;
}

/**
 * Pre-allocated pool of Bezier card flights for deal & play animations without GC churn.
 */
export class BezierFlightPool {
  public readonly items: BezierArcFlight[];

  constructor(capacity = 64) {
    this.items = new Array(capacity);
    for (let i = 0; i < capacity; i++) {
      this.items[i] = {
        active: false,
        startX: 0,
        startY: 0,
        ctrlX: 0,
        ctrlY: 0,
        endX: 0,
        endY: 0,
        startRot: 0,
        endRot: 0,
        progress: 0,
        duration: 0.35,
        delay: 0,
        faceUp: false,
        label: '',
        isRed: false,
        x: 0,
        y: 0,
        rot: 0,
        scale: 1,
      };
    }
  }

  public clear(): void {
    for (let i = 0; i < this.items.length; i++) {
      this.items[i].active = false;
    }
  }

  public spawn(
    startX: number,
    startY: number,
    endX: number,
    endY: number,
    startRot: number,
    endRot: number,
    duration: number,
    delay: number,
    arcLift = -65,
    faceUp = false,
    label = '',
    isRed = false
  ): void {
    for (let i = 0; i < this.items.length; i++) {
      const f = this.items[i];
      if (!f.active) {
        f.active = true;
        f.startX = startX;
        f.startY = startY;
        f.ctrlX = (startX + endX) * 0.5 + (endX - startX) * 0.08;
        f.ctrlY = (startY + endY) * 0.5 + arcLift;
        f.endX = endX;
        f.endY = endY;
        f.startRot = startRot;
        f.endRot = endRot;
        f.progress = 0;
        f.duration = duration;
        f.delay = delay;
        f.faceUp = faceUp;
        f.label = label;
        f.isRed = isRed;
        f.x = startX;
        f.y = startY;
        f.rot = startRot;
        f.scale = 0.92;
        return;
      }
    }
  }

  public update(dt: number): number {
    let activeCount = 0;
    for (let i = 0; i < this.items.length; i++) {
      const f = this.items[i];
      if (!f.active) continue;

      if (f.delay > 0) {
        f.delay = Math.max(0, f.delay - dt);
        activeCount++;
        continue;
      }

      f.progress += dt / f.duration;
      if (f.progress >= 1) {
        f.active = false;
        continue;
      }

      // Cubic ease-out velocity decay for natural card landing deceleration
      const u = 1 - f.progress;
      const t = 1 - u * u * u;
      const invT = 1 - t;

      f.x = invT * invT * f.startX + 2 * invT * t * f.ctrlX + t * t * f.endX;
      f.y = invT * invT * f.startY + 2 * invT * t * f.ctrlY + t * t * f.endY;
      f.rot = f.startRot + (f.endRot - f.startRot) * t;
      f.scale = 0.88 + Math.sin(t * Math.PI) * 0.14 + t * 0.12;
      activeCount++;
    }
    return activeCount;
  }
}
