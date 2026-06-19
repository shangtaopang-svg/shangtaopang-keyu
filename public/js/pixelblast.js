/**
 * PixelBlast - 像素爆炸文字动画
 */
(function(global) {
  'use strict';

  class PixelBlast {
    constructor(el, options = {}) {
      this.el = typeof el === 'string' ? document.querySelector(el) : el;
      if (!this.el) return;

      this.options = Object.assign({
        pixelSize: 4,
        gap: 1,
        radius: 100,
        trigger: 'hover',
      }, options);

      this.pixels = [];
      this.exploded = false;
      this.init();
    }

    init() {
      var text = this.el.textContent.trim();
      if (!text) return;

      var cs = getComputedStyle(this.el);

      // 创建离屏 canvas 精确测量文字
      var c = document.createElement('canvas');
      var ctx = c.getContext('2d');
      var fs = parseFloat(cs.fontSize) || 48;
      var ff = cs.fontFamily || 'sans-serif';
      var fw = cs.fontWeight || '400';

      ctx.font = fw + ' ' + fs + 'px ' + ff;

      // 测量文字实际尺寸
      var tm = ctx.measureText(text);
      var tw = tm.width;
      var th = fs * 1.2; // 行高估算

      // 设置 canvas 尺寸（加边距）
      var pad = 10;
      c.width = Math.ceil(tw + pad * 2);
      c.height = Math.ceil(th + pad * 2);

      // 重新设置 ctx（canvas resize 后需要重设）
      ctx.font = fw + ' ' + fs + 'px ' + ff;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#fff';
      ctx.fillText(text, c.width / 2, c.height / 2);

      // 读取像素
      var imageData = ctx.getImageData(0, 0, c.width, c.height);
      var data = imageData.data;

      // 准备 DOM
      var origDisplay = this.el.style.display;
      this.el.innerHTML = '';
      this.el.style.position = 'relative';
      this.el.style.display = 'inline-block';
      this.el.style.width = c.width + 'px';
      this.el.style.height = c.height + 'px';

      var ps = this.options.pixelSize;
      var gap = this.options.gap;
      var color = '#888'; // 固定灰色，适配任何主题
      var step = ps + gap;

      // 生成像素块
      for (var y = 0; y < c.height; y += step) {
        for (var x = 0; x < c.width; x += step) {
          var idx = (Math.floor(y) * c.width + Math.floor(x)) * 4;
          if (data[idx + 3] > 100) {
            var pixel = document.createElement('div');
            pixel.style.cssText = [
              'position:absolute',
              'width:' + ps + 'px',
              'height:' + ps + 'px',
              'left:' + x + 'px',
              'top:' + y + 'px',
              'background:' + color,
              'transition:all 0.5s cubic-bezier(0.25,0.46,0.45,0.94)',
              'pointer-events:none',
              'border-radius:1px',
              'opacity:1',
            ].join(';');
            this.el.appendChild(pixel);
            this.pixels.push({ el: pixel, ox: x, oy: y });
          }
        }
      }

      // 绑定事件
      if (this.options.trigger === 'hover') {
        this.el.addEventListener('mouseenter', this.explode.bind(this));
        this.el.addEventListener('mouseleave', this.reassemble.bind(this));
      } else {
        this.el.addEventListener('click', function() {
          if (this.exploded) this.reassemble();
          else this.explode();
        }.bind(this));
      }
    }

    explode() {
      if (this.exploded) return;
      this.exploded = true;
      var r = this.options.radius;
      this.pixels.forEach(function(p) {
        var angle = Math.random() * Math.PI * 2;
        var dist = r * (0.3 + Math.random() * 0.7);
        var tx = p.ox + Math.cos(angle) * dist;
        var ty = p.oy + Math.sin(angle) * dist;
        p.el.style.transform = 'translate(' + (tx - p.ox) + 'px,' + (ty - p.oy) + 'px)';
        p.el.style.opacity = '0';
      });
    }

    reassemble() {
      if (!this.exploded) return;
      this.exploded = false;
      this.pixels.forEach(function(p) {
        p.el.style.transform = 'translate(0,0)';
        p.el.style.opacity = '1';
      });
    }
  }

  global.PixelBlast = PixelBlast;
})(window);
