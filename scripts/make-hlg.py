"""Encodes an sRGB rgb24 stream (stdin) as 10-bit BT.2020 HLG yuv420p10le (stdout).

Follows BT.2100 (display-referred, 1000-nit peak, system gamma 1.2) with SDR white
placed at the BT.2408 reference white of 203 nits, i.e. the exact inverse of the
app's HDR -> SDR path below the roll-off knee. ffmpeg's zscale uses a different
system gamma, so it can't produce a trustworthy reference.
"""
import sys
import numpy as np

W, H = int(sys.argv[1]), int(sys.argv[2])
frame_bytes = W * H * 3
M709_TO_2020 = np.array([[0.6274, 0.3293, 0.0433], [0.0691, 0.9195, 0.0114], [0.0164, 0.0880, 0.8956]])
A, B, C = 0.17883277, 0.28466892, 0.55991073
KR, KB = 0.2627, 0.0593
KG = 1 - KR - KB

while True:
    buf = sys.stdin.buffer.read(frame_bytes)
    if len(buf) < frame_bytes:
        break
    rgb = np.frombuffer(buf, np.uint8).reshape(H, W, 3) / 255.0
    lin = np.where(rgb <= 0.04045, rgb / 12.92, ((rgb + 0.055) / 1.055) ** 2.4)
    disp = np.clip(lin @ M709_TO_2020.T, 0, None) * (203 / 1000)  # display light, 1.0 = 1000 nits
    yd = disp @ np.array([KR, 0.678, KB])
    # Inverse OOTF (gamma 1.2): scene = disp * Yd^((1-g)/g)
    scene = disp * (np.maximum(yd, 1e-9) ** ((1 - 1.2) / 1.2))[..., None]
    e = np.where(scene <= 1 / 12, np.sqrt(3 * scene), A * np.log(np.maximum(12 * scene - B, 1e-9)) + C)
    y = KR * e[..., 0] + KG * e[..., 1] + KB * e[..., 2]
    cb = (e[..., 2] - y) / (2 * (1 - KB))
    cr = (e[..., 0] - y) / (2 * (1 - KR))
    sub = lambda p: p.reshape(H // 2, 2, W // 2, 2).mean((1, 3))
    Y = np.round(64 + 876 * y)
    U = np.round(512 + 896 * sub(cb))
    V = np.round(512 + 896 * sub(cr))
    for p in (Y, U, V):
        sys.stdout.buffer.write(np.clip(p, 0, 1023).astype('<u2').tobytes())
