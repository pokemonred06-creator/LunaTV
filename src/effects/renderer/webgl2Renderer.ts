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
  private fboDistort: WebGLFramebuffer | null = null;
  private texDistort: WebGLTexture | null = null;
  private texBG: WebGLTexture | null = null;
  private lastUploadedBG: HTMLImageElement | null = null;

  // CSS pixel size (logical coordinates used by the physics/state).
  private cssWidth = 0;
  private cssHeight = 0;
  // Backbuffer size in device pixels (used for canvas + FBO allocation).
  private fbWidth = 0;
  private fbHeight = 0;
  private dpr = 1;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private extMinMax: any = null; // EXT_color_buffer_float

  constructor(private canvas: HTMLCanvasElement) {
    // defer init
  }

  onContextLost(): void {
    console.warn('[WebGL2] Context Lost');
    this.gl = null;
  }

  async onContextRestored(): Promise<void> {
    console.log('[WebGL2] Context Restored');
    this.initGL();
  }

  destroy(): void {
    console.log('[WebGL2] Destroying renderer');
    const gl = this.gl;
    if (!gl) return;

    // Delete Shaders & Programs
    const deleteProgram = (prog: WebGLProgram | null) => {
      if (!prog) return;
      const shaders = gl.getAttachedShaders(prog);
      if (shaders) {
        shaders.forEach((s) => {
          gl.detachShader(prog, s);
          gl.deleteShader(s);
        });
      }
      gl.deleteProgram(prog);
    };

    deleteProgram(this.programDrop);
    deleteProgram(this.programTrail);
    deleteProgram(this.programComposite);
    deleteProgram(this.programSprite);

    // Delete VAOs
    const deleteVAO = (vao: WebGLVertexArrayObject | null) => {
      if (vao) gl.deleteVertexArray(vao);
    };
    deleteVAO(this.vaoDrop);
    deleteVAO(this.vaoTrail);
    deleteVAO(this.vaoQuad);
    deleteVAO(this.vaoSprite);

    // Delete Buffers
    const deleteBuf = (buf: WebGLBuffer | null) => {
      if (buf) gl.deleteBuffer(buf);
    };
    deleteBuf(this.bufDropInst);
    deleteBuf(this.bufTrailInst);
    deleteBuf(this.bufSpriteQuad);
    deleteBuf(this.bufSpriteInst);

    // Delete Textures & FBOs
    const deleteTex = (tex: WebGLTexture | null) => {
      if (tex) gl.deleteTexture(tex);
    };
    deleteTex(this.tex1);
    deleteTex(this.tex2);
    deleteTex(this.texDistort);
    deleteTex(this.texBG);
    deleteTex(this.texSprites);

    const deleteFBO = (fbo: WebGLFramebuffer | null) => {
      if (fbo) gl.deleteFramebuffer(fbo);
    };
    deleteFBO(this.fbo1);
    deleteFBO(this.fbo2);
    deleteFBO(this.fboDistort);

    this.gl = null;
    this.programDrop = null;
    this.programTrail = null;
    this.programComposite = null;
    this.programSprite = null;
    this.vaoDrop = null;
    this.vaoTrail = null;
    this.vaoQuad = null;
    this.vaoSprite = null;
    this.fbo1 = null;
    this.tex1 = null;
    this.fbo2 = null;
    this.tex2 = null;
    this.fboDistort = null;
    this.texDistort = null;
    this.texBG = null;
    this.texSprites = null;
    this.bufSpriteQuad = null;
    this.spriteInstCapacity = 0;
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
    // Reserve space for ~1000 drops (increased to 7 floats per drop)
    gl.bufferData(gl.ARRAY_BUFFER, 1000 * 7 * 4, gl.DYNAMIC_DRAW);

    // Stride = 7 * 4 = 28 bytes
    const stride = 28;

    gl.enableVertexAttribArray(1); // i_pos (x,y)
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, stride, 0);
    gl.vertexAttribDivisor(1, 1);

    gl.enableVertexAttribArray(2); // i_params (r, stretch)
    gl.vertexAttribPointer(2, 2, gl.FLOAT, false, stride, 8);
    gl.vertexAttribDivisor(2, 1);

    gl.enableVertexAttribArray(3); // i_vel (vx, vy)
    gl.vertexAttribPointer(3, 2, gl.FLOAT, false, stride, 16);
    gl.vertexAttribDivisor(3, 1);

    gl.enableVertexAttribArray(4); // i_seed (float)
    gl.vertexAttribPointer(4, 1, gl.FLOAT, false, stride, 24);
    gl.vertexAttribDivisor(4, 1);

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
    const w = Math.max(1, this.fbWidth);
    const h = Math.max(1, this.fbHeight);

    // Cleanup previous GPU resources to avoid leaking on resize/re-init.
    const deleteTex = (tex: WebGLTexture | null) => {
      if (tex) gl.deleteTexture(tex);
    };
    const deleteFBO = (fbo: WebGLFramebuffer | null) => {
      if (fbo) gl.deleteFramebuffer(fbo);
    };

    deleteTex(this.texBG);
    deleteTex(this.tex1);
    deleteTex(this.tex2);
    deleteTex(this.texDistort);

    deleteFBO(this.fbo1);
    deleteFBO(this.fbo2);
    deleteFBO(this.fboDistort);

    this.texBG = null;
    this.tex1 = null;
    this.tex2 = null;
    this.texDistort = null;
    this.fbo1 = null;
    this.fbo2 = null;
    this.fboDistort = null;
    this.lastUploadedBG = null;

    // -- Background Texture --
    this.texBG = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.texBG);
    // Initialize with 1x1 transparent pixel to avoid "dark screen" if not uploaded yet
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      1,
      1,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      new Uint8Array([0, 0, 0, 0]),
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

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

    // Distortion FBO (Normals/Offsets)
    const rd = createFBO();
    this.fboDistort = rd.fbo;
    this.texDistort = rd.tex;

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  // --- Sprite Logic ---
  private programSprite: WebGLProgram | null = null;
  private texSprites: WebGLTexture | null = null;
  private vaoSprite: WebGLVertexArrayObject | null = null;
  private bufSpriteQuad: WebGLBuffer | null = null;
  private bufSpriteInst: WebGLBuffer | null = null;
  private spriteInstCapacity = 0;

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
    this.bufSpriteQuad = bufQuad;
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
    this.spriteInstCapacity = 1000;
    gl.bufferData(
      gl.ARRAY_BUFFER,
      this.spriteInstCapacity * 6 * 4,
      gl.DYNAMIC_DRAW,
    );

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
    if (
      this.cssWidth === width &&
      this.cssHeight === height &&
      this.dpr === dpr
    )
      return;
    this.cssWidth = width;
    this.cssHeight = height;
    this.dpr = dpr;

    if (this.canvas) {
      const fbW = Math.max(1, Math.floor(width * dpr));
      const fbH = Math.max(1, Math.floor(height * dpr));
      this.fbWidth = fbW;
      this.fbHeight = fbH;
      this.canvas.width = fbW;
      this.canvas.height = fbH;
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

    gl.viewport(0, 0, this.fbWidth, this.fbHeight);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.useProgram(prog);

    // Uniforms
    const uRes = gl.getUniformLocation(prog, 'u_res');
    // Guard against 0-sized host during initial mount/layout.
    gl.uniform2f(uRes, Math.max(1, this.cssWidth), Math.max(1, this.cssHeight));

    // Texture
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.texSprites);
    const uTex = gl.getUniformLocation(prog, 'u_textures');
    gl.uniform1i(uTex, 0);

    // Instance Data
    const sprites = state.sprites;
    if (sprites.length === 0) return;

    if (this.bufSpriteInst && sprites.length > this.spriteInstCapacity) {
      // Grow buffer to avoid WebGL errors from bufferSubData overflow.
      const gl2 = gl;
      const nextCap = Math.max(
        sprites.length,
        Math.ceil(this.spriteInstCapacity * 1.5),
      );
      this.spriteInstCapacity = nextCap;
      gl2.bindBuffer(gl2.ARRAY_BUFFER, this.bufSpriteInst);
      gl2.bufferData(
        gl2.ARRAY_BUFFER,
        this.spriteInstCapacity * 6 * 4,
        gl2.DYNAMIC_DRAW,
      );
    }

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
    if (
      state.backgroundImage &&
      state.backgroundImage !== this.lastUploadedBG
    ) {
      gl.bindTexture(gl.TEXTURE_2D, this.texBG);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        state.backgroundImage,
      );
      this.lastUploadedBG = state.backgroundImage;
    }

    gl.viewport(0, 0, this.fbWidth, this.fbHeight);

    // 1. Trail Ping-Pong (Decay/Accumulation)
    const srcFbo = this.fbo1;
    const srcTex = this.tex1;
    const dstFbo = this.fbo2;
    const dstTex = this.tex2;
    this.fbo1 = dstFbo;
    this.tex1 = dstTex;
    this.fbo2 = srcFbo;
    this.tex2 = srcTex;

    gl.bindFramebuffer(gl.FRAMEBUFFER, dstFbo);
    gl.useProgram(programTrail);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    if (state.trails.length > 0) {
      const arr = new Float32Array(state.trails.length * 6);
      for (let i = 0; i < state.trails.length; i++) {
        const t = state.trails[i];
        const off = i * 6;
        arr[off + 0] = t.x1;
        arr[off + 1] = t.y1;
        arr[off + 2] = t.x2;
        arr[off + 3] = t.y2;
        arr[off + 4] = t.w;
        arr[off + 5] = t.life;
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, this.bufTrailInst);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, arr);

      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.uniform2f(
        gl.getUniformLocation(programTrail, 'u_res'),
        Math.max(1, this.cssWidth),
        Math.max(1, this.cssHeight),
      );
      gl.uniform1i(gl.getUniformLocation(programTrail, 'u_pass'), 0); // Pass 0: Decay Accumulation
      gl.bindVertexArray(this.vaoTrail);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, state.trails.length);
    }

    // --- PASS 2: Distortion Map (Normals / Offsets) ---
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fboDistort);
    gl.clearColor(0.5, 0.5, 0, 0); // Neutral Normal (0.5, 0.5)
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    // A. Fill Distortion from Trails
    if (state.trails.length > 0) {
      gl.useProgram(programTrail);
      gl.uniform1i(gl.getUniformLocation(programTrail, 'u_pass'), 1); // Pass 1: Distortion/Normals
      gl.bindVertexArray(this.vaoTrail);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, state.trails.length);
    }

    // B. Fill Distortion from Drops
    if (state.drops.length > 0) {
      gl.useProgram(programDrop);
      const arr = new Float32Array(state.drops.length * 7);
      for (let i = 0; i < state.drops.length; i++) {
        const d = state.drops[i];
        const off = i * 7;
        arr[off + 0] = d.x;
        arr[off + 1] = d.y;
        arr[off + 2] = d.r;
        arr[off + 3] = d.stretch;
        arr[off + 4] = d.vx;
        arr[off + 5] = d.vy;
        arr[off + 6] = d.seed || 0; // Pass seed
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, this.bufDropInst);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, arr);

      gl.uniform2f(
        gl.getUniformLocation(programDrop, 'u_res'),
        Math.max(1, this.cssWidth),
        Math.max(1, this.cssHeight),
      );
      gl.bindVertexArray(this.vaoDrop);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, state.drops.length);
    }

    // --- PASS 3: Final Composite (Refractive) ---
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(programComposite);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texBG);
    gl.uniform1i(gl.getUniformLocation(programComposite, 'u_texBG'), 0);

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.texDistort);
    gl.uniform1i(gl.getUniformLocation(programComposite, 'u_texDistort'), 1);

    gl.uniform2f(
      gl.getUniformLocation(programComposite, 'u_res'),
      Math.max(1, this.cssWidth),
      Math.max(1, this.cssHeight),
    );

    // Pass Flash State
    gl.uniform1f(
      gl.getUniformLocation(programComposite, 'u_flash'),
      state.flash,
    );

    // Calculate Cover/Scale for BG
    let bgW = 1,
      bgH = 1;
    if (state.backgroundImage) {
      bgW = state.backgroundImage.naturalWidth || 1;
      bgH = state.backgroundImage.naturalHeight || 1;
    }
    const safeW = Math.max(1, this.cssWidth);
    const safeH = Math.max(1, this.cssHeight);
    const screenAspect = safeW / safeH;
    const bgAspect = bgW / bgH;
    let scaleX = 1,
      scaleY = 1;

    if (screenAspect > bgAspect) {
      // Screen wider than BG -> BG needs to be wider (zoom width to fit)
      // Actually CSS 'cover' logic:
      scaleY = safeW / bgAspect / safeH;
    } else {
      scaleX = (safeH * bgAspect) / safeW;
    }

    gl.uniform2f(
      gl.getUniformLocation(programComposite, 'u_bgScale'),
      scaleX,
      scaleY,
    );

    gl.bindVertexArray(this.vaoQuad);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
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
layout(location = 1) in vec2 i_pos;    // x, y
layout(location = 2) in vec2 i_params; // r, stretch
layout(location = 3) in vec2 i_vel;    // vx, vy
layout(location = 4) in float i_seed;  // Stable seed

uniform vec2 u_res;

out vec2 v_uv;
out vec2 v_localUV;
out float v_radius;
out float v_stretch;
out vec2 v_vel;
out float v_seed;

void main() {
  v_seed = i_seed;
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
      stretchFactor = 1.5; 
  }
  
  float sy = 1.0 + stretch * stretchFactor;
  float sx = 1.0 / sqrt(sy); 
  
  // Allow shrinking down to 0.25 (Thicker streaks)
  sx = max(0.25, 1.0 - stretch * 0.5); 

  vec2 scale = vec2(r * sx, r * sy);
  vec2 worldPos = i_pos + pos * 2.0 * scale; 
  
  gl_Position = vec4( (worldPos / u_res) * 2.0 - 1.0, 0.0, 1.0);
  gl_Position.y = -gl_Position.y; // Flip Y
  
  v_uv = pos + 0.5; // 0..1
  v_localUV = pos;  // -0.5..0.5
  v_radius = r;
  v_stretch = stretch;
  v_vel = i_vel;
}
`;

const fsDrop = `#version 300 es
precision highp float;
in vec2 v_uv;     // 0..1 in drop quad
in vec2 v_localUV; 
in float v_radius;
in float v_stretch;
in vec2 v_vel;
in float v_seed;

out vec4 fragColor;

void main() {
  vec2 p = v_uv - 0.5;
  
  // Raindrop shape: Sphere with stretch
  p.y /= (1.0 + v_stretch * 0.5);
  
  // Taper for teardrop shape (trailing tail)
  // If v_stretch > 0, we want the top (p.y > 0) to be thinner.
  // Multiplying p.x by a factor > 1 makes effective width smaller.
  // User dislike "bullet shape", so we reduce taper strength and randomize it
  float taperStrength = 1.0 + sin(v_seed * 43.0) * 0.5; // Random taper 0.5..1.5
  float taper = 1.0 + (p.y + 0.5) * v_stretch * taperStrength * 2.0; 
  p.x *= taper;
  
  // --- Organic Shape Distortion (User Request) ---
  // 1. Angular Waviness (not perfect circle)
  // Use v_seed so every drop is different but STABLE (no spinning)
  float angle = atan(p.y, p.x);
  float seed = v_seed * 13.54;
  
  // Combine low-freq and high-freq sine waves to distort the edge
  float wave = sin(angle * 3.0 + seed) * 0.04;     // Main shape wobble
  wave += sin(angle * 7.0 - seed * 2.0) * 0.02;    // Finer detail
  wave += sin(angle * 13.0 + seed * 5.0) * 0.01;   // Micro irregularities
  
  // 2. Alpha Erosion / Edge Roughness
  // Simulate "imperfect wetting" by adding noise to the distance field
  float noise = fract(sin(dot(v_uv * 10.0, vec2(12.9898, 78.233))) * 43758.5453);
  float roughness = (noise - 0.5) * 0.03;

  float d = length(p) + wave + roughness;
  
  if (d > 0.48) discard; // Slightly smaller cutoff to account for distortion
  
  // Normal mapping (Spherical + Distortion)
  // We need to perturb the normal to match the new shape "feeling"
  // z = sqrt(1 - x^2 - y^2)
  float z = sqrt(max(0.0, 0.25 - d * d));
  vec3 normal = normalize(vec3(p.x, p.y, z));
  
  // Add surface noise to normal (glass defects)
  normal.xy += (noise - 0.5) * 0.1;
  normal = normalize(normal);
  
  // Specular highlight
  vec3 lightDir = normalize(vec3(0.5, 0.5, 1.0));
  float spec = pow(max(dot(normal, lightDir), 0.0), 30.0);
  
  // Mask for composition
  float mask = smoothstep(0.48, 0.42, d);
  
  // Pack normals: rg=normal.xy (0..1), b=spec, a=mask
  fragColor = vec4(normal.xy * 0.5 + 0.5, spec, mask);
}
`;

const vsTrail = `#version 300 es
layout(location=0) in vec2 pos;
layout(location=1) in vec2 i_p1;
layout(location=2) in vec2 i_p2;
layout(location=3) in vec2 i_props; // w, life

uniform vec2 u_res;
out float v_life;
out vec2 v_localUV;

void main() {
  // Line segment geometry gen
  vec2 dir = i_p2 - i_p1;
  vec2 idir = normalize(vec2(-dir.y, dir.x));
  
  float w = i_props.x;
  
  vec2 p = mix(i_p1, i_p2, pos.y + 0.5);
  p += idir * pos.x * w;
  
  gl_Position = vec4((p / u_res) * 2.0 - 1.0, 0.0, 1.0);
  gl_Position.y = -gl_Position.y;
  
  v_life = i_props.y;
  v_localUV = pos; // -0.5 to 0.5
}
`;

const fsTrail = `#version 300 es
precision mediump float;
in float v_life;
in vec2 v_localUV;
uniform int u_pass;
out vec4 fragColor;
void main() {
  float mask = smoothstep(0.0, 0.2, v_life);
  if (u_pass == 0) {
    fragColor = vec4(0.0, 0.0, 1.0, mask * 0.4);
  } else {
    // Normal/Distortion for trail
    // 1. Cylinder profile for lens effect
    float x = v_localUV.x * 2.0; // -1.0 to 1.0
    
    // Add wobble to the trail path
    float wobble = sin(v_localUV.y * 10.0 + v_life * 5.0) * 0.2;
    x += wobble;
    
    float z = sqrt(max(0.0, 1.0 - x*x));
    vec3 normal = normalize(vec3(x, wobble, z));
    
    // 2. Specular
    vec3 lightDir = normalize(vec3(0.5, 0.5, 1.0));
    float spec = pow(max(dot(normal, lightDir), 0.0), 10.0) * mask;

    // Pack: RG=Normal, B=Spec, A=Mask
    // Increase mask opacity for visibility (0.3 -> 0.6)
    fragColor = vec4(normal.xy * 0.5 + 0.5, spec, mask * 0.6);
  }
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
uniform sampler2D u_texDistort;
uniform vec2 u_res;
uniform vec2 u_bgScale;
uniform float u_flash; // Flash intensity 0..1

out vec4 fragColor;

void main() {
  vec2 uv = v_uv;
  
  // Distort UV is direct (0..1) because FBO is rendered Upright
  vec4 distort = texture(u_texDistort, uv);
  vec2 normal = (distort.rg - 0.5) * 2.0;
  float spec = distort.b;
  float mask = distort.a;
  
  // 1. Refraction Offset (Lens effect)
  // 1. Refraction Offset (Lens effect)
  // Increased strength for "dynamic shaping"
  float strength = 0.12;
  
  // Chromatic Aberration: Different wavelengths bend differently
  vec2 offsetR = normal * strength;
  vec2 offsetG = normal * (strength * 1.03); 
  vec2 offsetB = normal * (strength * 1.06); 
  
  // 2. Sample Background with Refraction + FLIP Y
  // We flip Y for the background sample because Images are loaded top-down into memory bottom-up
  // Sample R
  vec2 bgUVR = vec2(uv.x, 1.0 - uv.y) + offsetR;
  vec2 finalUVR = (bgUVR - 0.5) * u_bgScale + 0.5;
  float rCol = texture(u_texBG, finalUVR).r;
  
  // Sample G (also used for Alpha/Base)
  vec2 bgUVG = vec2(uv.x, 1.0 - uv.y) + offsetG;
  vec2 finalUVG = (bgUVG - 0.5) * u_bgScale + 0.5;
  vec4 bgBase = texture(u_texBG, finalUVG);
  float gCol = bgBase.g;
  
  // Sample B
  vec2 bgUVB = vec2(uv.x, 1.0 - uv.y) + offsetB;
  vec2 finalUVB = (bgUVB - 0.5) * u_bgScale + 0.5;
  float bCol = texture(u_texBG, finalUVB).b;
  
  // Combine Refracted Color (for drops)
  vec3 refractedColor = vec3(rCol, gCol, bCol);
  
  // Base Background: Default to Transparent
  // We do NOT want to draw the full opaque image, as it covers the DOM.
  // We only want to draw the image *inside* the drops (refraction).
  vec4 bg = vec4(0.0);

  // --- FLASH EFFECT ---
  // 1. Global flash (Lightning lights up the sky)
  float flashAlpha = u_flash * 0.4;
  vec3 flashRGB = vec3(0.8, 0.9, 1.0) * flashAlpha;
  
  bg.rgb += flashRGB;
  bg.a = max(bg.a, flashAlpha); // Ensure flash is visible
  
  // 3. Highlight/Lighting on droplets
  if (mask > 0.01) {
    // Apply Refracted Image Color to the Drop
    // Blend logic: we want to see the DOM through the drop (Transparency),
    // but also see the refracted poster (color/shape).
    // Scaling by 0.4 gives 40% Poster visibility, 60% DOM visibility.
    // We check bgBase.a so we don't darken the clear/search page.
    float contentAlpha = bgBase.a * 0.4;
    
    bg.rgb = refractedColor * contentAlpha;
    // Set base alpha (Pre-multiplied)
    bg.a = contentAlpha; 

    // Boost specular massively during flash (Reflecting the light)
    float activeSpec = spec + (u_flash * 2.5 * spec); 
    
    bg.rgb += activeSpec * 0.6;
    bg.rgb += mask * 0.03;
    
    // Alpha Management:
    // Mix in WHITE/CLEAR body color based on transparency
    float alphaFactor = 1.0 - bg.a; 
    
    vec3 clearColor = vec3(0.9, 0.95, 1.0);
    vec3 addedBody = clearColor * alphaFactor * mask * 0.15;
    
    bg.rgb += addedBody;
    
    // Ensure minimum shape visibility via alpha
    float dropAlpha = mask * 0.1 + activeSpec; 
    bg.a = max(bg.a, dropAlpha);
    
    // Boost contrast inside drop
    bg.rgb = mix(bg.rgb, bg.rgb * 1.2, mask * 0.5);
  }
  
  // Final Safety for Premultiplied Alpha
  float maxRGB = max(bg.r, max(bg.g, bg.b));
  if (maxRGB > bg.a) {
      bg.a = maxRGB;
  }
  
  fragColor = bg;
}
`;
