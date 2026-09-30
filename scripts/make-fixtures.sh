#!/usr/bin/env bash
# Generates the test media used by the Playwright suite (needs ffmpeg, heif-enc with x265, python3 + numpy).
# Videos are VP9 because the open-source Chromium used for testing has no H.264/HEVC
# decoder in WebCodecs (Google Chrome and Edge do).
set -euo pipefail
OUT=tests/fixtures/generated
mkdir -p "$OUT"
FF="ffmpeg -hide_banner -loglevel error -y"
VP9="-c:v libvpx-vp9 -crf 24 -b:v 0 -row-mt 1 -deadline realtime -cpu-used 8 -pix_fmt yuv420p"

# 1. Planted sections for the auto-trim: 0-2 blurry, 2-4 good, 4-6 dark, 6-8 shaky.
SRC="testsrc2=s=648x1152:r=30:d=2"
$FF -f lavfi -i "$SRC" -f lavfi -i "$SRC" -f lavfi -i "$SRC" -f lavfi -i "$SRC" -filter_complex "
  [0]crop=540:960,gblur=sigma=14,setsar=1[a];
  [1]crop=540:960,setsar=1[b];
  [2]crop=540:960,eq=brightness=-0.55:contrast=0.5,setsar=1[c];
  [3]crop=540:960:x='54+40*sin(n*1.7)*cos(n*3.1)':y='96+40*cos(n*2.3)*sin(n*1.3)',setsar=1[d];
  [a][b][c][d]concat=n=4:v=1[v]" -map "[v]" $VP9 "$OUT/planted.mp4"

# 2. iPhone-style portrait .mov: stored landscape (left red / right blue), rotation metadata 90° clockwise.
$FF -f lavfi -i "color=red:s=320x360:r=30:d=3" -f lavfi -i "color=blue:s=320x360:r=30:d=3" \
  -filter_complex "[0][1]hstack,noise=alls=4:allf=t" $VP9 "$OUT/raw_landscape.mp4"
# ffmpeg's .mov muxer refuses VP9, so write MP4 boxes with a QuickTime brand.
$FF -display_rotation:v:0 -90 -i "$OUT/raw_landscape.mp4" -c copy -f mp4 -brand "qt  " "$OUT/rotated.mov"
rm "$OUT/raw_landscape.mp4"

# 3. HDR: the same colourful source as SDR (reference) and as 10-bit BT.2020 HLG (VP9 profile 2).
COLORS="testsrc2=s=540x960:r=30:d=2"
$FF -f lavfi -i "$COLORS" -vf "format=gbrp,setparams=colorspace=gbr:range=pc,zscale=m=bt709:r=tv,format=yuv420p" \
  -c:v libvpx-vp9 -crf 12 -b:v 0 -row-mt 1 -deadline realtime -cpu-used 8 \
  -color_primaries bt709 -color_trc bt709 -colorspace bt709 "$OUT/sdr_ref.mp4"
ffmpeg -hide_banner -loglevel error -f lavfi -i "$COLORS" -f rawvideo -pix_fmt rgb24 - \
  | python3 scripts/make-hlg.py 540 960 \
  | $FF -f rawvideo -pix_fmt yuv420p10le -s 540x960 -r 30 -i - \
    -c:v libvpx-vp9 -profile:v 2 -crf 12 -b:v 0 -row-mt 1 -deadline realtime -cpu-used 8 \
    -color_primaries bt2020 -color_trc arib-std-b67 -colorspace bt2020nc -color_range tv "$OUT/hdr_hlg.mp4"

# 4. Landscape 16:9 clip (red | green | blue thirds) for crop repositioning.
$FF -f lavfi -i "color=red:s=640x1080:r=30:d=3" -f lavfi -i "color=0x00c000:s=640x1080:r=30:d=3" -f lavfi -i "color=blue:s=640x1080:r=30:d=3" \
  -filter_complex "[0][1][2]hstack=inputs=3,noise=alls=4:allf=t" $VP9 "$OUT/landscape.mp4"

# 5. JPEG stored landscape (left red / right blue) with EXIF orientation 6 (display rotated 90° cw).
$FF -f lavfi -i "color=red:s=400x300" -f lavfi -i "color=blue:s=400x300" -filter_complex "[0][1]hstack" -frames:v 1 -q:v 2 "$OUT/plain.jpg"
python3 scripts/add-exif-orientation.py "$OUT/plain.jpg" "$OUT/photo_exif6.jpg" 6
rm "$OUT/plain.jpg"

# 6. HEIC photo: top half green, bottom half magenta.
$FF -f lavfi -i "color=0x00c000:s=900x600" -f lavfi -i "color=magenta:s=900x600" -filter_complex "[0][1]vstack" -frames:v 1 "$OUT/heic_src.png"
heif-enc -q 90 -o "$OUT/photo.heic" "$OUT/heic_src.png" >/dev/null
rm "$OUT/heic_src.png"

# 7. Portrait photo with a horizontal black -> white gradient (for measuring Ken Burns motion).
$FF -f lavfi -i "color=black:s=1080x1920" -vf "format=gray,geq=lum='X/W*255'" -frames:v 1 "$OUT/gradient.png"

ls -la "$OUT"
