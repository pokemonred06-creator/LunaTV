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

export async function createRenderer(
  canvas: HTMLCanvasElement,
): Promise<Renderer> {
  // 1. Capability Check
  // We check on a temp canvas to avoid "locking" context attributes (alpha, etc.)
  // on the real canvas before we know which renderer to use.
  // FIXME: Forcing Canvas2D for Release 9.6 until WebGL2 is stable.
  const supportsWebGL2 = canUseWebGL2();
  console.log('[SeasonalEffects] Capability Check: WebGL2 =', supportsWebGL2);

  // 2. Try WebGL2
  if (supportsWebGL2) {
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

  // 3. Fallback to Canvas2D
  console.log('[SeasonalEffects] Falling back to Canvas2D');
  const renderer = new Canvas2DRenderer(canvas);
  await renderer.init(); // CRITICAL: Matches interface signature
  return renderer;
}
