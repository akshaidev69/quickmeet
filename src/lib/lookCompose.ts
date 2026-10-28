type MixKind = 'blur' | 'blurStrong' | 'image';

export class LookComposer {
  readonly canvas: HTMLCanvasElement;
  private gl: WebGLRenderingContext | null;
  private program: WebGLProgram | null = null;
  private loc: Record<string, WebGLUniformLocation | null> = {};
  private texFrame: WebGLTexture | null = null;
  private texMask: WebGLTexture | null = null;
  private texBg: WebGLTexture | null = null;
  private maskCanvas = document.createElement('canvas');
  private bgCanvas = document.createElement('canvas');
  private ema: Float32Array | null = null;
  private prev: Float32Array | null = null;
  private ok = false;

  constructor() {
    this.canvas = document.createElement('canvas');
    this.gl = this.canvas.getContext('webgl', { premultipliedAlpha: false, alpha: false });
    this.ok = Boolean(this.gl) && this.setup();
  }

  get available() {
    return this.ok;
  }

  resize(w: number, h: number) {
    if (this.canvas.width === w && this.canvas.height === h) return;
    this.canvas.width = w;
    this.canvas.height = h;
    this.gl?.viewport(0, 0, w, h);
  }

  mix(
    video: HTMLVideoElement,
    mask: Uint8Array | Float32Array,
    maskW: number,
    maskH: number,
    personHigh: boolean,
    kind: MixKind,
    bg?: CanvasImageSource | null,
  ) {
    const w = this.canvas.width;
    const h = this.canvas.height;
    const gl = this.gl;
    if (!this.ok || !gl || !this.program) return false;
    const alpha = this.smoothMask(mask, maskW, maskH, personHigh);
    this.uploadMask(alpha, maskW, maskH);
    this.paintBackground(kind, video, bg, w, h);
    gl.useProgram(this.program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texFrame);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);
    gl.uniform1i(this.loc.uFrame, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.texMask);
    gl.uniform1i(this.loc.uMask, 1);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.texBg);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.bgCanvas);
    gl.uniform1i(this.loc.uBg, 2);
    gl.uniform2f(this.loc.uSize, w, h);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    return true;
  }

  private smoothMask(mask: Uint8Array | Float32Array, w: number, h: number, personHigh: boolean) {
    const n = w * h;
    if (!this.ema || this.ema.length !== n) {
      this.ema = new Float32Array(n);
      this.prev = new Float32Array(n);
    }
    const ema = this.ema;
    const prev = this.prev!;
    let motion = 0;
    for (let i = 0; i < n; i += 1) {
      const raw = mask[i] / (mask instanceof Uint8Array ? 255 : 1);
      const conf = personHigh ? raw : 1 - raw;
      const edge = conf * conf * (3 - 2 * conf);
      const alpha = edge < 0.3 ? 0 : edge > 0.7 ? 1 : (edge - 0.3) / 0.4;
      motion += Math.abs(alpha - prev[i]);
      prev[i] = alpha;
    }
    const mean = motion / n;
    const keep = mean > 0.08 ? 0.15 : 0.3;
    for (let i = 0; i < n; i += 1) {
      ema[i] = (1 - keep) * prev[i] + keep * ema[i];
    }
    return ema;
  }

  private uploadMask(alpha: Float32Array, w: number, h: number) {
    const gl = this.gl!;
    if (this.maskCanvas.width !== w || this.maskCanvas.height !== h) {
      this.maskCanvas.width = w;
      this.maskCanvas.height = h;
    }
    const ctx = this.maskCanvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;
    const image = ctx.createImageData(w, h);
    for (let i = 0; i < alpha.length; i += 1) {
      const v = Math.max(0, Math.min(255, (alpha[i] * 255) | 0));
      image.data[i * 4] = v;
      image.data[i * 4 + 1] = v;
      image.data[i * 4 + 2] = v;
      image.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(image, 0, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.texMask);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.maskCanvas);
  }

  private paintBackground(kind: MixKind, video: HTMLVideoElement, bg: CanvasImageSource | null | undefined, w: number, h: number) {
    if (this.bgCanvas.width !== w || this.bgCanvas.height !== h) {
      this.bgCanvas.width = w;
      this.bgCanvas.height = h;
    }
    const ctx = this.bgCanvas.getContext('2d');
    if (!ctx) return;
    if (kind === 'image' && bg) {
      ctx.filter = 'none';
      const iw = 'naturalWidth' in bg ? Number(bg.naturalWidth) || w : w;
      const ih = 'naturalHeight' in bg ? Number(bg.naturalHeight) || h : h;
      const scale = Math.max(w / iw, h / ih);
      ctx.drawImage(bg, (w - iw * scale) / 2, (h - ih * scale) / 2, iw * scale, ih * scale);
      return;
    }
    const radius = kind === 'blurStrong' ? 28 : 14;
    ctx.filter = `blur(${radius}px)`;
    const vw = video.videoWidth || w;
    const vh = video.videoHeight || h;
    const scale = Math.max(w / vw, h / vh);
    ctx.drawImage(video, (w - vw * scale) / 2, (h - vh * scale) / 2, vw * scale, vh * scale);
    ctx.filter = 'none';
  }

  private setup() {
    const gl = this.gl;
    if (!gl) return false;
    const vs = `attribute vec2 aPos; varying vec2 vUv; void main(){ vUv = aPos*0.5+0.5; vUv.y = 1.0-vUv.y; gl_Position = vec4(aPos,0.0,1.0); }`;
    const fs = `precision mediump float;
      varying vec2 vUv;
      uniform sampler2D uFrame;
      uniform sampler2D uMask;
      uniform sampler2D uBg;
      uniform vec2 uSize;
      void main() {
        vec4 frame = texture2D(uFrame, vUv);
        float a = texture2D(uMask, vUv).r;
        vec2 px = 1.0 / uSize;
        float blur = 0.0;
        blur += texture2D(uMask, vUv + vec2(-px.x,0.0)).r;
        blur += texture2D(uMask, vUv + vec2(px.x,0.0)).r;
        blur += texture2D(uMask, vUv + vec2(0.0,-px.y)).r;
        blur += texture2D(uMask, vUv + vec2(0.0,px.y)).r;
        a = mix(a, blur * 0.25, 0.45);
        vec4 bg = texture2D(uBg, vUv);
        vec3 wrap = mix(bg.rgb, frame.rgb, 0.12 * a);
        gl_FragColor = vec4(mix(wrap, frame.rgb, a), 1.0);
      }`;
    const program = this.link(vs, fs);
    if (!program) return false;
    this.program = program;
    gl.useProgram(program);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const aPos = gl.getAttribLocation(program, 'aPos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
    this.loc.uFrame = gl.getUniformLocation(program, 'uFrame');
    this.loc.uMask = gl.getUniformLocation(program, 'uMask');
    this.loc.uBg = gl.getUniformLocation(program, 'uBg');
    this.loc.uSize = gl.getUniformLocation(program, 'uSize');
    this.texFrame = this.makeTex();
    this.texMask = this.makeTex();
    this.texBg = this.makeTex();
    return true;
  }

  private makeTex() {
    const gl = this.gl!;
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return tex;
  }

  private link(vsSrc: string, fsSrc: string) {
    const gl = this.gl!;
    const vs = gl.createShader(gl.VERTEX_SHADER)!;
    gl.shaderSource(vs, vsSrc);
    gl.compileShader(vs);
    const fs = gl.createShader(gl.FRAGMENT_SHADER)!;
    gl.shaderSource(fs, fsSrc);
    gl.compileShader(fs);
    const program = gl.createProgram()!;
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return null;
    return program;
  }
}
