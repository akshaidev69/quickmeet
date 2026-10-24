/**
 * Rasterize the canonical 4-tile LetsConnect logo for web + Android,
 * and stamp it onto the marketing hero image.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const publicDir = path.join(root, 'public');

async function main() {
  const sharp = (await import('sharp')).default;

  const logoSvg = fs.readFileSync(path.join(publicDir, 'logo.svg'));

  async function logoPng(size, { padRatio = 0.12, darkBg = true } = {}) {
    const pad = Math.round(size * padRatio);
    const bg = darkBg ? '#0b1411' : '#00000000';
    const inner = size - pad * 2;
    // Scale the 32x32 viewBox logo into the padded area
    const resized = await sharp(logoSvg).resize(inner, inner, { fit: 'contain' }).png().toBuffer();
    return sharp({
      create: {
        width: size,
        height: size,
        channels: 4,
        background: bg,
      },
    })
      .composite([{ input: resized, left: pad, top: pad }])
      .png()
      .toBuffer();
  }

  // Web assets — favicon is bare mark; apple-touch gets padded dark tile (iOS fills transparency with black)
  await sharp(logoSvg).resize(64, 64).png().toFile(path.join(publicDir, 'favicon.png'));
  fs.writeFileSync(path.join(publicDir, 'logo-192.png'), await logoPng(192, { padRatio: 0.14, darkBg: true }));
  fs.writeFileSync(path.join(publicDir, 'logo-512.png'), await logoPng(512, { padRatio: 0.14, darkBg: true }));
  console.log('Wrote public favicon + logo PNGs');

  // Stamp logo onto hero
  const heroCandidates = [
    path.join(publicDir, 'letsconnect-demo-meeting.jpg'),
    'C:\\Users\\anmol\\.cursor\\projects\\p-google-meet-clone\\assets\\letsconnect-demo-meeting.jpg',
  ];
  const heroSrc = heroCandidates.find((p) => fs.existsSync(p));
  if (!heroSrc) throw new Error('Hero image not found');

  const heroMeta = await sharp(heroSrc).metadata();
  const w = heroMeta.width || 1280;
  const h = heroMeta.height || 720;
  const logoPx = Math.max(40, Math.round(w * 0.038));
  const logoX = Math.round(w * 0.028);
  const logoY = Math.round(h * 0.032);
  // Cover a bit more than the old mark so interlocking C disappears
  const coverW = Math.round(logoPx * 1.4);
  const coverH = Math.round(logoPx * 1.4);

  // Sample a soft sage patch from near the nav for cover fill
  const sample = await sharp(heroSrc)
    .extract({
      left: Math.min(w - 8, logoX + coverW + 40),
      top: Math.min(h - 8, logoY + 4),
      width: 8,
      height: 8,
    })
    .ensureAlpha()
    .raw()
    .toBuffer();
  const r = sample[0];
  const g = sample[1];
  const b = sample[2];
  const cover = await sharp({
    create: {
      width: coverW,
      height: coverH,
      channels: 3,
      background: { r, g, b },
    },
  })
    .png()
    .toBuffer();

  const stamp = await sharp(logoSvg).resize(logoPx, logoPx).png().toBuffer();

  await sharp(heroSrc)
    .composite([
      { input: cover, left: logoX - 2, top: logoY - 2 },
      { input: stamp, left: logoX, top: logoY },
    ])
    .jpeg({ quality: 92 })
    .toFile(path.join(publicDir, 'letsconnect-demo-meeting.jpg.tmp'));

  fs.renameSync(
    path.join(publicDir, 'letsconnect-demo-meeting.jpg.tmp'),
    path.join(publicDir, 'letsconnect-demo-meeting.jpg'),
  );
  console.log('Stamped logo onto hero image');

  // Android mipmaps + splash
  const resDir = path.join(root, 'android', 'app', 'src', 'main', 'res');
  const mipmaps = {
    'mipmap-mdpi': 48,
    'mipmap-hdpi': 72,
    'mipmap-xhdpi': 96,
    'mipmap-xxhdpi': 144,
    'mipmap-xxxhdpi': 192,
  };
  for (const [folder, size] of Object.entries(mipmaps)) {
    const dir = path.join(resDir, folder);
    fs.mkdirSync(dir, { recursive: true });
    const buf = await logoPng(size, { padRatio: 0.14, darkBg: true });
    fs.writeFileSync(path.join(dir, 'ic_launcher.png'), buf);
    fs.writeFileSync(path.join(dir, 'ic_launcher_round.png'), buf);
    fs.writeFileSync(path.join(dir, 'ic_launcher_foreground.png'), buf);
  }
  fs.writeFileSync(
    path.join(resDir, 'values', 'ic_launcher_background.xml'),
    `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="ic_launcher_background">#0B1411</color>
</resources>
`,
  );

  const splashBuf = await logoPng(512, { padRatio: 0.22, darkBg: true });
  for (const entry of fs.readdirSync(resDir, { withFileTypes: true })) {
    if (entry.isDirectory() && entry.name.startsWith('drawable')) {
      fs.writeFileSync(path.join(resDir, entry.name, 'splash.png'), splashBuf);
    }
  }
  console.log('Updated Android launcher + splash icons');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
