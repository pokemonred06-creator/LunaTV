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
  private readonly MAX_LENS_TRAILS = 80;

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

    const { width, height, dpr, drops, trails, backgroundImage } = state;
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
    for (const tr of trails) {
      ctx.globalAlpha = tr.life;
      ctx.lineWidth = tr.w * 1.8;
      ctx.beginPath();
      ctx.moveTo(tr.x1, tr.y1);
      ctx.lineTo(tr.x2, tr.y2);
      ctx.stroke();
    }
    ctx.restore();

    // --- 4. Lens Refraction ---
    if (this.texBuffer && trails.length > 0) {
      const tex = this.texBuffer.canvas;
      const startIndex = Math.max(0, trails.length - this.MAX_LENS_TRAILS);

      for (let i = startIndex; i < trails.length; i++) {
        const tr = trails[i];
        const a = tr.life;
        if (a <= 0.08) continue;

        const pad = (tr.w * 3 + 8) * dpr;

        // Calculate scissor rect
        let x0 = Math.floor(Math.min(tr.x1, tr.x2) * dpr - pad);
        let y0 = Math.floor(Math.min(tr.y1, tr.y2) * dpr - pad);
        let x1 = Math.ceil(Math.max(tr.x1, tr.x2) * dpr + pad);
        let y1 = Math.ceil(Math.max(tr.y1, tr.y2) * dpr + pad);

        // PATCH: Clamp to bounds to prevent Safari spikes
        x0 = Math.max(0, Math.min(x0, cw));
        y0 = Math.max(0, Math.min(y0, ch));
        x1 = Math.max(0, Math.min(x1, cw));
        y1 = Math.max(0, Math.min(y1, ch));

        const scW = x1 - x0;
        const scH = y1 - y0;

        if (scW <= 0 || scH <= 0) continue;

        // A. Clear Scissor
        lensCtx.setTransform(1, 0, 0, 1, 0, 0);
        lensCtx.clearRect(x0, y0, scW, scH);

        // B. Draw Refracted Texture
        const shift = tr.w * 0.22 * a;
        const dx = tr.x2 - tr.x1;
        const dy = tr.y2 - tr.y1;
        const len = Math.hypot(dx, dy) || 1;
        const nx = -dy / len;
        const ny = dx / len;

        lensCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
        lensCtx.save();
        lensCtx.beginPath();
        lensCtx.rect(x0 / dpr, y0 / dpr, scW / dpr, scH / dpr);
        lensCtx.clip();

        lensCtx.globalAlpha = 0.1 * a;
        lensCtx.translate(nx * shift, ny * shift);
        lensCtx.drawImage(tex, 0, 0, width, height);
        lensCtx.restore();

        // C. Mask to Trail Shape
        lensCtx.globalCompositeOperation = 'destination-in';

        // PATCH: Reset alpha for full masking strength
        lensCtx.globalAlpha = 1;

        lensCtx.lineWidth = tr.w * 1.35;
        lensCtx.lineCap = 'round';
        lensCtx.beginPath();
        lensCtx.moveTo(tr.x1, tr.y1);
        lensCtx.lineTo(tr.x2, tr.y2);
        lensCtx.stroke();

        // Reset
        lensCtx.globalCompositeOperation = 'source-over';
        lensCtx.globalAlpha = 1;

        // D. Composite
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 1;
        ctx.drawImage(this.lensCanvas, x0, y0, scW, scH, x0, y0, scW, scH);
        ctx.restore();
      }
    }

    // --- 5. Volumetric Trails ---
    ctx.lineCap = 'round';
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

    // --- 6. Draw Drops ---
    for (const d of drops) {
      const { x, y, r, stretch, seed, wobble, falling, vy } = d;

      const vNorm = falling ? Math.min(1, Math.max(0, vy / 260)) : 0;
      const rx0 = r * (1 - stretch * 0.1);
      const ry0 = r * (1 + stretch * 0.22);
      const cy = y + vNorm * r * 0.14;
      const tt = falling ? state.time * 2.0 : 0;

      ctx.beginPath();
      const steps = 18;
      for (let k = 0; k <= steps; k++) {
        const a = (k / steps) * Math.PI * 2;
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

      // Refraction inside drop
      if (this.texBuffer && !falling) {
        ctx.save();
        ctx.clip();
        const magnify = 1.085;
        const refractY =
          (falling ? vy * 0.0022 : 0) + (0.5 - wobble) * r * 0.16;
        const refractX = (0.5 - seed) * r * 0.22;

        ctx.translate(x, cy);
        ctx.scale(magnify, magnify);
        ctx.translate(-x + refractX, -cy + refractY);
        ctx.drawImage(this.texBuffer.canvas, 0, 0, width, height);

        ctx.globalCompositeOperation = 'multiply';
        ctx.fillStyle = `rgba(0,0,0,0.1)`;
        ctx.fillRect(x - r * 3, cy - r * 3, r * 6, r * 6);
        ctx.restore();
      } else {
        ctx.fillStyle = 'rgba(255,255,255,0.15)';
        ctx.fill();
      }

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
