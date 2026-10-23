import { Renderer, RenderState } from './types';

export class Canvas2DRenderer implements Renderer {
  type = 'canvas2d' as const;
  private ctx: CanvasRenderingContext2D | null = null;
  private lensCanvas: HTMLCanvasElement;
  private lensCtx: CanvasRenderingContext2D | null;

  // Texture buffer to prevent re-decoding images every frame
  private texBuffer: {
    canvas: HTMLCanvasElement;
    ctx: CanvasRenderingContext2D;
    img: HTMLImageElement;
    lastSrc?: string;
    hasDrawn?: boolean;
  } | null = null;

  // Constants (matching v9 config)
  // Mobile (Canvas2D) uses a smaller budget for lens refraction — it's a per-trail
  // canvas clipping pass which is the most expensive operation.
  private readonly MAX_LENS_TRAILS = 40;

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d', { alpha: true, desynchronized: true });
    this.lensCanvas = document.createElement('canvas');
    this.lensCtx = this.lensCanvas.getContext('2d', { alpha: true });
  }

  async init() {
    return Promise.resolve();
  }

  onContextLost() {
    this.ctx = null;
  }

  async onContextRestored() {
    this.ctx = this.canvas.getContext('2d', {
      alpha: true,
      desynchronized: true,
    });
  }

  resize(w: number, h: number, dpr: number) {
    if (!this.ctx) return;

    const cw = Math.max(1, Math.floor(w * dpr));
    const ch = Math.max(1, Math.floor(h * dpr));

    if (this.canvas.width !== cw || this.canvas.height !== ch) {
      this.canvas.width = cw;
      this.canvas.height = ch;
    }

    if (this.lensCanvas.width !== cw || this.lensCanvas.height !== ch) {
      this.lensCanvas.width = cw;
      this.lensCanvas.height = ch;
    }
  }

  destroy() {
    this.ctx = null;
    this.lensCtx = null;
    this.texBuffer = null;
    // Clear lens canvas to free memory
    this.lensCanvas.width = 0;
    this.lensCanvas.height = 0;
  }

  render(state: RenderState) {
    const { ctx, lensCtx } = this;
    if (!ctx || !lensCtx) return;

    const { width, height, dpr, drops, trails, dropsData, trailsData, backgroundImage } = state;
    const cw = this.canvas.width;
    const ch = this.canvas.height;

    // --- 1. Texture Maintenance (Draw Cover) ---
    if (!backgroundImage) {
      this.texBuffer = null;
    } else {
      if (!this.texBuffer) {
        const c = document.createElement('canvas');
        const cx = c.getContext('2d', { alpha: false });
        if (cx)
          this.texBuffer = {
            canvas: c,
            ctx: cx,
            img: backgroundImage,
            hasDrawn: false,
          };
      }

      const tb = this.texBuffer;
      if (tb) {
        // PATCH: Handle React image swapping
        if (tb.img !== backgroundImage) {
          tb.img = backgroundImage;
          tb.hasDrawn = false;
          tb.lastSrc = undefined;
        }

        const src = tb.img.currentSrc || tb.img.src;
        const needResize = tb.canvas.width !== cw || tb.canvas.height !== ch;
        const needRedraw = needResize || tb.lastSrc !== src || !tb.hasDrawn;

        if (needResize) {
          tb.canvas.width = cw;
          tb.canvas.height = ch;
        }
        if (needRedraw) {
          this.drawCover(tb.ctx, tb.img, cw, ch);
          tb.lastSrc = src;
          tb.hasDrawn = true;
        }
      }
    }

    // --- 2. Clear & Setup ---
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, cw, ch);

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Fog Wash
    ctx.fillStyle = 'rgba(255,255,255,0.05)';
    ctx.fillRect(0, 0, width, height);

    // --- 3. Trail Wipe ---
    ctx.save();
    ctx.globalCompositeOperation = 'destination-out';
    ctx.lineCap = 'round';
    if (state.trailsData) {
      const numTrails = state.trailsData.length / 6;
      for (let i = 0; i < numTrails; i++) {
        const off = i * 6;
        const life = state.trailsData[off + 5];
        const w = state.trailsData[off + 4];
        const x1 = state.trailsData[off + 0];
        const y1 = state.trailsData[off + 1];
        const x2 = state.trailsData[off + 2];
        const y2 = state.trailsData[off + 3];

        ctx.globalAlpha = life;
        ctx.lineWidth = w * 1.8;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
      }
    } else {
      for (const tr of trails) {
        ctx.globalAlpha = tr.life;
        ctx.lineWidth = tr.w * 1.8;
        ctx.beginPath();
        ctx.moveTo(tr.x1, tr.y1);
        ctx.lineTo(tr.x2, tr.y2);
        ctx.stroke();
      }
    }
    ctx.restore();

    // --- 4. Lens Refraction ---
    // Dropped for trails: refraction on 1-2px lines is completely imperceptible
    // but costs massive CPU fill rate from full-screen drawImage.

    // --- 5. Volumetric Trails ---
    ctx.lineCap = 'round';
    if (state.trailsData) {
      const numTrails = state.trailsData.length / 6;
      for (let i = 0; i < numTrails; i++) {
        const off = i * 6;
        const x1 = state.trailsData[off + 0];
        const y1 = state.trailsData[off + 1];
        const x2 = state.trailsData[off + 2];
        const y2 = state.trailsData[off + 3];
        const w = state.trailsData[off + 4];
        const life = state.trailsData[off + 5];

        const dx = x2 - x1;
        const dy = y2 - y1;
        const len = Math.hypot(dx, dy) || 1;
        const nx = -dy / len;
        const ny = dx / len;

        // Dark edges
        ctx.globalAlpha = life * 0.085;
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = w * 0.6;
        const edge = w * 0.42;
        ctx.beginPath();
        ctx.moveTo(x1 + nx * edge, y1 + ny * edge);
        ctx.lineTo(x2 + nx * edge, y2 + ny * edge);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(x1 - nx * edge, y1 - ny * edge);
        ctx.lineTo(x2 - nx * edge, y2 - ny * edge);
        ctx.stroke();

        // White core
        ctx.globalAlpha = life * 0.05;
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = w * 0.22;
        const inner = w * 0.2;
        ctx.beginPath();
        ctx.moveTo(x1 + nx * inner, y1 + ny * inner);
        ctx.lineTo(x2 + nx * inner, y2 + ny * inner);
        ctx.stroke();
      }
    } else {
      for (const tr of trails) {
        const dx = tr.x2 - tr.x1;
        const dy = tr.y2 - tr.y1;
        const len = Math.hypot(dx, dy) || 1;
        const nx = -dy / len;
        const ny = dx / len;

        // Dark edges
        ctx.globalAlpha = tr.life * 0.085;
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = tr.w * 0.6;
        const edge = tr.w * 0.42;
        ctx.beginPath();
        ctx.moveTo(tr.x1 + nx * edge, tr.y1 + ny * edge);
        ctx.lineTo(tr.x2 + nx * edge, tr.y2 + ny * edge);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(tr.x1 - nx * edge, tr.y1 - ny * edge);
        ctx.lineTo(tr.x2 - nx * edge, tr.y2 - ny * edge);
        ctx.stroke();

        // White core
        ctx.globalAlpha = tr.life * 0.05;
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = tr.w * 0.22;
        const inner = tr.w * 0.2;
        ctx.beginPath();
        ctx.moveTo(tr.x1 + nx * inner, tr.y1 + ny * inner);
        ctx.lineTo(tr.x2 + nx * inner, tr.y2 + ny * inner);
        ctx.stroke();
      }
    }

       // --- 6. Draw Drops ---
    const numDrops = state.dropsData ? state.dropsData.length / 9 : drops.length;
    for (let i = 0; i < numDrops; i++) {
      let x = 0, y = 0, r = 0, stretch = 0, vy = 0, seed = 0, wobble = 0, falling = false;
      if (state.dropsData) {
        const off = i * 9;
        x = state.dropsData[off + 0];
        y = state.dropsData[off + 1];
        r = state.dropsData[off + 2];
        stretch = state.dropsData[off + 3];
        // vx = off + 4
        vy = state.dropsData[off + 5];
        seed = state.dropsData[off + 6];
        wobble = state.dropsData[off + 7];
        falling = state.dropsData[off + 8] > 0.5;
      } else {
        const d = drops[i];
        x = d.x;
        y = d.y;
        r = d.r;
        stretch = d.stretch;
        vy = d.vy;
        seed = d.seed;
        wobble = d.wobble;
        falling = d.falling;
      }

      const vNorm = falling ? Math.min(1, Math.max(0, vy / 260)) : 0;
      const rx0 = r * (1 - stretch * 0.1);
      const ry0 = r * (1 + stretch * 0.22);
      const cy = y + vNorm * r * 0.14;
      const tt = falling ? state.time * 2.0 : 0;

      ctx.beginPath();
      // Use fewer polygon steps for small drops (they're tiny — aliasing unnoticeable)
      const steps = r < 3 ? 10 : 18;
      const TWO_PI = Math.PI * 2;
      for (let k = 0; k <= steps; k++) {
        const a = (k / steps) * TWO_PI;
        const n =
          Math.sin(a * 3 + seed * 9 + tt) * 0.5 +
          Math.cos(a * 2 + seed * 4 + tt * 0.8) * 0.5;
        const edge = 1 + n * (0.1 * wobble);

        let px = Math.cos(a) * rx0 * edge;
        let py = Math.sin(a) * ry0 * edge;

        if (falling) {
          if (py < 0) {
            px *= 1 - vNorm * 0.28;
            py *= 1 + vNorm * 0.3;
          } else {
            px *= 1 + vNorm * 0.16;
            py *= 1 + vNorm * 0.22;
          }
          px += Math.sin(seed * 12 + tt) * vNorm * r * 0.04;
        }
        if (k === 0) ctx.moveTo(x + px, cy + py);
        else ctx.lineTo(x + px, cy + py);
      }
      ctx.closePath();

      // Refraction inside drop - disabled in Canvas2D to maintain high frame rate on low-power devices
      ctx.fillStyle = 'rgba(255,255,255,0.18)';
      ctx.fill();

      // Rim
      ctx.strokeStyle = 'rgba(10,10,10,0.3)';
      ctx.lineWidth = 0.85;
      ctx.stroke();

      // Shine
      ctx.beginPath();
      ctx.ellipse(
        x - rx0 * 0.22,
        cy - ry0 * 0.32,
        rx0 * 0.14,
        ry0 * 0.09,
        -0.42,
        0,
        Math.PI * 2,
      );
      ctx.fillStyle = 'rgba(255,255,255,0.8)';
      ctx.fill();
    }
  }

  private drawCover(
    ctx: CanvasRenderingContext2D,
    img: HTMLImageElement,
    w: number,
    h: number,
  ) {
    ctx.clearRect(0, 0, w, h);
    const iw = img.naturalWidth || img.width;
    const ih = img.naturalHeight || img.height;
    if (!iw || !ih) return;
    const scale = Math.max(w / iw, h / ih);
    const dw = iw * scale;
    const dh = ih * scale;
    const dx = (w - dw) / 2;
    const dy = (h - dh) / 2;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(img, dx, dy, dw, dh);
  }
}
