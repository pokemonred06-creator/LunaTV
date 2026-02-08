export interface DropState {
  x: number;
  y: number;
  r: number;
  vx: number;
  vy: number;
  wobble: number;
  stretch: number;
  age: number;
  falling: boolean;
  isRain: boolean;
  seed: number; // Stable random seed for shape distortion
  trailY: number; // Accumulated distance for trail spawning
}

export interface TrailState {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  w: number;
  life: number;
}

export interface SpriteState {
  x: number;
  y: number;
  size: number;
  rotation: number;
  vx: number;
  vy: number;
  vr: number; // Angular velocity
  type: number; // Texture index (0=Leaf1, 1=Leaf2, etc.)
  opacity: number;
}

export interface RenderState {
  width: number;
  height: number;
  dpr: number;
  season: 'spring' | 'summer' | 'autumn' | 'winter';
  drops: DropState[];
  trails: TrailState[];
  sprites: SpriteState[];
  canvas: HTMLCanvasElement;
  backgroundImage: HTMLImageElement | null;
  assets: {
    snow?: HTMLImageElement[];
    leaves?: HTMLImageElement[];
    petals?: HTMLImageElement[];
  };
  time: number;
  flash: number; // 0.0 to 1.0 intensity
}

export interface Renderer {
  init(): Promise<void>;
  resize(width: number, height: number, dpr: number): void;
  render(state: RenderState): void;
  onContextLost(): void;
  onContextRestored(): Promise<void>;
  destroy(): void;
}
