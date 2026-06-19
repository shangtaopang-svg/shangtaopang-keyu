const fs = require('fs');
let html = fs.readFileSync('./views/index.ejs', 'utf8');

// Replace the hero + dashboard CSS
const startMarker = '/* ===== Apple Pro Hero ===== */';
const endMarker = '@media (max-width: 768px) {';

const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker, start);

if (start < 0 || end < 0) { console.log('Markers not found'); process.exit(1); }

const newCSS = `.ap-hero {
  padding: 60px 20px 30px;
  text-align: center;
  background: #000;
  border-bottom: 4px solid #000;
}
.ap-hero-inner { max-width: 700px; margin: 0 auto; }

.ap-chip {
  display: inline-block; padding: 6px 18px;
  font-size: 0.75rem; font-weight: 700;
  background: #fff; color: #000;
  border: 3px solid #000;
  margin-bottom: 24px;
  text-transform: uppercase;
}

.ap-main-title {
  font-size: clamp(2.8rem, 5vw, 4rem);
  font-weight: 900; line-height: 1;
  margin: 0 0 4px; color: #fff;
  text-transform: uppercase;
  letter-spacing: -0.02em;
}
.ap-main-sub {
  display: block;
  font-size: clamp(1rem, 1.8vw, 1.3rem);
  font-weight: 600;
  margin-top: 8px; color: #da291c;
}

.ap-desc {
  font-size: 0.88rem; font-weight: 500;
  color: rgba(255,255,255,0.5);
  margin: 12px auto 28px;
  max-width: 460px;
}

.ap-actions { display: flex; gap: 10px; flex-wrap: wrap; justify-content: center; }
.ap-btn {
  padding: 10px 28px;
  font-size: 0.85rem; font-weight: 700;
  border: 3px solid #fff;
  background: #fff; color: #000 !important;
  text-decoration: none !important;
  text-transform: uppercase;
}
.ap-btn:hover { background: #da291c; border-color: #da291c; color: #fff !important; }
.ap-btn-outline { background: transparent; color: #fff !important; }
.ap-btn-outline:hover { background: #fff; color: #000 !important; }

.ap-stats {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  max-width: 500px; margin: 30px auto 0;
  border: 3px solid #fff;
}
.ap-stat {
  padding: 12px 8px; text-align: center;
  border-right: 2px solid #fff; color: #fff;
}
.ap-stat:last-child { border-right: none; }
.ap-stat-num { font-size: 1.3rem; font-weight: 900; display: block; }
.ap-stat-label { font-size: 0.65rem; font-weight: 600; text-transform: uppercase; color: rgba(255,255,255,0.4); }

.ap-showcase {
  padding: 40px 24px 60px;
  display: flex; justify-content: center;
  background: #fff;
}
.ap-showcase-inner { width: 100%; max-width: 1000px; }

.dash-frame {
  width: 100%;
  display: grid;
  grid-template-columns: 140px 1fr 140px;
  border: 4px solid #000;
  background: #fff;
}

.df-sidebar {
  padding: 20px 14px;
  border-right: 3px solid #000;
  background: #000;
}
.df-logo {
  font-size: 0.9rem; font-weight: 900;
  color: #fff; margin-bottom: 18px;
  text-decoration: none !important; display: block;
  text-transform: uppercase;
}
.df-nav-item {
  display: block; padding: 6px 10px;
  font-size: 0.75rem; font-weight: 700;
  color: rgba(255,255,255,0.4) !important;
  text-decoration: none !important;
  text-transform: uppercase;
  border: 2px solid transparent;
}
.df-nav-item:hover { color: #fff !important; }
.df-nav-item.active { color: #fff !important; border-color: #fff; }

.df-main { display: flex; flex-direction: column; padding: 16px 20px; }
.df-topbar {
  display: flex; justify-content: space-between;
  padding-bottom: 10px; margin-bottom: 14px;
  border-bottom: 3px solid #000;
  font-size: 0.82rem; font-weight: 700;
  text-transform: uppercase;
}
.df-body { flex: 1; display: grid; grid-template-rows: 1fr auto; gap: 12px; }
.df-chart { border: 3px solid #000; padding: 14px; }
.df-chart-title { font-size: 0.72rem; font-weight: 700; text-transform: uppercase; margin-bottom: 10px; }
.df-bars { display: flex; gap: 4px; align-items: flex-end; height: 80px; }
.df-bar-wrap { flex: 1; display: flex; justify-content: center; align-items: flex-end; }
.df-bar { width: 70%; background: #000; min-height: 4px; }
.df-bar-labels { display: flex; justify-content: space-around; margin-top: 6px; font-size: 0.6rem; font-weight: 600; }
.df-log { border: 3px solid #000; padding: 14px; }
.df-log-title { font-size: 0.72rem; font-weight: 700; text-transform: uppercase; margin-bottom: 8px; }
.df-log-item {
  font-size: 0.72rem; font-weight: 600;
  padding: 3px 0; display: flex; align-items: center; gap: 8px;
  text-decoration: none !important; color: #333 !important;
}
.df-dot { width: 6px; height: 6px; background: #da291c; flex-shrink: 0; }

.df-panel { padding: 20px 14px; border-left: 3px solid #000; background: #f5f5f5; }
.df-panel-title { font-size: 0.72rem; font-weight: 700; text-transform: uppercase; margin-bottom: 14px; }
.df-row {
  display: flex; justify-content: space-between;
  font-size: 0.72rem; font-weight: 600;
  padding: 6px 0; border-bottom: 2px solid #000;
  cursor: pointer;
}
.df-row:hover { background: #fff; }

.ap-fade { animation: apRise 0.5s ease forwards; opacity: 0; transform: translateY(10px); }
.ap-fade:nth-child(1) { animation-delay: 0s; }
.ap-fade:nth-child(2) { animation-delay: 0.1s; }
.ap-fade:nth-child(3) { animation-delay: 0.2s; }
.ap-fade:nth-child(4) { animation-delay: 0.3s; }
@keyframes apRise { to { opacity: 1; transform: translateY(0); } }

@media (max-width: 768px) {`;

html = html.slice(0, start) + newCSS + html.slice(end);
fs.writeFileSync('./views/index.ejs', html);
console.log('Done');
