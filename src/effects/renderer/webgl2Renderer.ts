import { Renderer, RenderState } from './types';

export class WebGL2Renderer implements Renderer {
  private gl: WebGL2RenderingContext | null = null;
  private programDrop: WebGLProgram | null = null;
  private programTrail: WebGLProgram | null = null;
  private programComposite: WebGLProgram | null = null;

  private vaoDrop: WebGLVertexArrayObject | null = null;
  private vaoTrail: WebGLVertexArrayObject | null = null;
  private vaoQuad: WebGLVertexArrayObject | null = null;

  // FBOs for Ping-Pong
  private fbo1: WebGLFramebuffer | null = null;
  private tex1: WebGLTexture | null = null;
  private fbo2: WebGLFramebuffer | null = null;
  private tex2: WebGLTexture | null = null;
  private texBG: WebGLTexture | null = null;

  private width = 0;
  private height = 0;
  private dpr = 1;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private extMinMax: any = null; // EXT_color_buffer_float

  constructor(private canvas: HTMLCanvasElement) {
    // defer init
  }

  onContextLost(): void {
    throw new Error('Method not implemented.');
  }
  onContextRestored(): Promise<void> {
    throw new Error('Method not implemented.');
  }
  destroy(): void {
    throw new Error('Method not implemented.');
  }

  async init(): Promise<void> {
    this.initGL();
  }

  private initGL() {
    const gl = this.canvas.getContext('webgl2', {
      alpha: true,
      depth: false,
      stencil: false,
      antialias: false,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: false,
    });

    if (!gl) {
      throw new Error('WebGL2 not supported');
    }
    this.gl = gl;
    this.extMinMax = gl.getExtension('EXT_color_buffer_float');
    console.log('[WebGL2] Context created. Extensions:', {
      extMinMax: !!this.extMinMax,
    });

    this.programDrop = this.createProgram(vsDrop, fsDrop);
    this.programTrail = this.createProgram(vsTrail, fsTrail);
    this.programComposite = this.createProgram(vsComposite, fsComposite);

    this.initBuffers();
    this.initFBOs();
  }

  private compileShader(type: number, source: string): WebGLShader | null {
    const gl = this.gl!;
    const shader = gl.createShader(type);
    if (!shader) return null;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.error('Shader compile error:', gl.getShaderInfoLog(shader));
      gl.deleteShader(shader);
      return null;
    }
    return shader;
  }

  private createShader(type: number, source: string): WebGLShader {
    const gl = this.gl!;
    const shader = gl.createShader(type)!;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.error('Shader compile error:', gl.getShaderInfoLog(shader));
      gl.deleteShader(shader);
      throw new Error('Shader compile failed');
    }
    return shader;
  }

  private createProgram(vsSrc: string, fsSrc: string): WebGLProgram {
    const gl = this.gl!;
    const vs = this.createShader(gl.VERTEX_SHADER, vsSrc);
    const fs = this.createShader(gl.FRAGMENT_SHADER, fsSrc);
    const prog = gl.createProgram()!;
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      console.error('Program link error:', gl.getProgramInfoLog(prog));
      throw new Error('Program link failed');
    }
    return prog;
  }

  private initBuffers() {
    const gl = this.gl!;

    // -- Drop VAO (Instanced) --
    // Base geometry: Unit Quad centered at 0,0 (-0.5 to 0.5)
    const quadVerts = new Float32Array([
      -0.5, -0.5, 0.5, -0.5, -0.5, 0.5, -0.5, 0.5, 0.5, -0.5, 0.5, 0.5,
    ]);
    this.vaoDrop = gl.createVertexArray();
    gl.bindVertexArray(this.vaoDrop);

    const bufDropGeom = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, bufDropGeom);
    gl.bufferData(gl.ARRAY_BUFFER, quadVerts, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); // pos
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    // Instance Buffer (Dynamic)
    // x, y, r, stretch, vx, vy
    const bufDropInst = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, bufDropInst);
    // Reserve space for ~1000 drops
    gl.bufferData(gl.ARRAY_BUFFER, 1000 * 6 * 4, gl.DYNAMIC_DRAW);

    gl.enableVertexAttribArray(1); // i_pos (x,y)
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 24, 0);
    gl.vertexAttribDivisor(1, 1);

    gl.enableVertexAttribArray(2); // i_params (r, stretch)
    gl.vertexAttribPointer(2, 2, gl.FLOAT, false, 24, 8);
    gl.vertexAttribDivisor(2, 1);

    gl.enableVertexAttribArray(3); // i_vel (vx, vy)
    gl.vertexAttribPointer(3, 2, gl.FLOAT, false, 24, 16);
    gl.vertexAttribDivisor(3, 1);

    gl.bindVertexArray(null);

    // -- Trail VAO (Instanced Lines/Quads) --
    // We'll draw them as instanced quads stretched between p1, p2
    this.vaoTrail = gl.createVertexArray();
    gl.bindVertexArray(this.vaoTrail);
    gl.bindBuffer(gl.ARRAY_BUFFER, bufDropGeom); // Reuse quad geom
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    // Instance Buffer
    // x1, y1, x2, y2, w, life
    const bufTrailInst = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, bufTrailInst);
    gl.bufferData(gl.ARRAY_BUFFER, 2000 * 6 * 4, gl.DYNAMIC_DRAW);

    gl.enableVertexAttribArray(1); // i_p1
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 24, 0);
    gl.vertexAttribDivisor(1, 1);

    gl.enableVertexAttribArray(2); // i_p2
    gl.vertexAttribPointer(2, 2, gl.FLOAT, false, 24, 8);
    gl.vertexAttribDivisor(2, 1);

    gl.enableVertexAttribArray(3); // i_props (w, life)
    gl.vertexAttribPointer(3, 2, gl.FLOAT, false, 24, 16);
    gl.vertexAttribDivisor(3, 1);

    gl.bindVertexArray(null);

    // -- Composite Quad VAO --
    this.vaoQuad = gl.createVertexArray();
    gl.bindVertexArray(this.vaoQuad);
    gl.bindBuffer(gl.ARRAY_BUFFER, bufDropGeom);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);

    // Save buffer refs to class for updating
    this.bufDropInst = bufDropInst;
    this.bufTrailInst = bufTrailInst;
  }

  private bufDropInst: WebGLBuffer | null = null;
  private bufTrailInst: WebGLBuffer | null = null;

  private initFBOs() {
    const gl = this.gl!;
    const w = Math.max(1, this.width);
    const h = Math.max(1, this.height);

    const createFBO = () => {
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA16F,
        w,
        h,
        0,
        gl.RGBA,
        gl.HALF_FLOAT,
        null,
      );
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

      const fbo = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(
        gl.FRAMEBUFFER,
        gl.COLOR_ATTACHMENT0,
        gl.TEXTURE_2D,
        tex,
        0,
      );
      return { fbo, tex };
    };

    const r1 = createFBO();
    this.fbo1 = r1.fbo;
    this.tex1 = r1.tex;
    const r2 = createFBO();
    this.fbo2 = r2.fbo;
    this.tex2 = r2.tex;

    // BG Texture
    this.texBG = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.texBG);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    // Initial 1x1 black
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      1,
      1,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      new Uint8Array([0, 0, 0, 255]),
    );

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  // --- Sprite Logic ---
  private programSprite: WebGLProgram | null = null;
  private texSprites: WebGLTexture | null = null;
  private vaoSprite: WebGLVertexArrayObject | null = null;
  private bufSpriteInst: WebGLBuffer | null = null;

  private async initSprites(assets: {
    snow?: HTMLImageElement[];
    leaves?: HTMLImageElement[];
    petals?: HTMLImageElement[];
  }) {
    const gl = this.gl!;

    // Compile Sprite Program
    try {
      this.programSprite = this.createProgram(vsSprite, fsSprite);
    } catch (e) {
      console.error('Sprite shader error', e);
      return;
    }
    if (!this.programSprite) return;

    // Create Texture Array
    // We assume max 12 textures (4 per season) 256x256
    const w = 256;
    const h = 256;
    const depth = 12;
    this.texSprites = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.texSprites);
    gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, gl.RGBA8, w, h, depth);

    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    // Upload Textures
    // Index Mapping:
    // 0-3: Snow
    // 4-7: Leaves
    // 8-11: Petals

    const upload = (imgs: HTMLImageElement[] | undefined, offset: number) => {
      if (!imgs) return;
      imgs.forEach((img, i) => {
        if (i >= 4) return;
        gl.texSubImage3D(
          gl.TEXTURE_2D_ARRAY,
          0,
          0,
          0,
          offset + i,
          w,
          h,
          1,
          gl.RGBA,
          gl.UNSIGNED_BYTE,
          img,
        );
      });
    };

    upload(assets.snow, 0);
    upload(assets.leaves, 4);
    upload(assets.petals, 8);

    // VAO
    this.vaoSprite = gl.createVertexArray();
    gl.bindVertexArray(this.vaoSprite);

    // 0: Quad Vertex (Static)
    // We can reuse bufDropGeom from drops! (It's just a quad -0.5..0.5)
    // Wait, bufDropGeom isn't exposed. Let's make a new one to be safe/clean.
    const bufQuad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, bufQuad);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-0.5, -0.5, 0.5, -0.5, -0.5, 0.5, 0.5, 0.5]),
      gl.STATIC_DRAW,
    );
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    // Instance Data
    // x, y, size, rotation, type, opacity
    const bufInst = gl.createBuffer();
    this.bufSpriteInst = bufInst;
    gl.bindBuffer(gl.ARRAY_BUFFER, bufInst);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(1000 * 6), gl.DYNAMIC_DRAW);

    // 1: x,y,size,rot (vec4)
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 24, 0);
    gl.vertexAttribDivisor(1, 1);

    // 2: type, opacity (vec2)
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 2, gl.FLOAT, false, 24, 16);
    gl.vertexAttribDivisor(2, 1);

    gl.vertexAttribDivisor(2, 1);

    gl.bindVertexArray(null);
  }
  resize(width: number, height: number, dpr: number) {
    if (this.width === width && this.height === height && this.dpr === dpr)
      return;
    this.width = width;
    this.height = height;
    this.dpr = dpr;

    if (this.canvas) {
      this.canvas.width = width;
      this.canvas.height = height;
    }

    // Re-init FBOs
    if (this.gl) this.initFBOs();
  }

  render(state: RenderState) {
    const gl = this.gl;
    if (!gl) return;

    // Check if season Changed/Init needed
    if (state.season !== 'summer' && !this.programSprite) {
      // Lazy Init Sprites on first non-summer frame
      this.initSprites(state.assets).catch((e) => console.error(e));
      // Return early this frame
      return;
    }

    if (state.season === 'summer') {
      this.renderGlass(state);
    } else {
      this.renderSprites(state);
    }
  }

  private renderSprites(state: RenderState) {
    const gl = this.gl!;
    const prog = this.programSprite;
    const vao = this.vaoSprite;
    if (!prog || !vao || !this.texSprites) return;

    gl.viewport(0, 0, this.width, this.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.useProgram(prog);

    // Uniforms
    const uRes = gl.getUniformLocation(prog, 'u_res');
    gl.uniform2f(uRes, this.width, this.height);

    // Texture
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.texSprites);
    const uTex = gl.getUniformLocation(prog, 'u_textures');
    gl.uniform1i(uTex, 0);

    // Instance Data
    const sprites = state.sprites;
    if (sprites.length === 0) return;

    const data = new Float32Array(sprites.length * 6);
    for (let i = 0; i < sprites.length; i++) {
      const s = sprites[i];
      const offset = i * 6;
      data[offset + 0] = s.x;
      data[offset + 1] = s.y;
      data[offset + 2] = s.size;
      data[offset + 3] = s.rotation;
      data[offset + 4] = s.type;
      data[offset + 5] = s.opacity;
    }

    gl.bindBuffer(gl.ARRAY_BUFFER, this.bufSpriteInst);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, data);

    gl.bindVertexArray(vao);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, sprites.length);
    gl.bindVertexArray(null);
  }

  private renderGlass(state: RenderState) {
    const gl = this.gl!;
    const programDrop = this.programDrop;
    const programTrail = this.programTrail;
    const programComposite = this.programComposite;

    if (!programDrop || !programTrail || !programComposite) return;

    // 0. Update BG if changed
    if (state.backgroundImage) {
      gl.bindTexture(gl.TEXTURE_2D, this.texBG);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        state.backgroundImage,
      );
    }

    gl.viewport(0, 0, this.width, this.height);

    // 1. Trail Ping-Pong (Decay)
    // Swap source/dest
    const srcFbo = this.fbo1;
    const srcTex = this.tex1;
    const dstFbo = this.fbo2;
    const dstTex = this.tex2;
    // Swap pointers for next frame
    this.fbo1 = dstFbo;
    this.tex1 = dstTex;
    this.fbo2 = srcFbo;
    this.tex2 = srcTex;

    gl.bindFramebuffer(gl.FRAMEBUFFER, dstFbo);
    gl.useProgram(programTrail);

    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    // Upload Trails
    if (state.trails.length > 0) {
      const arr = new Float32Array(state.trails.length * 6);
      for (let i = 0; i < state.trails.length; i++) {
        const t = state.trails[i];
        arr[i * 6 + 0] = t.x1;
        arr[i * 6 + 1] = t.y1;
        arr[i * 6 + 2] = t.x2;
        arr[i * 6 + 3] = t.y2;
        arr[i * 6 + 4] = t.w;
        arr[i * 6 + 5] = t.life;
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, this.bufTrailInst);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, arr);

      // Draw Trails to Offscreen
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); // Standard blend

      gl.uniform2f(
        gl.getUniformLocation(programTrail, 'u_res'),
        this.width,
        this.height,
      );
      gl.bindVertexArray(this.vaoTrail);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, state.trails.length);
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    // 2. Composite (BG + Trails + Fog)
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    gl.useProgram(programComposite);
    gl.uniform2f(
      gl.getUniformLocation(programComposite, 'u_res'),
      this.width,
      this.height,
    );

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texBG);
    gl.uniform1i(gl.getUniformLocation(programComposite, 'u_texBG'), 0);

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, dstTex); // The trails we just drew
    gl.uniform1i(gl.getUniformLocation(programComposite, 'u_texTrail'), 1);

    gl.bindVertexArray(this.vaoQuad);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    // 3. Draw Drops
    gl.useProgram(programDrop);
    gl.uniform2f(
      gl.getUniformLocation(programDrop, 'u_res'),
      this.width,
      this.height,
    );

    // Reuse BG texture for refraction
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texBG);
    gl.uniform1i(gl.getUniformLocation(programDrop, 'u_texBG'), 0);

    // Aspect Ratio Corection for Background
    let bgScaleX = 1.0;
    let bgScaleY = 1.0;
    if (state.backgroundImage) {
      const iw =
        state.backgroundImage.naturalWidth || state.backgroundImage.width || 1;
      const ih =
        state.backgroundImage.naturalHeight ||
        state.backgroundImage.height ||
        1;
      const screenAspect = this.width / this.height;
      const imgAspect = iw / ih;

      // "Cover" logic
      // If screen is wider than img, we clamp width (1.0) and crop height
      if (screenAspect > imgAspect) {
        // Screen is wider relative to height -> Img width needs to match screen width
        // Img height will be larger than screen height
        // Scale = (ScreenAspect / ImgAspect)?
        // UV = uv * scale + offset
        bgScaleY = screenAspect / imgAspect;
      } else {
        // Screen is taller -> Img height matches screen height
        bgScaleX = imgAspect / screenAspect;
      }
    }
    gl.uniform2f(
      gl.getUniformLocation(programDrop, 'u_bgScale'),
      bgScaleX,
      bgScaleY,
    );

    if (state.drops.length > 0) {
      const arr = new Float32Array(state.drops.length * 6);
      for (let i = 0; i < state.drops.length; i++) {
        const d = state.drops[i];
        arr[i * 6 + 0] = d.x;
        arr[i * 6 + 1] = d.y;
        arr[i * 6 + 2] = d.r;
        arr[i * 6 + 3] = d.stretch;
        arr[i * 6 + 4] = d.vx;
        arr[i * 6 + 5] = d.vy;
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, this.bufDropInst);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, arr);

      gl.bindVertexArray(this.vaoDrop);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, state.drops.length);
    }
  }
}

// --- SHADERS ---

// --- Sprite Shaders (Snow, Leaves, Petals) ---
const vsSprite = `#version 300 es
layout(location=0) in vec2 i_pos;      // Quad vertex (-0.5..0.5)
layout(location=1) in vec4 i_params;   // x,y, size, rotation
layout(location=2) in vec2 i_meta;     // type, opacity

uniform vec2 u_res;

out vec2 v_uv;
out float v_type;
out float v_opacity;

void main() {
  float x = i_params.x;
  float y = i_params.y;
  float size = i_params.z;
  float rot = i_params.w;
  
  float c = cos(rot);
  float s = sin(rot);
  mat2 rotMat = mat2(c, -s, s, c);
  
  vec2 pos = rotMat * i_pos * size;
  vec2 worldPos = vec2(x, y) + pos;
  
  // Normalize to Clip Space (-1..1)
  // 0..w -> -1..1
  vec2 clip = (worldPos / u_res) * 2.0 - 1.0;
  clip.y *= -1.0; // Flip Y
  
  gl_Position = vec4(clip, 0.0, 1.0);
  v_uv = i_pos + 0.5; // 0..1
  v_type = i_meta.x;
  v_opacity = i_meta.y;
}
`;

const fsSprite = `#version 300 es
precision highp float;

in vec2 v_uv;
in float v_type;
in float v_opacity;

uniform sampler2DArray u_textures; // Texture Array for sprites

out vec4 fragColor;

void main() {
  // Sample texture array based on v_type
  vec4 color = texture(u_textures, vec3(v_uv, v_type));
  
  // Apply opacity
  color.a *= v_opacity;
  
  if (color.a < 0.01) discard;
  
  fragColor = color;
}
`;

// --- Drop Shaders (Glass) ---
const vsDrop = `#version 300 es
layout(location=0) in vec2 pos;
layout(location=1) in vec2 i_pos;
layout(location=2) in vec2 i_params; // r, stretch
layout(location=3) in vec2 i_vel;

uniform vec2 u_res;
out vec2 v_uv;
out vec2 v_center;
out float v_r;
out float v_seed; // Random seed

void main() {
  float r = i_params.x;
  float stretch = i_params.y;
  
  // Volume Preservation:
  // As it stretches in Y, it must shrink in X.
  // Canvas: rX = r * (1 - stretch * 0.1), rY = r * (1 + stretch * 0.22)
  // Let's model this carefully.
  
  // Adaptive Stretch
  // Rain (r < 4.0): Allow full stretch (streak)
  // Blob (r > 4.0): Dampen stretch (slug)
  
  float stretchFactor = 4.0;
  if (r > 4.5) { // Slightly higher threshold
      stretchFactor = 0.5; 
  }
  
  float sy = 1.0 + stretch * stretchFactor;
  float sx = 1.0 / sqrt(sy); 
  
  // Allow shrinking down to 0.25 (Thicker streaks)
  sx = max(0.25, 1.0 - stretch * 0.5); 

  vec2 scale = vec2(r * sx, r * sy);
  vec2 worldPos = i_pos + pos * 2.0 * scale; 
  
  gl_Position = vec4( (worldPos / u_res) * 2.0 - 1.0, 0.0, 1.0);
  gl_Position.y = -gl_Position.y; // Flip Y
  
  v_uv = pos * 2.0; // -1 to 1
  v_center = i_pos;
  v_r = r;
  v_seed = fract(sin(dot(i_pos, vec2(12.9898, 78.233))) * 43758.5453);
}
`;

const fsDrop = `#version 300 es
precision highp float;
in vec2 v_uv;
in vec2 v_center;
in float v_r;
in float v_seed;

uniform vec2 u_res;

out vec4 fragColor;

void main() {
  // Polar Coordinates
  float angle = atan(v_uv.y, v_uv.x);
  float radius = length(v_uv);
  
  // Natural Shape Distortion (Amoeba)
  // Combine sin waves based on angle + seed
  // Warp more for condensation (low stretch/radius), less for rain.
  // For now apply globally.
  float warp = sin(angle * 3.0 + v_seed * 10.0) * 0.1 + 
               sin(angle * 5.0 - v_seed * 20.0) * 0.05 +
               sin(angle * 7.0 + v_seed * 5.0) * 0.02;

  float shapeRadius = 1.0 + warp;
  
  // SDF
  float dist = radius / shapeRadius;

  if (dist > 1.0) discard;
  
  vec3 N = vec3(v_uv, sqrt(1.0 - dist*dist));
  
  // Lighting
  vec3 lightDir = normalize(vec3(-0.3, 0.8, 1.0));
  float spec = pow(max(0.0, dot(N, lightDir)), 20.0); // Broader highlight
  float shine = smoothstep(0.2, 1.0, spec);
  
  // Rim (Shadow) - Stronger
  float rim = smoothstep(0.7, 1.0, dist);
  
  // Alpha Composition
  // Shine -> White, High Alpha
  // Rim -> Black, Medium Alpha
  // Body -> Transparent
  
  // White Shine - Boosted Opacity
  vec4 cShine = vec4(1.0, 1.0, 1.0, shine * 0.95);
  
  // Black Rim - Broader and Stronger
  vec4 cRim = vec4(0.0, 0.0, 0.0, rim * 0.6);
  
  // Mix: Rim over Body (Empty), Shine over Rim
  vec4 final = mix(vec4(0.0), cRim, cRim.a);
  final = mix(final, cShine, cShine.a);
  
  // Edge soft clip
  float edgeAlpha = 1.0 - smoothstep(0.95, 1.0, dist);
  final.a *= edgeAlpha;
  
  fragColor = final;
}
`;

const vsTrail = `#version 300 es
layout(location=0) in vec2 pos;
layout(location=1) in vec2 i_p1;
layout(location=2) in vec2 i_p2;
layout(location=3) in vec2 i_props; // w, life

uniform vec2 u_res;
out float v_life;

void main() {
  // Line segment geometry gen
  vec2 dir = i_p2 - i_p1;
  vec2 idir = normalize(vec2(-dir.y, dir.x));
  
  float w = i_props.x;
  // mix based on pos.x (-0.5=p1, 0.5=p2)?? 
  // Wait, we reused quad geom. 
  // Let's assume input pos is -0.5..0.5
  
  vec2 p = mix(i_p1, i_p2, pos.y + 0.5);
  p += idir * pos.x * w;
  
  gl_Position = vec4((p / u_res) * 2.0 - 1.0, 0.0, 1.0);
  gl_Position.y = -gl_Position.y;
  
  v_life = i_props.y;
}
`;

const fsTrail = `#version 300 es
precision mediump float;
in float v_life;
out vec4 fragColor;

void main() {
  // Trail is a disruption mask 
  float alpha = smoothstep(0.0, 0.2, v_life);
  fragColor = vec4(0.0, 0.0, 1.0, alpha * 0.4); // Blue channel = refraction map?
}
`;

const vsComposite = `#version 300 es
layout(location=0) in vec2 pos;
out vec2 v_uv;
void main() {
  v_uv = pos + 0.5;
  gl_Position = vec4(pos * 2.0, 0.0, 1.0);
}
`;

// ...

const fsComposite = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_texBG;
uniform sampler2D u_texTrail;
out vec4 fragColor;

void main() {
  vec2 u = v_uv;
  u.y = 1.0 - u.y; // Texture coords flipped
  
  vec4 trail = texture(u_texTrail, u);
  
  // Apply visual distortion from trail
  vec2 offset = vec2(0.0);
  if (trail.a > 0.0) {
     offset = vec2(sin(u.y*50.0)*0.002, 0.005) * trail.a;
  }
  
  vec3 col = texture(u_texBG, u + offset).rgb;
  
  // Transparency Logic:
  // If we assume we are an OVERLAY, we want to be transparent 
  // unless there is "disturbed glass" (trails/fog).
  // However, pure opacity 0.0 looks invisible.
  // We want a subtle glass tint + strong wetness.
  
  float wetness = trail.a;
  float glassOpacity = 0.05 + wetness * 0.5; // Base subtle tint + wetness
  
  fragColor = vec4(col, glassOpacity);
}
`;
