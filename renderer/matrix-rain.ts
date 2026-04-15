// Matrix Rain Animation — Canvas

const canvas = document.getElementById('matrix-canvas') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;

function resize() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}
resize();
window.addEventListener('resize', resize);

const katakana = 'アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲン';
const latin = 'MATRIX0123456789';
const chars = katakana + latin;

const fontSize = 14;
const columns = Math.floor(canvas.width / fontSize);
const drops: number[] = Array(columns).fill(1);

function draw(): void {
  ctx.fillStyle = 'rgba(0, 0, 0, 0.05)';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = '#00ff41';
  ctx.font = `${fontSize}px monospace`;

  for (let i = 0; i < drops.length; i++) {
    const text = chars[Math.floor(Math.random() * chars.length)];
    const x = i * fontSize;
    const y = drops[i] * fontSize;

    ctx.fillText(text, x, y);

    if (y > canvas.height && Math.random() > 0.975) {
      drops[i] = 0;
    }
    drops[i]++;
  }
}

// Throttle animation to reduce CPU usage
let frameCount = 0;
function animate(): void {
  frameCount++;
  if (frameCount % 2 === 0) {
    draw();
  }
  requestAnimationFrame(animate);
}

animate();