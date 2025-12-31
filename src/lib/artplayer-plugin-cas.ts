
import type Artplayer from 'artplayer';

export default function artplayerPluginCas(option: {
    sharpness?: number; // 0.0 - 1.0
} = {}) {
    return (art: Artplayer) => {
        const {
            sharpness = 0.6, // Boosted to 0.6 for visibility
        } = option;

        let isEnabled = false;
        let gl: WebGLRenderingContext | null = null;
        let program: WebGLProgram | null = null;
        let canvas: HTMLCanvasElement | null = null;
        let animationId: number | null = null;
        
        // Cache references
        const video = art.template.$video;

        // Shader Sources
        const vsSource = `
            attribute vec2 position;
            varying vec2 v_texCoord;
            void main() {
                gl_Position = vec4(position, 0.0, 1.0);
                v_texCoord = position * 0.5 + 0.5;
                v_texCoord.y = 1.0 - v_texCoord.y; // Flip Y for WebGL texture
            }
        `;

        const fsSource = `
            precision mediump float;
            varying vec2 v_texCoord;
            uniform sampler2D u_image;
            uniform vec2 u_resolution;
            uniform float u_sharpness;

            void main() {
                vec2 tex = 1.0 / u_resolution;
                
                // Fetch 3x3 neighborhood (Cross pattern)
                vec3 e = texture2D(u_image, v_texCoord).rgb; // Center
                vec3 a = texture2D(u_image, v_texCoord + vec2(0.0, -tex.y)).rgb; // Up
                vec3 c = texture2D(u_image, v_texCoord + vec2(-tex.x, 0.0)).rgb; // Left
                vec3 g = texture2D(u_image, v_texCoord + vec2(tex.x, 0.0)).rgb;  // Right
                vec3 i = texture2D(u_image, v_texCoord + vec2(0.0, tex.y)).rgb;  // Down

                // Contrast Adaptive Sharpening (CAS) Kernel
                // Weight calculation: w = -1.0 / (8.0 * (1.0 - sharpness) + 5.0 * sharpness)
                // This formula ensures the energy is preserved while sharpening.
                float sharp = clamp(u_sharpness, 0.0, 1.0);
                float w = -1.0 / mix(8.0, 5.0, sharp);

                // Convolve
                vec3 res = (a + c + g + i) * w + e;
                float div = 1.0 + 4.0 * w;
                vec3 final = res / div;

                // Anti-Ringing: Clamp result to the min/max of the neighborhood
                // This prevents white/black halos around edges (Ringing artifacts)
                // And effectively disables sharpening on flat surfaces (where min == max == center)
                vec3 mn = min(min(min(a, c), g), i);
                vec3 mx = max(max(max(a, c), g), i);
                mn = min(mn, e);
                mx = max(mx, e);
                
                final = clamp(final, mn, mx);

                gl_FragColor = vec4(final, 1.0);
            }
        `;

        function createShader(gl: WebGLRenderingContext, type: number, source: string) {
            const shader = gl.createShader(type);
            if (!shader) return null;
            gl.shaderSource(shader, source);
            gl.compileShader(shader);
            if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
                console.warn('CAS Shader Error:', gl.getShaderInfoLog(shader));
                gl.deleteShader(shader);
                return null;
            }
            return shader;
        }

        function initWebGL() {
            try {
                canvas = document.createElement('canvas');
                // Style to overlay exactly on video
                canvas.style.position = 'absolute';
                canvas.style.top = '0';
                canvas.style.left = '0';
                canvas.style.width = '100%';
                canvas.style.height = '100%';
                canvas.style.objectFit = 'contain';
                canvas.style.pointerEvents = 'none';
                canvas.style.zIndex = '1';
                
                art.template.$video.parentElement?.insertBefore(canvas, art.template.$video.nextSibling);

                gl = canvas.getContext('webgl', { 
                    alpha: false,
                    preserveDrawingBuffer: false,
                    antialias: false
                });

                if (!gl) {
                    throw new Error('WebGL not supported');
                }

                // Compile Shaders
                const vs = createShader(gl, gl.VERTEX_SHADER, vsSource);
                const fs = createShader(gl, gl.FRAGMENT_SHADER, fsSource);
                if (!vs || !fs) throw new Error('Failed to compile shaders');

                program = gl.createProgram();
                if (!program) throw new Error('Failed to create program');
                
                gl.attachShader(program, vs);
                gl.attachShader(program, fs);
                gl.linkProgram(program);

                if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
                    throw new Error('Failed to link program');
                }

                gl.useProgram(program);

                // Setup Rectangle (Quad)
                const positionBuffer = gl.createBuffer();
                gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
                gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
                    -1.0, -1.0,
                     1.0, -1.0,
                    -1.0,  1.0,
                    -1.0,  1.0,
                     1.0, -1.0,
                     1.0,  1.0,
                ]), gl.STATIC_DRAW);

                const positionLocation = gl.getAttribLocation(program, 'position');
                gl.enableVertexAttribArray(positionLocation);
                gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);

                // Setup Texture
                const texture = gl.createTexture();
                gl.bindTexture(gl.TEXTURE_2D, texture);
                // Set parameters so we can handle non-power-of-2 video dimensions
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

            } catch (err) {
                console.error('CAS Plugin Init Failed:', err);
                art.notice.show = 'Enhance Init Failed: ' + (err as Error).message;
                disable();
            }
        }

        function updateSize() {
            if (!gl || !canvas) return;
            const width = video.videoWidth;
            const height = video.videoHeight;
            
            if (width && height && (canvas.width !== width || canvas.height !== height)) {
                canvas.width = width;
                canvas.height = height;
                gl.viewport(0, 0, width, height);
            }
        }

        function renderLoop() {
            if (!isEnabled || !gl || !program || !canvas) return;

            // Check if video is playing/ready
            if (video.readyState >= video.HAVE_CURRENT_DATA) {
                updateSize();
                
                // Upload video frame to texture
                gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);
                
                // Set Uniforms
                const uResolution = gl.getUniformLocation(program, 'u_resolution');
                const uSharpness = gl.getUniformLocation(program, 'u_sharpness');
                
                gl.uniform2f(uResolution, canvas.width, canvas.height);
                gl.uniform1f(uSharpness, sharpness);

                // Draw
                gl.drawArrays(gl.TRIANGLES, 0, 6);
            }

            animationId = requestAnimationFrame(renderLoop);
        }

        function enable() {
            if (isEnabled) return;
            isEnabled = true;
            
            if (!gl) initWebGL();
            
            // Hide original video but keep it playing
            // We use opacity so it's still technically 'visible' to the browser capability checks
            video.style.opacity = '0'; 
            
            renderLoop();
            
            // Notify user
            art.notice.show = '画质增强 (CAS) 已开启';
        }

        function disable() {
            if (!isEnabled) return;
            isEnabled = false;
            
            if (animationId) cancelAnimationFrame(animationId);
            
            // Show original video
            video.style.opacity = '1';
            
            // Hide canvas if exists
            if (canvas) {
                canvas.remove();
                canvas = null;
                gl = null; // Drop context to free memory
            }
            
            art.notice.show = '画质增强 (CAS) 已关闭';
        }

        // Register Setting
        art.setting.add({
            name: 'cas-enhance',
            width: 250,
            html: '画质增强 (CAS) <span style="font-size:10px;color:#f00;margin-left:5px">Beta</span>',
            tooltip: '使用 GPU 锐化画面，可能增加耗电',
            switch: false,
            onSwitch: (item) => {
                if (item.switch) {
                    disable();
                    item.tooltip = '使用 GPU 锐化画面，可能增加耗电';
                    return false;
                } else {
                    enable();
                    item.tooltip = '点击关闭画质增强';
                    return true;
                }
            },
        });
        
        // Cleanup on destroy
        art.on('destroy', () => {
            disable();
        });

        return {
            name: 'artplayerPluginCas',
        };
    };
}
