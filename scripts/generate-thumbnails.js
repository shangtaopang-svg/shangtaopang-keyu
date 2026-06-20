const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const rootDir = path.join(__dirname, '..');
const uploadsDir = path.join(rootDir, 'public/uploads/albums');
const thumbsDir = path.join(uploadsDir, 'thumbs');

// Create thumbs directory
if (!fs.existsSync(thumbsDir)) fs.mkdirSync(thumbsDir, { recursive: true });

// Process all image files
const files = fs.readdirSync(uploadsDir).filter(f => {
  const ext = path.extname(f).toLowerCase();
  return /\.(jpg|jpeg|png|webp|gif)$/i.test(ext);
});

let processed = 0;
let skipped = 0;

async function processFile(file) {
  const thumbPath = path.join(thumbsDir, file);
  if (fs.existsSync(thumbPath)) {
    skipped++;
    return;
  }
  try {
    await sharp(path.join(uploadsDir, file))
      .resize(400, undefined, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 80 })
      .toFile(thumbPath);
    processed++;
  } catch (e) {
    console.error('  ❌ 失败:', file, e.message);
  }
}

(async () => {
  console.log(`📸 共 ${files.length} 个图片文件，开始生成缩略图...`);
  // Process in batches of 10 to avoid memory issues
  const batchSize = 10;
  for (let i = 0; i < files.length; i += batchSize) {
    await Promise.all(files.slice(i, i + batchSize).map(processFile));
    process.stdout.write(`  ${Math.min(i + batchSize, files.length)}/${files.length} (已处理 ${processed}, 已跳过 ${skipped})\r`);
  }
  console.log(`\n✅ 完成！新生成 ${processed} 个缩略图，跳过 ${skipped} 个已有文件`);
})();
