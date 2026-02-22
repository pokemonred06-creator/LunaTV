import { Canvas2DRenderer } from './canvas2dRenderer';
import { Renderer } from './types';
import { WebGL2Renderer } from './webgl2Renderer';

export class QualityManager {
  public fps = 60;
  public scale = 1.0;
  private frames = 0;
  private lastTime = performance.now();

  update() {
    this.frames++;
    const now = performance.now();
    if (now - this.lastTime >= 1000) {
      this.fps = this.frames;
      this.frames = 0;
      this.lastTime = now;

      // Hysteresis with clamping to keep scale sane (0.5 to 1.0)
      if (this.fps < 40 && this.scale > 0.5) {
        this.scale = Math.max(0.5, this.scale - 0.1);
      } else if (this.fps > 58 && this.scale < 1.0) {
        this.scale = Math.min(1.0, this.scale + 0.05);
      }
    }
  }
}

function canUseWebGL2(): boolean {
  try {
    const tempCanvas = document.createElement('canvas');
    // We only strictly require WebGL2 context creation.
    // Extensions like EXT_blend_minmax are treated as optional optimizations
    // inside the renderer itself.
    const gl = tempCanvas.getContext('webgl2');
    if (!gl) return false;

    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return true;
  } catch (e) {
    return false;
  }
}

type CreateRendererOptions = {
  forceCanvas?: boolean;
  adaptive?: boolean;
};

export async function createRenderer(
  canvas: HTMLCanvasElement,
  options: CreateRendererOptions = {},
): Promise<Renderer> {
  // 1. Capability Check
  // We check on a temp canvas to avoid "locking" context attributes (alpha, etc.)
  // on the real canvas before we know which renderer to use.
  const supportsWebGL2 = !options.forceCanvas && canUseWebGL2();
  console.log(
    '[SeasonalEffects] Capability Check: WebGL2 =',
    supportsWebGL2,
    'forceCanvas =',
    !!options.forceCanvas,
    'adaptive =',
    !!options.adaptive,
  );

  // 2. Try WebGL2
  if (supportsWebGL2) {
    if (options.adaptive) {
      // Probe: render a handful of clears to estimate per-frame cost
      const probeCanvas = document.createElement('canvas');
      probeCanvas.width = 200;
      probeCanvas.height = 120;
      const start = performance.now();
      let ok = true;
      try {
        const gl = probeCanvas.getContext('webgl2');
        if (!gl) ok = false;
        else {
          for (let i = 0; i < 60; i++) {
            gl.clearColor(0, 0, 0, 0);
            gl.clear(gl.COLOR_BUFFER_BIT);
          }
          gl.getExtension('WEBGL_lose_context')?.loseContext();
        }
      } catch {
        ok = false;
      }
      const elapsed = performance.now() - start;
      const avg = elapsed / 60;

      if (!ok || avg > 2.5) {
        console.warn(
          '[SeasonalEffects] Adaptive probe: WebGL2 too slow, using Canvas2D',
          { avgMs: avg },
        );
      } else {
        try {
          console.log('[SeasonalEffects] Adaptive probe passed; using WebGL2');
          const renderer = new WebGL2Renderer(canvas);
          await renderer.init();
          return renderer;
        } catch (e) {
          console.warn(
            '[SeasonalEffects] WebGL2 init failed after probe; falling back to Canvas2D',
            e,
          );
        }
      }
    } else {
      try {
        console.log('[SeasonalEffects] Attempting WebGL2 init...');
        const renderer = new WebGL2Renderer(canvas);
        await renderer.init(); // CRITICAL: Ensure GL resources are created
        console.log('[SeasonalEffects] WebGL2 init success.');
        return renderer;
      } catch (e) {
        console.warn(
          '[SeasonalEffects] WebGL2 init failed despite capability check; falling back to Canvas2D',
          e,
        );
        // Fall through to Canvas2D
      }
    }
  }

  // 3. Fallback to Canvas2D
  console.log('[SeasonalEffects] Falling back to Canvas2D');
  const renderer = new Canvas2DRenderer(canvas);
  await renderer.init(); // CRITICAL: Matches interface signature
  return renderer;
}
