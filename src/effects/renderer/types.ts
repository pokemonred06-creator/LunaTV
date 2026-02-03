export interface DropState {
  x: number;
  y: number;
  r: number;
  vx: number;
  vy: number;
  seed: number;
  wobble: number;
  stretch: number;
  age: number;
  falling: boolean;
}

export interface TrailState {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  w: number;
  life: number;
}

export interface RenderState {
  width: number;
  height: number;
  dpr: number;
  drops: DropState[];
  trails: TrailState[];
  canvas: HTMLCanvasElement;
  backgroundImage: HTMLImageElement | null;
  time: number;
}

export interface Renderer {
  init(): Promise<void>;
  resize(width: number, height: number, dpr: number): void;
  render(state: RenderState): void;
  onContextLost(): void;
  onContextRestored(): Promise<void>;
  destroy(): void;
}
