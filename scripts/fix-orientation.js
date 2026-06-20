const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const uploadsDir = path.join(__dirname, '..', 'public/uploads/albums');
const thumbsDir = path.join(uploadsDir, 'thumbs');

async function main() {
  const images = fs.readdirSync(uploadsDir).filter(f => {
    const ext = path.extname(f).toLowerCase();
    return /\.(jpg|jpeg|png|webp|gif)$/i.test(ext);
  });

  // 1. Fix full-size image orientation
  console.log('🔧 修正原始图片方向...');
  let fixed = 0;
  for (let i = 0; i < images.length; i += 5) {
    await Promise.all(images.slice(i, i + 5).map(async (file) => {
      const filePath = path.join(uploadsDir, file);
      const tmpPath = filePath + '.tmp';
      try {
        const meta = await sharp(filePath).metadata();
        if (meta.orientation && meta.orientation !== 1) {
          await sharp(filePath).rotate().toFile(tmpPath);
          fs.unlinkSync(filePath);
          fs.renameSync(tmpPath, filePath);
          fixed++;
        }
      } catch(e) { /* skip */ }
    }));
  }
  console.log(`✅ 已修正 ${fixed} 张图片方向`);

  // 2. Regenerate all thumbnails
  console.log('\n📸 重新生成缩略图（方向修正）...');
  if (!fs.existsSync(thumbsDir)) fs.mkdirSync(thumbsDir, { recursive: true });

  const old = fs.readdirSync(thumbsDir);
  old.forEach(f => fs.unlinkSync(path.join(thumbsDir, f)));

  let gen = 0;
  for (let i = 0; i < images.length; i += 10) {
    await Promise.all(images.slice(i, i + 10).map(async (file) => {
      await sharp(path.join(uploadsDir, file))
        .rotate()
        .resize(400, undefined, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 80 })
        .toFile(path.join(thumbsDir, file));
      gen++;
    }));
  }
  console.log(`✅ 已生成 ${gen} 个缩略图`);
}
main().catch(console.error);
