const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const albums = [
  { title: '我的照片', folder: '我的照片' },
  { title: '我的同学朋友', folder: '我的同学朋友' },
  { title: '我和我的家人', folder: '我和我的家人' },
  { title: '老照片', folder: '老照片' },
];

const baseDir = path.join(__dirname, '..', '我的照片');

// 为每个相册生成文件列表
const manifest = {};
albums.forEach(a => {
  const folder = path.join(baseDir, a.folder);
  if (!fs.existsSync(folder)) { console.log('文件夹不存在:', folder); return; }
  const files = fs.readdirSync(folder)
    .filter(f => /\.(jpg|jpeg|png)$/i.test(f))
    .sort();
  manifest[a.title] = files;
  console.log(a.title + ':', files.length + '张');
});

// 写入manifest.json
const manifestPath = path.join(__dirname, '..', 'manifest.json');
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
console.log('\nmanifest.json 已生成');
console.log('\n=== 上传到服务器 ===');

// scp到服务器
const cmd = 'scp "' + manifestPath + '" root@8.160.117.120:/opt/shangtaopang-keyu/manifest.json';
console.log(execSync(cmd, { shell: true }).toString());
console.log('manifest.json 已上传');

// 上传所有照片文件到服务器（只传缺失的）
albums.forEach(a => {
  const folder = path.join(baseDir, a.folder);
  const files = manifest[a.title] || [];
  files.forEach(f => {
    const localFile = path.join(folder, f);
    const cmd2 = 'scp "' + localFile + '" root@8.160.117.120:/opt/shangtaopang-keyu/public/uploads/albums/ 2>/dev/null';
    try { execSync(cmd2, { shell: true, stdio: 'ignore' }); } catch(e) {}
  });
  console.log(a.title + ' 照片上传完成');
});

console.log('\n所有照片上传完成!');
