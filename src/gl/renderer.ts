import { FRAG_LAYER, FRAG_UPRIGHT_HDR, FRAG_UPRIGHT_RGB, VERT } from './shaders';
import type { Rect } from '../crop';
import type { Transfer } from '../types';

/** A decoded source converted to an upright, SDR, sRGB texture. */
export interface UprightTexture {
  tex: WebGLTexture;
  width: number;
  height: number;
}

/** What pass 1 needs to know about a frame. */
export interface FrameInput {
  /** VideoFrame, ImageBitmap or canvas. */
  image: TexImageSource;
  /** Pixel data is `codedWidth x codedHeight`, drawn upright after `rotation`. */
  rotation: 0 | 90 | 180 | 270;
  transfer: Transfer;
}

export interface Layer {
  src: UprightTexture;
  rect: Rect;
  opacity: number;
}

type Program = { prog: WebGLProgram; loc: (name: string) => WebGLUniformLocation | null };

const RAW_HDR_FORMATS: Record<string, { chromaDiv: [number, number]; codeScale: number }> = {
  I420P10: { chromaDiv: [2, 2], codeScale: 1 },
  I422P10: { chromaDiv: [2, 1], codeScale: 1 },
  I444P10: { chromaDiv: [1, 1], codeScale: 1 },
  I420P12: { chromaDiv: [2, 2], codeScale: 0.25 },
  I422P12: { chromaDiv: [2, 1], codeScale: 0.25 },
  I444P12: { chromaDiv: [1, 1], codeScale: 0.25 },
};

/** Which conversion pass 1 used for the last frame — surfaced in the UI and tests. */
export type ConversionPath = 'rgb' | 'hdr-shader' | 'hdr-browser';

/**
 * WebGL2 compositor shared by preview, analysis and export so every path renders
 * pixels identically.
 */
export class Renderer {
  readonly gl: WebGL2RenderingContext;
  private rgbProg: Program;
  private hdrProg: Program;
  private layerProg: Program;
  private scratch: WebGLTexture;
  private planeTex: WebGLTexture[];
  private fbo: WebGLFramebuffer;
  lastPath: ConversionPath = 'rgb';

  constructor(readonly canvas: HTMLCanvasElement | OffscreenCanvas) {
    const gl = canvas.getContext('webgl2', {
      alpha: false,
      antialias: false,
      premultipliedAlpha: false,
      preserveDrawingBuffer: true,
    }) as WebGL2RenderingContext | null;
    if (!gl) throw new Error('WebGL2 is not available in this browser.');
    this.gl = gl;
    this.rgbProg = this.program(FRAG_UPRIGHT_RGB);
    this.hdrProg = this.program(FRAG_UPRIGHT_HDR);
    this.layerProg = this.program(FRAG_LAYER);

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    this.scratch = this.makeTex(gl.LINEAR, gl.LINEAR);
    this.planeTex = [0, 1, 2].map(() => this.makeTex(gl.NEAREST, gl.NEAREST));
    this.fbo = gl.createFramebuffer()!;
  }

  get width() {
    return this.canvas.width;
  }
  get height() {
    return this.canvas.height;
  }

  createUpright(): UprightTexture {
    const gl = this.gl;
    return { tex: this.makeTex(gl.LINEAR_MIPMAP_LINEAR, gl.LINEAR), width: 0, height: 0 };
  }

  deleteUpright(t: UprightTexture) {
    this.gl.deleteTexture(t.tex);
  }

  /**
   * Pass 1: convert a decoded frame into `dst`, upright and SDR. HDR frames whose
   * planar 10/12-bit data the browser exposes go through our own tone mapping.
   */
  async loadFrame(dst: UprightTexture, input: FrameInput, maxSide = 4096) {
    const gl = this.gl;
    const frame = input.image as VideoFrame;
    const isFrame = typeof VideoFrame !== 'undefined' && input.image instanceof VideoFrame;
    const codedW = isFrame ? frame.displayWidth : (input.image as ImageBitmap).width;
    const codedH = isFrame ? frame.displayHeight : (input.image as ImageBitmap).height;
    const swap = input.rotation === 90 || input.rotation === 270;
    let w = swap ? codedH : codedW;
    let h = swap ? codedW : codedH;
    const s = Math.min(1, maxSide / Math.max(w, h));
    w = Math.round(w * s);
    h = Math.round(h * s);

    const raw = isFrame && input.transfer !== 'sdr' && frame.format ? RAW_HDR_FORMATS[frame.format] : undefined;
    // Allocate the destination on a unit no input uses.
    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, dst.tex);
    if (dst.width !== w || dst.height !== h) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      dst.width = w;
      dst.height = h;
    }
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.activeTexture(gl.TEXTURE0);

    let prog: Program;
    if (raw) {
      await this.uploadPlanes(frame, raw.chromaDiv);
      prog = this.hdrProg;
      gl.useProgram(prog.prog);
      gl.uniform1i(prog.loc('u_y'), 0);
      gl.uniform1i(prog.loc('u_u'), 1);
      gl.uniform1i(prog.loc('u_v'), 2);
      gl.uniform2f(prog.loc('u_size'), frame.visibleRect!.width, frame.visibleRect!.height);
      gl.uniform2f(prog.loc('u_chromaDiv'), raw.chromaDiv[0], raw.chromaDiv[1]);
      gl.uniform1f(prog.loc('u_codeScale'), raw.codeScale);
      gl.uniform1i(prog.loc('u_transfer'), input.transfer === 'hlg' ? 1 : 2);
      this.lastPath = 'hdr-shader';
    } else {
      // The browser converts YCbCr (and tone maps HDR it keeps on the GPU) itself.
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.scratch);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
      gl.pixelStorei(gl.UNPACK_ROW_LENGTH, 0);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, input.image);
      prog = this.rgbProg;
      gl.useProgram(prog.prog);
      gl.uniform1i(prog.loc('u_tex'), 0);
      this.lastPath = input.transfer === 'sdr' ? 'rgb' : 'hdr-browser';
    }
    gl.uniform1i(prog.loc('u_rotation'), input.rotation);
    gl.uniform1f(prog.loc('u_flipY'), 0);

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, dst.tex, 0);
    gl.viewport(0, 0, w, h);
    gl.disable(gl.BLEND);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, dst.tex);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.bindTexture(gl.TEXTURE_2D, null);
  }

  private async uploadPlanes(frame: VideoFrame, chromaDiv: [number, number]) {
    const gl = this.gl;
    const buf = new Uint8Array(frame.allocationSize());
    const layout = await frame.copyTo(buf);
    const w = frame.visibleRect!.width;
    const h = frame.visibleRect!.height;
    const sizes: [number, number][] = [
      [w, h],
      [Math.ceil(w / chromaDiv[0]), Math.ceil(h / chromaDiv[1])],
      [Math.ceil(w / chromaDiv[0]), Math.ceil(h / chromaDiv[1])],
    ];
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 2);
    for (let i = 0; i < 3; i++) {
      const [pw, ph] = sizes[i];
      const { offset, stride } = layout[i];
      const plane = new Uint16Array(buf.buffer, buf.byteOffset + offset, (stride / 2) * (ph - 1) + pw);
      gl.activeTexture(gl.TEXTURE0 + i);
      gl.bindTexture(gl.TEXTURE_2D, this.planeTex[i]);
      gl.pixelStorei(gl.UNPACK_ROW_LENGTH, stride / 2);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R16UI, pw, ph, 0, gl.RED_INTEGER, gl.UNSIGNED_SHORT, plane);
    }
    gl.pixelStorei(gl.UNPACK_ROW_LENGTH, 0);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    gl.activeTexture(gl.TEXTURE0);
  }

  /** Pass 2: composite layers onto the canvas (or into a texture target). */
  drawLayers(layers: Layer[], background: [number, number, number] = [0, 0, 0]) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.width, this.height);
    gl.clearColor(background[0], background[1], background[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    const p = this.layerProg;
    gl.useProgram(p.prog);
    gl.uniform1f(p.loc('u_flipY'), 1);
    gl.uniform1i(p.loc('u_tex'), 0);
    gl.activeTexture(gl.TEXTURE0);
    for (const l of layers) {
      if (!l.src.width || l.opacity <= 0) continue;
      gl.bindTexture(gl.TEXTURE_2D, l.src.tex);
      gl.uniform4f(p.loc('u_rect'), l.rect.x, l.rect.y, l.rect.w, l.rect.h);
      gl.uniform1f(p.loc('u_opacity'), l.opacity);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }
    gl.disable(gl.BLEND);
  }

  /** Reads the canvas back as top-down RGBA. */
  readPixels(): Uint8Array {
    const gl = this.gl;
    const w = this.width;
    const h = this.height;
    const px = new Uint8Array(w * h * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
    const row = w * 4;
    const tmp = new Uint8Array(row);
    for (let y = 0; y < h >> 1; y++) {
      const a = y * row;
      const b = (h - 1 - y) * row;
      tmp.set(px.subarray(a, a + row));
      px.copyWithin(a, b, b + row);
      px.set(tmp, b);
    }
    return px;
  }

  private makeTex(min: number, mag: number) {
    const gl = this.gl;
    const t = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, min);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, mag);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindTexture(gl.TEXTURE_2D, null);
    return t;
  }

  private program(frag: string): Program {
    const gl = this.gl;
    const compile = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader error');
      return s;
    };
    const prog = gl.createProgram()!;
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, frag));
    gl.bindAttribLocation(prog, 0, 'a_pos');
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) ?? 'link error');
    const cache = new Map<string, WebGLUniformLocation | null>();
    return {
      prog,
      loc: (n) => {
        if (!cache.has(n)) cache.set(n, gl.getUniformLocation(prog, n));
        return cache.get(n)!;
      },
    };
  }
}
