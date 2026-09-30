export const OUT_W = 1080;
export const OUT_H = 1920;
export const FPS = 30;

export const VIDEO_MIN_LEN = 1.5;
export const VIDEO_MAX_LEN = 2.0;
export const PHOTO_LEN = 1.5;

/** Largest long-side we keep for decoded photos; enough headroom for crop zoom + Ken Burns. */
export const PHOTO_MAX_SIDE = 4096;

/** Max crop zoom on top of "cover" scaling. */
export const MAX_ZOOM = 2.5;

/**
 * Instagram Reels UI safe zone, in output pixels. Profile/caption/audio sit at the
 * bottom, action buttons on the right, header at the top.
 */
export const SAFE_ZONE = { top: 250, bottom: 420, left: 60, right: 150 } as const;
