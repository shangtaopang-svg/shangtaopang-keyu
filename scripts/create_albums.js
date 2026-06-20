const path = require('path');
const fs = require('fs');
const rootDir = path.join(__dirname, '..');
const { initDatabase, query, run, flushDatabase } = require(path.join(rootDir, 'database'));

async function main() {
  await initDatabase();
  const albums = [
    { title: '我的照片', folder: '我的照片' },
    { title: '我的同学朋友', folder: '我的同学朋友' },
    { title: '我和我的家人', folder: '我和我的家人' },
  ];
  const basePhotos = path.join(rootDir, '我的照片');
  const uploadDir = path.join(rootDir, 'public', 'uploads', 'albums');
  if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

  for (const album of albums) {
    run(`DELETE FROM photos WHERE album_id IN (SELECT id FROM photo_albums WHERE title = ?)`, [album.title]);
    run(`DELETE FROM photo_albums WHERE title = ?`, [album.title]);
    // 等待数据库写完
    await new Promise(r => setTimeout(r, 500));

    let aid = run(`INSERT INTO photo_albums (title, description, created_at) VALUES (?, ?, datetime('now'))`, [album.title, '']);
    if (!aid) { const r = query(`SELECT MAX(id) as id FROM photo_albums`); aid = r[0]?.id; }
    console.log(`\n=== ${album.title} (ID: ${aid}) ===`);

    const folderPath = path.join(basePhotos, album.folder);
    if (!fs.existsSync(folderPath)) { console.log('  folder not found'); continue; }
    const files = fs.readdirSync(folderPath).filter(f => /\.(jpg|jpeg|png|gif)$/i.test(f)).sort();
    console.log(`  photos: ${files.length}`);
    files.forEach((f, i) => {
      const src = path.join(folderPath, f);
      const dst = path.join(uploadDir, f);
      if (!fs.existsSync(dst)) { try { fs.copyFileSync(src, dst); } catch(e) {} }
      const dateTaken = f.length >= 10 ? f.substring(0, 10) : null;
      run(`INSERT INTO photos (album_id, filename, original_name, sort_order, created_at, date_taken) VALUES (?, ?, ?, ?, datetime('now'), ?)`,
        [aid, '/uploads/albums/' + f, f, i + 1, dateTaken]);
    });
    console.log('  done');
  }

  // 等待防抖写入完成
  await new Promise(r => setTimeout(r, 1000));
  flushDatabase();
  await new Promise(r => setTimeout(r, 500));

  console.log('\n=== Verify ===');
  query(`SELECT * FROM photo_albums ORDER BY id`).forEach(a => {
    const c = query(`SELECT COUNT(*) as cnt FROM photos WHERE album_id = ?`, [a.id])[0].cnt;
    console.log(`  ${a.title}: ${c} photos`);
  });
  console.log('\nAll done!');
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
