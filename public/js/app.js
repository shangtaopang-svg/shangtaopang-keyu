// shangtaopang-可与 前端交互

document.addEventListener('DOMContentLoaded', function() {
  // ===== 主题 =====
  const themeToggle = document.getElementById('themeToggle');
  const savedTheme = localStorage.getItem('pst-theme') || 'dark';
  function setTheme(t) {
    document.body.classList.toggle('light-theme', t === 'light');
    if (themeToggle) themeToggle.textContent = t === 'light' ? '☀️' : '🌙';
    localStorage.setItem('pst-theme', t);
  }
  setTheme(savedTheme);
  if (themeToggle) themeToggle.addEventListener('click', () => {
    const c = document.body.classList.contains('light-theme') ? 'light' : 'dark';
    setTheme(c === 'light' ? 'dark' : 'light');
  });

  // ===== 移动端菜单 =====
  const menuToggle = document.getElementById('menuToggle');
  const mobileMenu = document.getElementById('mobileMenu');
  if (menuToggle && mobileMenu) {
    menuToggle.addEventListener('click', () => {
      mobileMenu.classList.toggle('open');
      menuToggle.textContent = mobileMenu.classList.contains('open') ? '✕' : '☰';
    });
    mobileMenu.querySelectorAll('a').forEach(l => l.addEventListener('click', () => {
      mobileMenu.classList.remove('open');
      menuToggle.textContent = '☰';
    }));
  }

  // ===== 导航滚动隐藏 =====
  const header = document.querySelector('.site-header');
  let lastScroll = 0;
  window.addEventListener('scroll', () => {
    const s = window.pageYOffset;
    if (s > 80) header.style.transform = s > lastScroll ? 'translateY(-100%)' : 'translateY(0)';
    else header.style.transform = 'translateY(0)';
    lastScroll = s;
  });

  // ===== 滚动入场动画 =====
  const revealEls = document.querySelectorAll('.fade-in, .fade-in-d1, .fade-in-d2, .fade-in-d3, section');
  const revealObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry, i) => {
      if (entry.isIntersecting) {
        entry.target.style.opacity = '1';
        entry.target.style.transform = 'translateY(0)';
        revealObserver.unobserve(entry.target);
      }
    });
  }, { threshold: 0.08 });
  revealEls.forEach((el, i) => {
    if (!el.classList.contains('hero')) {
      el.style.opacity = '0';
      el.style.transform = 'translateY(20px)';
      el.style.transition = `all 0.5s ease ${(i % 4) * 0.06}s`;
      revealObserver.observe(el);
    } else {
      el.style.opacity = '1';
    }
  });

  // ===== 语言切换 =====
  const lang = localStorage.getItem('pst-lang') || 'zh';
  applyLang(lang);
  window.toggleLang = function() {
    const c = localStorage.getItem('pst-lang') || 'zh';
    const n = c === 'zh' ? 'en' : 'zh';
    localStorage.setItem('pst-lang', n);
    applyLang(n);
  };
  function applyLang(l) {
    const btn = document.getElementById('langToggle');
    if (btn) btn.textContent = l === 'zh' ? 'CN' : 'EN';
    document.documentElement.lang = l === 'zh' ? 'zh-CN' : 'en';
    document.querySelectorAll('[data-zh]').forEach(el => {
      el.textContent = l === 'zh' ? el.dataset.zh : el.dataset.en;
    });
  }

  // ===== 首页风格切换 =====
  const styleBtn = document.getElementById('styleBtn');
  const styleMenu = document.getElementById('styleMenu');
  const styleOpts = document.querySelectorAll('.style-option');
  const savedStyle = localStorage.getItem('pst-style') || 'color-wall';

  if (styleBtn && styleMenu) {
    styleBtn.addEventListener('click', (e) => { e.stopPropagation(); styleMenu.classList.toggle('open'); });
    document.addEventListener('click', () => styleMenu.classList.remove('open'));
  }

  function setStyle(name) {
    document.body.setAttribute('data-style', name);
    localStorage.setItem('pst-style', name);
    styleOpts.forEach(o => o.classList.toggle('active', o.dataset.style === name));
    if (styleBtn) {
      const a = document.querySelector('.style-option.active');
      styleBtn.textContent = a ? a.textContent : '🎨 首页风格';
    }
  }

  styleOpts.forEach(o => {
    o.addEventListener('click', () => {
      setStyle(o.dataset.style);
      styleMenu.classList.remove('open');
      if (window.location.pathname === '/') location.reload();
    });
  });
  setStyle(savedStyle);
});
