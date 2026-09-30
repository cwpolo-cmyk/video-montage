import { PHOTO_MAX_SIDE } from '../constants';

export function isHeic(file: { name: string; type: string }) {
  return /image\/hei[cf]/i.test(file.type) || /\.(heic|heif)$/i.test(file.name);
}

/** Sniffs the ISO-BMFF brand for HEIF files that arrive without a useful name/MIME. */
export async function sniffHeic(blob: Blob): Promise<boolean> {
  const head = new Uint8Array(await blob.slice(0, 16).arrayBuffer());
  const box = String.fromCharCode(...head.subarray(4, 12));
  return /^ftyp(heic|heix|hevc|heim|heis|mif1|msf1)/.test(box);
}

type LibHeif = {
  HeifDecoder: new () => {
    decode(data: Uint8Array): Array<{
      get_width(): number;
      get_height(): number;
      display(img: ImageData, cb: (d: ImageData | null) => void): void;
      free(): void;
    }>;
  };
};

let heifPromise: Promise<LibHeif> | null = null;
function loadLibheif(): Promise<LibHeif> {
  heifPromise ??= import('libheif-js/libheif-wasm/libheif-bundle.mjs').then(async (m) => {
    // The bundle's default export is an Emscripten factory with the WASM inlined.
    const lib = (m as { default: () => LibHeif & { ready?: Promise<unknown> } }).default();
    if (lib.ready && typeof lib.ready.then === 'function') await lib.ready;
    return lib;
  });
  return heifPromise;
}

async function decodeHeic(blob: Blob): Promise<ImageBitmap> {
  const libheif = await loadLibheif();
  const decoder = new libheif.HeifDecoder();
  const images = decoder.decode(new Uint8Array(await blob.arrayBuffer()));
  if (!images.length) throw new Error('Could not read this HEIC file.');
  const img = images[0];
  const w = img.get_width();
  const h = img.get_height();
  const data = new ImageData(w, h);
  // libheif applies the file's rotation/mirror (irot/imir) while decoding.
  await new Promise<void>((resolve, reject) =>
    img.display(data, (d) => (d ? resolve() : reject(new Error('HEIC decode failed.')))),
  );
  for (const i of images) i.free();
  return createImageBitmap(data);
}

/** Decodes any supported photo upright (EXIF/HEIF orientation applied) and caps its size. */
export async function decodePhoto(blob: Blob, name = '', maxSide = PHOTO_MAX_SIDE): Promise<ImageBitmap> {
  const heic = isHeic({ name, type: blob.type }) || (await sniffHeic(blob));
  let bmp: ImageBitmap;
  if (heic) {
    bmp = await decodeHeic(blob);
  } else {
    bmp = await createImageBitmap(blob, { imageOrientation: 'from-image' });
  }
  const s = maxSide / Math.max(bmp.width, bmp.height);
  if (s >= 1) return bmp;
  const scaled = await createImageBitmap(bmp, {
    resizeWidth: Math.round(bmp.width * s),
    resizeHeight: Math.round(bmp.height * s),
    resizeQuality: 'high',
  });
  bmp.close();
  return scaled;
}

const cache = new Map<string, Promise<ImageBitmap>>();

export function getPhoto(id: string, blob: () => Promise<Blob>, name: string): Promise<ImageBitmap> {
  let p = cache.get(id);
  if (!p) {
    p = blob().then((b) => decodePhoto(b, name));
    p.catch(() => cache.delete(id));
    cache.set(id, p);
  }
  return p;
}

export function dropPhoto(id: string) {
  const p = cache.get(id);
  cache.delete(id);
  p?.then((b) => b.close()).catch(() => {});
}
