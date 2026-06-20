const fs = require('fs');
const path = require('path');

const baseDir = path.join(__dirname, '..', '我的照片');
const extMap = {'.jpg':true, '.jpeg':true, '.JPG':true, '.JPEG':true, '.png':true, '.PNG':true};

function pad(n) { return n.toString().padStart(2, '0'); }

function formatDate(d) {
  return d.getFullYear() + '-' + pad(d.getMonth()+1) + '-' + pad(d.getDate());
}

function formatTime(d) {
  return pad(d.getHours()) + '-' + pad(d.getMinutes()) + '-' + pad(d.getSeconds());
}

fs.readdirSync(baseDir).forEach(sub => {
  const subPath = path.join(baseDir, sub);
  if (!fs.statSync(subPath).isDirectory()) return;
  console.log('\n=== ' + sub + ' ===');

  const files = fs.readdirSync(subPath).filter(f => extMap[path.extname(f)]);
  if (!files.length) { console.log('  (无照片文件)'); return; }

  // 按修改时间排序
  files.sort((a, b) => fs.statSync(path.join(subPath, a)).mtimeMs - fs.statSync(path.join(subPath, b)).mtimeMs);

  files.forEach((f, i) => {
    const oldPath = path.join(subPath, f);
    const mtime = fs.statSync(oldPath).mtime;
    const dateStr = formatDate(mtime);
    const timeStr = formatTime(mtime);
    const ext = path.extname(f).toLowerCase();
    const newName = dateStr + '_' + timeStr + '_' + (i+1) + ext;
    const newPath = path.join(subPath, newName);

    if (oldPath !== newPath && !fs.existsSync(newPath)) {
      fs.renameSync(oldPath, newPath);
      console.log('  ' + f + ' → ' + newName);
    }
  });
});

console.log('\n✅ 全部完成！');
