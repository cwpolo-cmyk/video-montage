"""Inserts a minimal EXIF APP1 segment with an Orientation tag into a JPEG."""
import struct
import sys

src, dst, orientation = sys.argv[1], sys.argv[2], int(sys.argv[3])
data = open(src, "rb").read()
assert data[:2] == b"\xff\xd8", "not a JPEG"
tiff = b"II*\x00" + struct.pack("<I", 8)
tiff += struct.pack("<H", 1) + struct.pack("<HHIHH", 0x0112, 3, 1, orientation, 0) + struct.pack("<I", 0)
payload = b"Exif\x00\x00" + tiff
app1 = b"\xff\xe1" + struct.pack(">H", len(payload) + 2) + payload
open(dst, "wb").write(data[:2] + app1 + data[2:])
