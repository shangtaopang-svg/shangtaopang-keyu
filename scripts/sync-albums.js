const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

async function main() {
  const SQL = await initSqlJs();
  const buffer = fs.readFileSync(path.join(__dirname, '..', 'data.db'));
  const db = new SQL.Database(buffer);

  function run(sql, params=[]) { db.run(sql, params); }
  function get(sql) {
    const r = db.exec(sql);
    if (!r || !r[0] || !r[0].values || !r[0].values[0]) return null;
    const cols = r[0].columns;
    const obj = {};
    r[0].values[0].forEach((v,i) => obj[cols[i]] = v);
    return obj;
  }
  function query(sql) {
    const r = db.exec(sql);
    if (!r || !r[0]) return [];
    const cols = r[0].columns;
    return r[0].values.map(row => {
      const obj = {};
      row.forEach((v,i) => obj[cols[i]] = v);
      return obj;
    });
  }

  const photosDir = path.join(__dirname, '..', '我的照片');
  const uploadsDir = path.join(__dirname, '..', 'public/uploads/albums');

  // ======== Task 1: 删除相册"我的爷爷奶奶" (id=22) ========
  console.log('=== TASK 1: 删除相册【我的爷爷奶奶】 ===');
  const album22 = get('SELECT * FROM photo_albums WHERE id=22');
  if (album22) {
    const photos22 = query('SELECT * FROM photos WHERE album_id=22');
    photos22.forEach(p => {
      const filePath = path.join(__dirname, '..', 'public', p.filename);
      try { if (fs.existsSync(filePath)) { fs.unlinkSync(filePath); console.log('  删文件:', p.filename); } }
      catch(e) { console.log('  无法删除文件:', p.filename, e.message); }
    });
    run('DELETE FROM photos WHERE album_id=22');
    run('DELETE FROM photo_albums WHERE id=22');
    console.log('  已删除相册【我的爷爷奶奶】及', photos22.length, '张照片记录');
  } else {
    console.log('  相册【我的爷爷奶奶】已不存在');
  }

  // ======== Task 2: 创建相册"摄影集" ========
  console.log('\n=== TASK 2: 创建相册【摄影集】 ===');
  const photoDir = path.join(photosDir, '摄影集');
  if (fs.existsSync(photoDir)) {
    const files = fs.readdirSync(photoDir).filter(f => fs.statSync(path.join(photoDir, f)).isFile());
    const videoFiles = files.filter(f => /\.(mp4|m4v|webm|mov|avi)$/i.test(f));

    run("INSERT INTO photo_albums (title, description, year, sort_order, created_at) VALUES (?, ?, ?, ?, datetime('now'))",
      ['摄影集', '摄影作品与视频合集', null, 0]);
    const newAlbum = get("SELECT * FROM photo_albums WHERE title='摄影集' ORDER BY id DESC");
    console.log('  已创建相册【摄影集】, id=' + newAlbum.id);

    videoFiles.forEach((f, i) => {
      const src = path.join(photoDir, f);
      const dest = path.join(uploadsDir, f);
      if (!fs.existsSync(dest)) {
        fs.copyFileSync(src, dest);
        console.log('  复制文件:', f);
      } else {
        console.log('  文件已存在（跳过）:', f);
      }
      run("INSERT INTO photos (album_id, filename, original_name, description, sort_order, created_at) VALUES (?, ?, ?, ?, ?, datetime('now'))",
        [newAlbum.id, '/uploads/albums/' + f, f, null, i]);
      console.log('  注册照片:', f);
    });
    console.log('  完成: 添加', videoFiles.length, '个视频');
  } else {
    console.log('  摄影集文件夹不存在');
  }

  // ======== Task 3: 同步"我一路走来" ========
  console.log('\n=== TASK 3: 同步【我一路走来】 ===');
  const album23 = get("SELECT * FROM photo_albums WHERE title='我一路走来'");
  if (album23) {
    const diskFiles23 = fs.readdirSync(path.join(photosDir, '我一路走来'))
      .filter(f => fs.statSync(path.join(photosDir, '我一路走来', f)).isFile())
      .filter(f => /\.(jpg|jpeg|png|gif|webp|svg|mp4|m4v|webm)$/i.test(f));
    const dbPhotos23 = query('SELECT * FROM photos WHERE album_id=' + album23.id);
    const dbOrig23 = new Set(dbPhotos23.map(p => p.original_name));

    const toRemove23 = dbPhotos23.filter(p => !diskFiles23.includes(p.original_name));
    toRemove23.forEach(p => {
      const fp = path.join(__dirname, '..', 'public', p.filename);
      try { if (fs.existsSync(fp)) { fs.unlinkSync(fp); console.log('  删文件:', p.filename); } } catch(e) {}
      run('DELETE FROM photos WHERE id=' + p.id);
      console.log('  删除记录: id=' + p.id, p.original_name);
    });

    const toAdd23 = diskFiles23.filter(f => !dbOrig23.has(f));
    toAdd23.forEach((f, i) => {
      const src = path.join(photosDir, '我一路走来', f);
      const dest = path.join(uploadsDir, f);
      if (!fs.existsSync(dest)) fs.copyFileSync(src, dest);
      run("INSERT INTO photos (album_id, filename, original_name, sort_order, created_at) VALUES (?, ?, ?, ?, datetime('now'))",
        [album23.id, '/uploads/albums/' + f, f, 999 + i]);
      console.log('  添加:', f);
    });
    console.log('  删除:', toRemove23.length, '条 / 添加:', toAdd23.length, '条');
  }

  // ======== Task 4: 同步"我和我的家人" ========
  console.log('\n=== TASK 4: 同步【我和我的家人】 ===');
  const album25 = get("SELECT * FROM photo_albums WHERE title='我和我的家人'");
  if (album25) {
    const diskFiles25 = fs.readdirSync(path.join(photosDir, '我和我的家人'))
      .filter(f => fs.statSync(path.join(photosDir, '我和我的家人', f)).isFile())
      .filter(f => /\.(jpg|jpeg|png|gif|webp|svg|mp4|m4v|webm)$/i.test(f));
    const dbPhotos25 = query('SELECT * FROM photos WHERE album_id=' + album25.id);
    const dbOrig25 = new Set(dbPhotos25.map(p => p.original_name));

    const toRemove25 = dbPhotos25.filter(p => !diskFiles25.includes(p.original_name));
    toRemove25.forEach(p => {
      const fp = path.join(__dirname, '..', 'public', p.filename);
      try { if (fs.existsSync(fp)) { fs.unlinkSync(fp); } } catch(e) {}
      run('DELETE FROM photos WHERE id=' + p.id);
      console.log('  删除记录: id=' + p.id, p.original_name);
    });

    const toAdd25 = diskFiles25.filter(f => !dbOrig25.has(f));
    toAdd25.forEach((f, i) => {
      const src = path.join(photosDir, '我和我的家人', f);
      const dest = path.join(uploadsDir, f);
      if (!fs.existsSync(dest)) fs.copyFileSync(src, dest);
      run("INSERT INTO photos (album_id, filename, original_name, sort_order, created_at) VALUES (?, ?, ?, ?, datetime('now'))",
        [album25.id, '/uploads/albums/' + f, f, 999 + i]);
      console.log('  添加:', f);
    });
    console.log('  删除:', toRemove25.length, '条 / 添加:', toAdd25.length, '条');
  }

  // ======== Task 5: 同步"我的同学朋友" ========
  console.log('\n=== TASK 5: 同步【我的同学朋友】 ===');
  const album24 = get("SELECT * FROM photo_albums WHERE title='我的同学朋友'");
  if (album24) {
    const diskFiles24 = fs.readdirSync(path.join(photosDir, '我的同学朋友'))
      .filter(f => fs.statSync(path.join(photosDir, '我的同学朋友', f)).isFile())
      .filter(f => /\.(jpg|jpeg|png|gif|webp|svg|mp4|m4v|webm)$/i.test(f));
    const dbPhotos24 = query('SELECT * FROM photos WHERE album_id=' + album24.id);
    const dbOrig24 = new Set(dbPhotos24.map(p => p.original_name));

    const toRemove24 = dbPhotos24.filter(p => !diskFiles24.includes(p.original_name));
    toRemove24.forEach(p => {
      const fp = path.join(__dirname, '..', 'public', p.filename);
      try { if (fs.existsSync(fp)) { fs.unlinkSync(fp); console.log('  删文件:', p.filename); } } catch(e) {}
      run('DELETE FROM photos WHERE id=' + p.id);
      console.log('  删除记录: id=' + p.id, p.original_name);
    });

    const toAdd24 = diskFiles24.filter(f => !dbOrig24.has(f));
    toAdd24.forEach((f, i) => {
      const src = path.join(photosDir, '我的同学朋友', f);
      const dest = path.join(uploadsDir, f);
      if (!fs.existsSync(dest)) fs.copyFileSync(src, dest);
      run("INSERT INTO photos (album_id, filename, original_name, sort_order, created_at) VALUES (?, ?, ?, ?, datetime('now'))",
        [album24.id, '/uploads/albums/' + f, f, 999 + i]);
      console.log('  添加:', f);
    });
    console.log('  删除:', toRemove24.length, '条 / 添加:', toAdd24.length, '条');
  }

  // Save DB
  const data = db.export();
  const buffer2 = Buffer.from(data);
  fs.writeFileSync(path.join(__dirname, '..', 'data.db'), buffer2);
  console.log('\n✅ 数据库已保存');

  // ======== Task 6: 清理孤立文件 & 验证 ========
  console.log('\n=== TASK 6: 清理孤立文件 ===');
  const allDBFilenames = new Set(query('SELECT filename FROM photos').map(p => p.filename.replace('/uploads/albums/', '')));
  const uploadFiles = fs.readdirSync(uploadsDir).filter(f => f !== '.gitkeep');
  const orphaned = uploadFiles.filter(f => !allDBFilenames.has(f));
  orphaned.forEach(f => {
    try {
      fs.unlinkSync(path.join(uploadsDir, f));
      console.log('  删除孤立文件:', f);
    } catch(e) { console.log('  无法删除:', f, e.message); }
  });
  console.log('  清理了', orphaned.length, '个孤立文件');

  // ======== 最终验证 ========
  console.log('\n========================================');
  console.log('📊 最终验证');
  console.log('========================================');

  const buffer3 = fs.readFileSync(path.join(__dirname, '..', 'data.db'));
  const db2 = new SQL.Database(buffer3);
  const a = db2.exec("SELECT name FROM sqlite_master WHERE type='table'");
  function q2(sql) {
    const r = db2.exec(sql);
    if (!r || !r[0]) return [];
    const cols = r[0].columns;
    return r[0].values.map(row => {
      const obj = {};
      row.forEach((v,i) => obj[cols[i]] = v);
      return obj;
    });
  }

  const finalAlbums = q2('SELECT * FROM photo_albums ORDER BY id');
  console.log('\n相册列表:');
  finalAlbums.forEach(a => {
    const count = q2('SELECT COUNT(*) as c FROM photos WHERE album_id=' + a.id);
    const diskFolder = path.join(photosDir, a.title);
    let diskCount = 0;
    if (fs.existsSync(diskFolder)) {
      diskCount = fs.readdirSync(diskFolder).filter(f => {
        const fp = path.join(diskFolder, f);
        return fs.statSync(fp).isFile() && /\.(jpg|jpeg|png|gif|webp|svg|mp4|m4v|webm)$/i.test(f);
      }).length;
    }
    const dbCount = count[0].c;
    const match = diskCount === dbCount ? '✅' : '❌';
    console.log('  ' + match, a.title, '- 磁盘:', diskCount, '/ DB:', dbCount);
  });

  const diskFolders = fs.readdirSync(photosDir).filter(f => fs.statSync(path.join(photosDir, f)).isDirectory());
  const dbAlbumTitles = new Set(finalAlbums.map(a => a.title));
  const missingFromDB = diskFolders.filter(f => !dbAlbumTitles.has(f));
  if (missingFromDB.length > 0) {
    console.log('\n❌ 数据库缺少相册:', missingFromDB.join(', '));
  }
  const extraInDB = finalAlbums.filter(a => !diskFolders.includes(a.title));
  if (extraInDB.length > 0) {
    console.log('\n❌ 数据库多余相册:', extraInDB.map(a => a.title).join(', '));
  }
  if (missingFromDB.length === 0 && extraInDB.length === 0) {
    console.log('\n✅ 相册结构完全匹配');
  }

  const uploadFilesAfter = fs.readdirSync(uploadsDir).filter(f => f !== '.gitkeep');
  const allFinalDBFiles = new Set(q2('SELECT filename FROM photos').map(p => p.filename.replace('/uploads/albums/', '')));
  const stillOrphaned = uploadFilesAfter.filter(f => !allFinalDBFiles.has(f));
  if (stillOrphaned.length > 0) {
    console.log('\n⚠️ 仍有孤立文件:', stillOrphaned.length);
    stillOrphaned.forEach(f => console.log('  -', f));
  } else {
    console.log('✅ 无孤立文件');
  }

  console.log('\n🎉 同步完成！');
}

main().catch(console.error);
