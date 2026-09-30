import { ALL_FORMATS, BlobSource, Input, VideoSampleSink, type InputVideoTrack, type VideoSample } from 'mediabunny';
import type { Transfer } from '../types';

export function transferOf(t: string | null | undefined): Transfer {
  if (t === 'hlg' || t === 'arib-std-b67') return 'hlg';
  if (t === 'pq' || t === 'smpte2084') return 'pq';
  return 'sdr';
}

export class UnsupportedVideoError extends Error {}

/** A demuxed, decodable video file (MOV/MP4/WebM…) backed by a Blob. */
export class VideoFile {
  private constructor(
    readonly input: Input,
    readonly track: InputVideoTrack,
    readonly sink: VideoSampleSink,
    readonly duration: number,
    readonly firstTimestamp: number,
    readonly rotation: 0 | 90 | 180 | 270,
    readonly width: number,
    readonly height: number,
    readonly transfer: Transfer,
    readonly codec: string,
  ) {}

  static async open(blob: Blob): Promise<VideoFile> {
    const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(blob) });
    const track = await input.getPrimaryVideoTrack();
    if (!track) throw new UnsupportedVideoError('No video track found in this file.');
    const codec = (await track.getCodecParameterString()) ?? (await track.getCodec()) ?? 'unknown';
    if (!(await track.canDecode())) {
      const hevc = /^(hvc1|hev1|dvh1|dvhe)/.test(codec) || (await track.getCodec()) === 'hevc';
      throw new UnsupportedVideoError(
        hevc
          ? 'This is an HEVC (iPhone) video and this computer’s Chrome cannot decode HEVC. Use Chrome or Edge on a Mac or Windows PC with hardware HEVC support.'
          : `This browser cannot decode this video (${codec}).`,
      );
    }
    const first = await track.getFirstTimestamp();
    const end = await track.computeDuration();
    const rotation = (await track.getRotation()) as 0 | 90 | 180 | 270;
    const cs = await track.getColorSpace();
    return new VideoFile(
      input,
      track,
      new VideoSampleSink(track),
      Math.max(0, end - first),
      first,
      rotation,
      await track.getDisplayWidth(),
      await track.getDisplayHeight(),
      transferOf(cs.transfer),
      codec,
    );
  }

  /** Frame at clip-relative time t (seconds from the first frame). Caller must close it. */
  getSample(t: number): Promise<VideoSample | null> {
    return this.sink.getSample(this.firstTimestamp + Math.max(0, t));
  }

  /** Frames for sorted clip-relative timestamps; decodes each packet at most once. */
  async *samplesAt(times: number[]): AsyncGenerator<VideoSample | null> {
    yield* this.sink.samplesAtTimestamps(times.map((t) => this.firstTimestamp + t));
  }

  /** Sequential frames in [start, end) clip-relative. */
  async *samples(start: number, end: number): AsyncGenerator<VideoSample> {
    for await (const s of this.sink.samples(this.firstTimestamp + start, this.firstTimestamp + end)) yield s;
  }

  /** Transfer of a decoded sample, falling back to the track's. */
  sampleTransfer(s: VideoSample): Transfer {
    const t = transferOf(s.colorSpace?.transfer);
    return t === 'sdr' ? this.transfer : t;
  }

  dispose() {
    this.input.dispose();
  }
}

const open = new Map<string, Promise<VideoFile>>();

/** One VideoFile per media id, shared by preview and analysis. */
export function getVideoFile(id: string, blob: () => Promise<Blob>): Promise<VideoFile> {
  let p = open.get(id);
  if (!p) {
    p = blob().then((b) => VideoFile.open(b));
    p.catch(() => open.delete(id));
    open.set(id, p);
  }
  return p;
}

export function closeVideoFile(id: string) {
  const p = open.get(id);
  open.delete(id);
  p?.then((v) => v.dispose()).catch(() => {});
}
