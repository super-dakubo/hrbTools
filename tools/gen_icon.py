import struct, zlib, os

def create_png(width, height, pixels_rgba):
    """Create PNG from RGBA pixel data."""
    def chunk(chunk_type, data):
        c = chunk_type + data
        crc = struct.pack('>I', zlib.crc32(c) & 0xffffffff)
        return struct.pack('>I', len(data)) + c + crc

    ihdr = struct.pack('>IIBBBBB', width, height, 8, 6, 0, 0, 0)

    raw = b''
    for y in range(height):
        raw += b'\x00'
        row_start = y * width * 4
        raw += bytes(pixels_rgba[row_start:row_start + width * 4])

    compressed = zlib.compress(raw)

    png = b'\x89PNG\r\n\x1a\n'
    png += chunk(b'IHDR', ihdr)
    png += chunk(b'IDAT', compressed)
    png += chunk(b'IEND', b'')
    return png

def hex_to_rgb(h):
    return (int(h[0:2],16), int(h[2:4],16), int(h[4:6],16))

def lerp_color(c1, c2, t):
    """Linearly interpolate between two RGB colors."""
    return (int(c1[0] + (c2[0] - c1[0]) * t),
            int(c1[1] + (c2[1] - c1[1]) * t),
            int(c1[2] + (c2[2] - c1[2]) * t))

def make_icon_pixels(w, h, radius, bg_top_hex, bg_bot_hex, fg_hex):
    """Create RGBA pixel buffer for rounded rect with vertical gradient and centered H."""
    bg_top = hex_to_rgb(bg_top_hex)
    bg_bot = hex_to_rgb(bg_bot_hex)
    fg = hex_to_rgb(fg_hex)

    pixels = bytearray(w * h * 4)

    for y in range(h):
        t = y / (h - 1) if h > 1 else 0
        bg = lerp_color(bg_top, bg_bot, t)
        for x in range(w):
            dx = min(x, w-1-x)
            dy = min(y, h-1-y)
            if dx < radius and dy < radius:
                cx = radius if x < w//2 else w-1-radius
                cy = radius if y < h//2 else h-1-radius
                dist = ((x-cx)**2 + (y-cy)**2) ** 0.5
                if dist > radius - 1:
                    # Anti-alias at the edge
                    alpha = max(0, min(255, int((radius - dist) * 255)))
                    if alpha == 0:
                        continue
                    i = (y * w + x) * 4
                    pixels[i] = bg[0]
                    pixels[i+1] = bg[1]
                    pixels[i+2] = bg[2]
                    pixels[i+3] = alpha
                    continue

            i = (y * w + x) * 4
            pixels[i] = bg[0]       # R
            pixels[i+1] = bg[1]     # G
            pixels[i+2] = bg[2]     # B
            pixels[i+3] = 255

    # Draw H letter
    def set_pixel(x, y, r, g, b, a=255):
        if 0 <= x < w and 0 <= y < h:
            i = (y * w + x) * 4
            pixels[i] = r
            pixels[i+1] = g
            pixels[i+2] = b
            pixels[i+3] = a

    # H proportions
    bar_w = max(w // 6, 2)
    gap = w // 6

    left_x = w // 3
    right_x = w * 2 // 3 - bar_w
    mid_y = h // 2
    bar_h = max(h // 10, 2)

    # Left vertical bar
    for y in range(h // 4, h * 3 // 4):
        for x in range(left_x, left_x + bar_w):
            set_pixel(x, y, fg[0], fg[1], fg[2])

    # Right vertical bar
    for y in range(h // 4, h * 3 // 4):
        for x in range(right_x, right_x + bar_w):
            set_pixel(x, y, fg[0], fg[1], fg[2])

    # Horizontal bar
    for y in range(mid_y - bar_h // 2, mid_y + bar_h // 2 + 1):
        for x in range(left_x - gap // 2, right_x + bar_w + gap // 2):
            set_pixel(x, y, fg[0], fg[1], fg[2])

    return bytes(pixels)


# --- Generate icons ---
output_dir = r'd:\code\hello_world\icons'

# 128x128
print("Generating 128x128.png...")
px128 = make_icon_pixels(128, 128, 28, '4b8bf4', '2563eb', 'ffffff')
with open(os.path.join(output_dir, '128x128.png'), 'wb') as f:
    f.write(create_png(128, 128, px128))

# 32x32
print("Generating 32x32.png...")
px32 = make_icon_pixels(32, 32, 6, '4b8bf4', '2563eb', 'ffffff')
with open(os.path.join(output_dir, '32x32.png'), 'wb') as f:
    f.write(create_png(32, 32, px32))

# icon.ico - embed 32x32 PNG as ICO
print("Generating icon.ico...")
ico_data = struct.pack('<HHH', 0, 1, 1)  # reserved, type=icon, count=1

# Re-use the 32x32 PNG data
png_data = create_png(32, 32, px32)
entry = struct.pack('<BBBBHHII', 32, 32, 0, 0, 1, 32, len(png_data), 22)
ico_data = struct.pack('<HHH', 0, 1, 1) + entry + png_data

with open(os.path.join(output_dir, 'icon.ico'), 'wb') as f:
    f.write(ico_data)

print("Done! All icons generated.")
