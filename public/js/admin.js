// AI学习网 - 管理后台交互

document.addEventListener('DOMContentLoaded', function() {
  // Slug 自动生成
  const nameInput = document.getElementById('cat_name') || document.getElementById('model_name');
  const slugInput = document.getElementById('cat_slug') || document.getElementById('model_slug');

  if (nameInput && slugInput) {
    nameInput.addEventListener('input', function() {
      if (!slugInput.dataset.manual) {
        slugInput.value = nameInput.value
          .toLowerCase()
          .replace(/[^\w一-鿿]+/g, '-')
          .replace(/^-|-$/g, '');
      }
    });

    slugInput.addEventListener('input', function() {
      slugInput.dataset.manual = this.value ? 'true' : '';
    });
  }

  // 点击弹窗外部关闭
  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', function(e) {
      if (e.target === this) {
        this.style.display = 'none';
      }
    });
  });

  // 删除确认
  document.querySelectorAll('form[onsubmit]').forEach(form => {
    const original = form.onsubmit;
    form.onsubmit = null;
    form.addEventListener('submit', function(e) {
      if (!confirm('确定执行此操作？')) {
        e.preventDefault();
      }
    });
  });

  // 文件上传预览
  const fileInput = document.getElementById('thumbnail');
  if (fileInput) {
    fileInput.addEventListener('change', function() {
      const existingPreview = this.parentElement.querySelector('.file-preview');
      if (existingPreview) existingPreview.remove();

      if (this.files && this.files[0]) {
        const reader = new FileReader();
        reader.onload = function(e) {
          const preview = document.createElement('div');
          preview.className = 'file-preview';
          preview.innerHTML = `<img src="${e.target.result}" style="max-width:200px;margin-top:8px;border-radius:8px">`;
          fileInput.parentElement.appendChild(preview);
        };
        reader.readAsDataURL(this.files[0]);
      }
    });
  }
});
