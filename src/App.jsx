import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from './supabase';
import { getDeviceFingerprint, markAsVoted, getLocalVote } from './fingerprint';
import { LANGUAGES, detectBrowserLanguage, getSavedLanguage, saveLanguage, t } from './i18n';
import ResultCard from './components/ResultCard';
import TurnstileWidget from './components/TurnstileWidget';

const QUESTION_IDS = ['air', 'water', 'food', 'climate', 'health', 'war', 'inequality', 'ai'];
const QUESTION_EMOJI = {
  air: '🌫️', water: '💧', food: '🌾', climate: '🌡️',
  health: '🧬', war: '☮️', inequality: '⚖️', ai: '🤖',
};
const REGION_IDS = ['eu', 'as', 'na', 'sa', 'af', 'oc'];
const REGION_FLAG = {
  eu: '🇪🇺', as: '🌏', na: '🌎', sa: '🌎', af: '🌍', oc: '🌊',
};
const THREAT_ACCENTS = {
  air: '#7dd3fc',
  water: '#38bdf8',
  food: '#a3e635',
  climate: '#fbbf24',
  health: '#fb7185',
  war: '#fb923c',
  inequality: '#c084fc',
  ai: '#22d3ee',
};
const THREAT_ACCENT_RGB = {
  air: '125,211,252',
  water: '56,189,248',
  food: '163,230,53',
  climate: '251,191,36',
  health: '251,113,133',
  war: '251,146,60',
  inequality: '192,132,252',
  ai: '34,211,238',
};
const SITE_URL = 'https://humanityvote.org';
const TURNSTILE_SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY || '';

// Approximate lat/lon centers of each continent for globe markers
const REGION_CENTERS = {
  eu: { lat: 50, lon: 12 },
  as: { lat: 32, lon: 100 },
  na: { lat: 45, lon: -100 },
  sa: { lat: -15, lon: -60 },
  af: { lat: 5, lon: 22 },
  oc: { lat: -25, lon: 135 },
};

function latLonToXYZ(lat, lon) {
  const lr = lat * Math.PI / 180;
  const lnr = lon * Math.PI / 180;
  return {
    x: Math.cos(lr) * Math.cos(lnr),
    y: Math.sin(lr),
    z: Math.cos(lr) * Math.sin(lnr),
  };
}

function getQuestions(lang) {
  return QUESTION_IDS.map(id => ({ id, emoji: QUESTION_EMOJI[id], label: t(lang, `q_${id}`) }));
}
function getRegions(lang) {
  return REGION_IDS.map(id => ({ id, flag: REGION_FLAG[id], label: t(lang, `r_${id}`) }));
}

function getIntroTitleLines(lang, part, text) {
  if (lang === 'ru' && part === 1) return ['Мы не знаем что', 'больше всего'];
  if (lang === 'ru' && part === 2) return ['угрожает', 'человечеству.'];
  return [text];
}

// =============================================================================
// INTERACTIVE GLOBE — with region markers, vote rain, drag to rotate
// =============================================================================
function InteractiveGlobe({ size = 320, dotCount = 340, userRegion = null, regionVotes = {}, voteCount = 0 }) {
  const canvasRef = useRef(null);
  const animRef = useRef(null);
  const stateRef = useRef({
    rotX: 0.3, rotY: 0,
    velX: 0, velY: 0.003,
    isDragging: false,
    lastX: 0, lastY: 0,
    idleTime: 0,
    frame: 0,
  });

  const dotsRef = useRef(null);
  if (!dotsRef.current) {
    const dots = [];
    const phi = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < dotCount; i++) {
      const y = 1 - (i / (dotCount - 1)) * 2;
      const radius = Math.sqrt(1 - y * y);
      const theta = phi * i;
      dots.push({
        x: Math.cos(theta) * radius,
        y: y,
        z: Math.sin(theta) * radius,
        intensity: 0.4 + Math.random() * 0.6,
        size: 0.7 + Math.random() * 1.3,
      });
    }
    dotsRef.current = dots;
  }

  const connectionsRef = useRef(null);
  if (!connectionsRef.current) {
    const conns = [];
    for (let i = 0; i < 16; i++) {
      conns.push({
        from: Math.floor(Math.random() * dotCount),
        to: Math.floor(Math.random() * dotCount),
        progress: Math.random(),
        speed: 0.003 + Math.random() * 0.005,
      });
    }
    connectionsRef.current = conns;
  }

  const rainRef = useRef([]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    ctx.scale(dpr, dpr);

    const cx = size / 2;
    const cy = size / 2;
    const r = size * 0.4;

    function rotate(point, rx, ry) {
      let cosY = Math.cos(ry), sinY = Math.sin(ry);
      let x1 = point.x * cosY - point.z * sinY;
      let z1 = point.x * sinY + point.z * cosY;
      let cosX = Math.cos(rx), sinX = Math.sin(rx);
      let y1 = point.y * cosX - z1 * sinX;
      let z2 = point.y * sinX + z1 * cosX;
      return { x: x1, y: y1, z: z2 };
    }

    function draw() {
      const state = stateRef.current;
      state.frame = (state.frame || 0) + 1;
      const dots = dotsRef.current;
      const conns = connectionsRef.current;

      ctx.clearRect(0, 0, size, size);

      // Outer glow
      const grd = ctx.createRadialGradient(cx, cy, r * 0.5, cx, cy, r * 1.6);
      grd.addColorStop(0, 'rgba(0, 220, 140, 0.12)');
      grd.addColorStop(0.5, 'rgba(0, 200, 130, 0.04)');
      grd.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = grd;
      ctx.fillRect(0, 0, size, size);

      // Outer ring
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(0, 220, 140, 0.18)';
      ctx.lineWidth = 1;
      ctx.stroke();

      // Inner subtle ring
      ctx.beginPath();
      ctx.arc(cx, cy, r * 0.92, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(0, 220, 140, 0.05)';
      ctx.lineWidth = 0.5;
      ctx.stroke();

      const rotated = dots.map(d => ({
        ...rotate(d, state.rotX, state.rotY),
        intensity: d.intensity,
        size: d.size,
      }));

      // Latitude lines
      for (let lat = -75; lat <= 75; lat += 20) {
        const latR = (lat * Math.PI) / 180;
        ctx.beginPath();
        const segments = 60;
        for (let i = 0; i <= segments; i++) {
          const lon = (i / segments) * Math.PI * 2;
          const point = {
            x: Math.cos(latR) * Math.cos(lon),
            y: Math.sin(latR),
            z: Math.cos(latR) * Math.sin(lon),
          };
          const rp = rotate(point, state.rotX, state.rotY);
          if (rp.z > -0.1) {
            const px = cx + rp.x * r;
            const py = cy + rp.y * r;
            const opacity = Math.max(0, (rp.z + 0.1) / 1.1) * 0.05;
            if (i === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
            ctx.strokeStyle = `rgba(0, 220, 140, ${opacity})`;
          }
        }
        ctx.stroke();
      }

      // Connection arcs (pulses of light between random points)
      conns.forEach(conn => {
        conn.progress += conn.speed;
        if (conn.progress > 1) {
          conn.progress = 0;
          conn.from = Math.floor(Math.random() * dots.length);
          conn.to = Math.floor(Math.random() * dots.length);
        }
        const fromR = rotated[conn.from];
        const toR = rotated[conn.to];
        if (!fromR || !toR) return;
        if (fromR.z < 0 || toR.z < 0) return;

        const mx = (fromR.x + toR.x) / 2;
        const my = (fromR.y + toR.y) / 2;
        const mz = (fromR.z + toR.z) / 2;
        const ml = Math.sqrt(mx * mx + my * my + mz * mz);
        const elev = 1.15;
        const ax = (mx / ml) * elev;
        const ay = (my / ml) * elev;
        const az = (mz / ml) * elev;

        const tt = conn.progress;
        const ix = (1 - tt) ** 2 * fromR.x + 2 * (1 - tt) * tt * ax + tt * tt * toR.x;
        const iy = (1 - tt) ** 2 * fromR.y + 2 * (1 - tt) * tt * ay + tt * tt * toR.y;
        const iz = (1 - tt) ** 2 * fromR.z + 2 * (1 - tt) * tt * az + tt * tt * toR.z;

        if (iz > 0) {
          const px = cx + ix * r;
          const py = cy + iy * r;
          const fade = Math.sin(tt * Math.PI);
          ctx.beginPath();
          ctx.arc(px, py, 2, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(120, 255, 200, ${fade * 0.85})`;
          ctx.fill();
          ctx.beginPath();
          ctx.arc(px, py, 4, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(0, 220, 140, ${fade * 0.2})`;
          ctx.fill();
        }
      });

      // Vote rain — random light flashes falling on the globe
      if (state.frame % 16 === 0) {
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.acos(2 * Math.random() - 1);
        rainRef.current.push({
          x: Math.sin(phi) * Math.cos(theta),
          y: Math.cos(phi),
          z: Math.sin(phi) * Math.sin(theta),
          life: 1,
          size: 1.8 + Math.random() * 2.5,
        });
      }
      rainRef.current = rainRef.current.filter(v => v.life > 0);
      rainRef.current.forEach(v => {
        v.life -= 0.028;
        const rp = rotate(v, state.rotX, state.rotY);
        if (rp.z > 0) {
          const px = cx + rp.x * r;
          const py = cy + rp.y * r;
          const prog = 1 - v.life;
          const ringR = v.size * (1 + prog * 5);
          const fade = v.life * 0.7;
          ctx.beginPath();
          ctx.arc(px, py, ringR, 0, Math.PI * 2);
          ctx.strokeStyle = `rgba(0, 255, 157, ${fade})`;
          ctx.lineWidth = 1.2;
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(px, py, v.size * 0.4, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(180, 255, 220, ${v.life})`;
          ctx.fill();
        }
      });

      // Dots
      rotated.forEach(d => {
        if (d.z < -0.15) return;
        const px = cx + d.x * r;
        const py = cy + d.y * r;
        const depth = Math.max(0.1, (d.z + 0.5) / 1.5);
        ctx.beginPath();
        ctx.arc(px, py, d.size * (0.5 + depth * 0.5), 0, Math.PI * 2);
        ctx.fillStyle = `rgba(0, 230, 150, ${depth * d.intensity * 0.85})`;
        ctx.fill();
      });

      // Region markers — size scales with vote count
      const maxVotes = Math.max(...Object.values(regionVotes), 1);
      Object.entries(REGION_CENTERS).forEach(([regId, center]) => {
        const votes = regionVotes[regId] || 0;
        const intensity = votes / maxVotes;
        const pt = latLonToXYZ(center.lat, center.lon);
        const rp = rotate(pt, state.rotX, state.rotY);
        if (rp.z < 0.05) return;

        const px = cx + rp.x * r;
        const py = cy + rp.y * r;
        const depth = Math.max(0, (rp.z + 0.05) / 1.05);
        const isUser = regId === userRegion;
        const dotR = isUser ? 5 + intensity * 4 : 3 + intensity * 3;

        // Outer glow
        const g = ctx.createRadialGradient(px, py, 0, px, py, dotR * 3.5);
        g.addColorStop(0, `rgba(${isUser ? '80,255,180' : '0,255,157'}, ${depth * intensity * 0.4})`);
        g.addColorStop(1, 'rgba(0, 200, 100, 0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(px, py, dotR * 3.5, 0, Math.PI * 2);
        ctx.fill();

        // Marker dot
        ctx.beginPath();
        ctx.arc(px, py, dotR, 0, Math.PI * 2);
        ctx.fillStyle = isUser
          ? `rgba(120, 255, 200, ${depth * 0.95})`
          : `rgba(0, 255, 157, ${depth * 0.8})`;
        ctx.fill();

        // User region pulse ring
        if (isUser) {
          const ringProg = (state.frame * 0.025) % 1;
          ctx.beginPath();
          ctx.arc(px, py, dotR * (1 + ringProg * 3), 0, Math.PI * 2);
          ctx.strokeStyle = `rgba(120, 255, 200, ${depth * (1 - ringProg) * 0.7})`;
          ctx.lineWidth = 1.5;
          ctx.stroke();
        }

        // Region label
        if (rp.z > 0.25 && depth > 0.4) {
          ctx.font = `600 ${Math.floor(8 + depth * 3)}px 'JetBrains Mono', monospace`;
          ctx.fillStyle = `rgba(200, 255, 220, ${depth * 0.65})`;
          ctx.textAlign = 'center';
          ctx.fillText(regId.toUpperCase(), px, py + dotR + 10);
        }
      });

      // Auto-rotate when idle
      if (!state.isDragging) {
        state.idleTime += 1;
        if (state.idleTime > 60) {
          state.velY += (0.003 - state.velY) * 0.02;
          state.velX *= 0.95;
        }
        state.rotX += (0.3 - state.rotX) * 0.005;
      }

      state.rotY += state.velY;
      state.rotX += state.velX;
      state.velY *= 0.96;
      state.velX *= 0.96;

      animRef.current = requestAnimationFrame(draw);
    }

    function getPos(e) {
      const rect = canvas.getBoundingClientRect();
      const touch = e.touches?.[0];
      return {
        x: (touch?.clientX ?? e.clientX) - rect.left,
        y: (touch?.clientY ?? e.clientY) - rect.top,
      };
    }

    function onDown(e) {
      const pos = getPos(e);
      stateRef.current.isDragging = true;
      stateRef.current.lastX = pos.x;
      stateRef.current.lastY = pos.y;
      stateRef.current.idleTime = 0;
      stateRef.current.velX = 0;
      stateRef.current.velY = 0;
      e.preventDefault();
    }

    function onMove(e) {
      if (!stateRef.current.isDragging) return;
      const pos = getPos(e);
      stateRef.current.velY = (pos.x - stateRef.current.lastX) * 0.005;
      stateRef.current.velX = (pos.y - stateRef.current.lastY) * 0.005;
      stateRef.current.lastX = pos.x;
      stateRef.current.lastY = pos.y;
      e.preventDefault();
    }

    function onUp() {
      stateRef.current.isDragging = false;
      stateRef.current.idleTime = 0;
    }

    canvas.addEventListener('mousedown', onDown);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    canvas.addEventListener('touchstart', onDown, { passive: false });
    window.addEventListener('touchmove', onMove, { passive: false });
    window.addEventListener('touchend', onUp);

    draw();

    return () => {
      cancelAnimationFrame(animRef.current);
      canvas.removeEventListener('mousedown', onDown);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      canvas.removeEventListener('touchstart', onDown);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onUp);
    };
  }, [size, userRegion, JSON.stringify(regionVotes)]);

  return (
    <div style={{ position: 'relative', display: 'inline-block' }}>
      <canvas
        ref={canvasRef}
        style={{
          width: size,
          height: size,
          display: 'block',
          cursor: 'grab',
          touchAction: 'none',
        }}
        onMouseDown={e => e.currentTarget.style.cursor = 'grabbing'}
        onMouseUp={e => e.currentTarget.style.cursor = 'grab'}
      />
    </div>
  );
}

// =============================================================================
// VOTE ANIMATION OVERLAY — shown briefly after voting
// =============================================================================
function VoteAnimation({ lang, onComplete }) {
  useEffect(() => {
    const timer = setTimeout(onComplete, 1800);
    return () => clearTimeout(timer);
  }, [onComplete]);

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 100,
      background: 'rgba(2, 8, 5, 0.92)', backdropFilter: 'blur(8px)',
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      animation: 'fadeIn 0.3s ease',
    }}>
      <div style={{
        position: 'relative', width: 120, height: 120,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <div style={{
          position: 'absolute', width: 24, height: 24, borderRadius: '50%',
          background: '#00ff9d', top: '50%', left: '50%',
          transform: 'translate(-50%,-50%)',
          animation: 'votePulse 0.6s ease-in-out infinite',
          boxShadow: '0 0 20px #00ff9d',
        }} />
        {[0, 1, 2].map(i => (
          <div key={i} style={{
            position: 'absolute', width: 24, height: 24, borderRadius: '50%',
            border: '2px solid #00ff9d', top: '50%', left: '50%',
            animation: `voteRing 1.8s ease-out ${i * 0.5}s infinite`,
          }} />
        ))}
      </div>
      <div style={{
        marginTop: 24, color: '#00ff9d',
        fontFamily: "'Inter', sans-serif", fontSize: 18, fontWeight: 700,
        letterSpacing: 0,
        animation: 'slideUp 0.5s ease 0.3s both', textAlign: 'center',
      }}>
        {t(lang, 'vote_counted')}
      </div>
    </div>
  );
}

// =============================================================================
// SHARE BUTTON — share your vote via native share or copy link
// =============================================================================
function ShareButton({ lang, questionId }) {
  const [copied, setCopied] = useState(false);

  async function share() {
    const qLabel = t(lang, `q_${questionId}`);
    const url = SITE_URL;
    const text = `I voted on HumanityVote: "${qLabel}" is the biggest threat to humanity. What do you think? ${url}`;

    try {
      if (navigator.share) {
        await navigator.share({ title: 'HumanityVote', text, url });
      } else {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2200);
      }
    } catch (e) {
      // User cancelled share or error
    }
  }

  return (
    <div style={{ textAlign: 'center', marginTop: 32, position: 'relative' }}>
      <button
        onClick={share}
        style={{
          padding: '12px 28px',
          border: '1px solid rgba(0,220,140,0.3)',
          background: 'rgba(0,220,140,0.05)',
          color: 'rgba(0,255,157,0.9)',
          fontFamily: "'JetBrains Mono', monospace", fontSize: 11,
          letterSpacing: '0.15em', cursor: 'pointer',
          borderRadius: 2, transition: 'all 0.25s',
        }}
        onMouseEnter={e => {
          e.currentTarget.style.background = 'rgba(0,255,157,0.1)';
          e.currentTarget.style.borderColor = 'rgba(0,255,157,0.5)';
        }}
        onMouseLeave={e => {
          e.currentTarget.style.background = 'rgba(0,220,140,0.05)';
          e.currentTarget.style.borderColor = 'rgba(0,220,140,0.3)';
        }}
      >
        {copied ? t(lang, 'share_copied') : t(lang, 'share_btn')}
      </button>
    </div>
  );
}

// =============================================================================
// Floating background particles
// =============================================================================
function BackgroundParticles() {
  const canvasRef = useRef(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let w = canvas.width = window.innerWidth;
    let h = canvas.height = window.innerHeight;
    const particles = Array.from({ length: 50 }, () => ({
      x: Math.random() * w,
      y: Math.random() * h,
      vx: (Math.random() - 0.5) * 0.15,
      vy: (Math.random() - 0.5) * 0.15,
      size: Math.random() * 1.2 + 0.3,
      opacity: Math.random() * 0.4 + 0.1,
    }));

    function resize() {
      w = canvas.width = window.innerWidth;
      h = canvas.height = window.innerHeight;
    }
    window.addEventListener('resize', resize);

    let raf;
    function animate() {
      ctx.clearRect(0, 0, w, h);
      particles.forEach(p => {
        p.x += p.vx;
        p.y += p.vy;
        if (p.x < 0) p.x = w;
        if (p.x > w) p.x = 0;
        if (p.y < 0) p.y = h;
        if (p.y > h) p.y = 0;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(0, 220, 140, ${p.opacity})`;
        ctx.fill();
      });
      raf = requestAnimationFrame(animate);
    }
    animate();
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', resize); };
  }, []);
  return (
    <canvas
      ref={canvasRef}
      style={{
        position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 0,
        opacity: 0.6,
      }}
    />
  );
}

function SignalGrid() {
  return (
    <div
      aria-hidden="true"
      style={{
        position: 'fixed',
        inset: 0,
        pointerEvents: 'none',
        zIndex: 0,
        opacity: 0.55,
        backgroundImage: [
          'linear-gradient(rgba(0,220,140,0.035) 1px, transparent 1px)',
          'linear-gradient(90deg, rgba(56,189,248,0.035) 1px, transparent 1px)',
          'linear-gradient(180deg, rgba(56,189,248,0.06), transparent 32%, rgba(251,191,36,0.04) 70%, transparent)',
        ].join(','),
        backgroundSize: '74px 74px, 74px 74px, 100% 100%',
        maskImage: 'linear-gradient(to bottom, rgba(0,0,0,0.88), rgba(0,0,0,0.34) 72%, rgba(0,0,0,0.08))',
      }}
    />
  );
}

function ThreatOrbit({ questions }) {
  const points = [
    { x: 4, y: 27 }, { x: 18, y: 6 }, { x: 48, y: 0 }, { x: 76, y: 9 },
    { x: 86, y: 36 }, { x: 76, y: 69 }, { x: 42, y: 76 }, { x: 10, y: 64 },
  ];

  return (
    <div className="threat-orbit" aria-hidden="true">
      {questions.map((q, i) => {
        const point = points[i % points.length];
        return (
          <div
            key={q.id}
            className="orbit-chip"
            style={{
              left: `${point.x}%`,
              top: `${point.y}%`,
              '--accent': THREAT_ACCENTS[q.id] || '#00ff9d',
              '--accent-rgb': THREAT_ACCENT_RGB[q.id] || '0,255,157',
              animationDelay: `${i * 0.12}s`,
            }}
          >
            <span className="orbit-icon">{q.emoji}</span>
            <span className="orbit-label">{q.label}</span>
          </div>
        );
      })}
    </div>
  );
}

// =============================================================================
// Animated counter
// =============================================================================
function AnimatedNumber({ value }) {
  const [display, setDisplay] = useState(value);
  const prevRef = useRef(value);
  useEffect(() => {
    const start = prevRef.current;
    const diff = value - start;
    if (diff === 0) return;
    const duration = Math.min(1200, Math.max(400, Math.abs(diff) * 30));
    const startTime = performance.now();
    let raf;
    function step(now) {
      const elapsed = now - startTime;
      const t = Math.min(1, elapsed / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplay(Math.floor(start + diff * eased));
      if (t < 1) raf = requestAnimationFrame(step);
      else { setDisplay(value); prevRef.current = value; }
    }
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return <span className="number-glyphs">{display.toLocaleString()}</span>;
}

// =============================================================================
// Language Switcher
// =============================================================================
function LanguageSwitcher({ currentLang, onChange }) {
  const [open, setOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState({ top: 0, left: 12 });
  const triggerRef = useRef(null);
  const current = LANGUAGES.find(l => l.code === currentLang);

  useEffect(() => {
    if (!open) return;

    function updateMenuPosition() {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const menuWidth = window.innerWidth <= 720
        ? Math.min(244, window.innerWidth - 24)
        : 170;
      const maxLeft = Math.max(12, window.innerWidth - menuWidth - 12);
      const preferredLeft = rect.right - menuWidth;

      setMenuPosition({
        top: Math.min(rect.bottom + 8, window.innerHeight - 84),
        left: Math.min(Math.max(12, preferredLeft), maxLeft),
      });
    }

    updateMenuPosition();
    window.addEventListener('resize', updateMenuPosition);
    window.addEventListener('scroll', updateMenuPosition, true);

    return () => {
      window.removeEventListener('resize', updateMenuPosition);
      window.removeEventListener('scroll', updateMenuPosition, true);
    };
  }, [open]);

  return (
    <div className="language-switcher" style={{ position: 'relative' }}>
      <button ref={triggerRef} className="language-trigger" onClick={() => setOpen(!open)} style={{
        padding: '7px 14px',
        border: '1px solid rgba(0,220,140,0.18)',
        background: 'rgba(0,220,140,0.05)',
        color: 'rgba(0,230,150,0.85)',
        fontFamily: "'JetBrains Mono','DM Mono',monospace", fontSize: 11,
        letterSpacing: '0.02em', cursor: 'pointer',
        display: 'flex', alignItems: 'center', gap: 8,
        backdropFilter: 'blur(8px)',
        borderRadius: 2,
        transition: 'all 0.2s',
      }}
        onMouseEnter={e => { e.currentTarget.style.borderColor = 'rgba(0,220,140,0.4)'; e.currentTarget.style.background = 'rgba(0,220,140,0.1)'; }}
        onMouseLeave={e => { e.currentTarget.style.borderColor = 'rgba(0,220,140,0.18)'; e.currentTarget.style.background = 'rgba(0,220,140,0.05)'; }}
      >
        <span style={{ fontSize: 14 }}>{current?.flag}</span>
        <span>{current?.label}</span>
        <span style={{ fontSize: 7, opacity: 0.5, transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>▼</span>
      </button>
      {open && (
        <>
          <div className="language-backdrop" onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 300 }} />
          <div className="language-menu" style={{
            position: 'fixed', top: menuPosition.top, left: menuPosition.left,
            background: 'linear-gradient(180deg, rgba(6, 18, 13, 0.98), rgba(2, 10, 7, 0.98))',
            border: '1px solid rgba(0,255,157,0.28)',
            backdropFilter: 'blur(20px)',
            zIndex: 301, minWidth: 170,
            boxShadow: '0 20px 60px rgba(0,0,0,0.82), 0 0 0 1px rgba(0,220,140,0.08), 0 0 34px rgba(0,255,157,0.08)',
            animation: 'fadeIn 0.2s ease',
            borderRadius: 8,
            overflow: 'hidden',
          }}>
            {LANGUAGES.map(lang => (
              <button key={lang.code}
                onClick={() => { onChange(lang.code); setOpen(false); }}
                style={{
                  width: '100%', padding: '11px 16px',
                  border: 'none',
                  background: lang.code === currentLang ? 'rgba(0,220,140,0.1)' : 'transparent',
                  color: lang.code === currentLang ? '#00ff9d' : '#d0f0e0',
                  fontFamily: "'JetBrains Mono','DM Mono',monospace", fontSize: 12,
                  cursor: 'pointer', textAlign: 'left',
                  display: 'flex', alignItems: 'center', gap: 10,
                  transition: 'background 0.15s',
                }}
                onMouseEnter={e => { if (lang.code !== currentLang) e.currentTarget.style.background = 'rgba(0,220,140,0.06)'; }}
                onMouseLeave={e => { e.currentTarget.style.background = lang.code === currentLang ? 'rgba(0,220,140,0.1)' : 'transparent'; }}
              >
                <span style={{ fontSize: 16 }}>{lang.flag}</span>
                <span>{lang.label}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// =============================================================================
// Results View
// =============================================================================
function ResultsView({ stats, totalVotes, userRegion, userVote, lang }) {
  const [scope, setScope] = useState('planet');
  const regions = getRegions(lang);
  const questions = getQuestions(lang);
  const userRegionData = regions.find(r => r.id === userRegion);
  const showPercent = totalVotes >= 10000;

  const byRegion = {};
  REGION_IDS.forEach(r => { byRegion[r] = {}; });
  stats.forEach(row => {
    if (!byRegion[row.region_id]) byRegion[row.region_id] = {};
    byRegion[row.region_id][row.question_id] = Number(row.vote_count);
  });

  // Region totals for mini globe
  const regionTotals = REGION_IDS.reduce((acc, regId) => {
    acc[regId] = Object.values(byRegion[regId] || {}).reduce((s, v) => s + v, 0);
    return acc;
  }, {});

  const currentVotes = scope === 'planet'
    ? questions.reduce((acc, q) => {
        acc[q.id] = REGION_IDS.reduce((s, r) => s + (byRegion[r]?.[q.id] || 0), 0);
        return acc;
      }, {})
    : byRegion[userRegion] || {};

  const scopeTotal = Object.values(currentVotes).reduce((a, b) => a + b, 0);
  const maxV = Math.max(...Object.values(currentVotes), 1);
  const sorted = [...questions].sort((a, b) => (currentVotes[b.id] || 0) - (currentVotes[a.id] || 0));
  const topQuestion = sorted[0];
  const topVotes = topQuestion ? (currentVotes[topQuestion.id] || 0) : 0;
  const topPercent = scopeTotal > 0 ? (topVotes / scopeTotal * 100).toFixed(1) : '0.0';
  const activeRegions = REGION_IDS.filter(regId => (regionTotals[regId] || 0) > 0).length;

  if (totalVotes === 0) {
    return (
      <div style={{ animation: 'fadeUp 0.6s ease', textAlign: 'center', padding: '80px 0' }}>
        <div style={{
          fontSize: 80, marginBottom: 28, opacity: 0.5,
          animation: 'float 4s ease-in-out infinite',
          display: 'inline-block',
        }}>
          {t(lang, 'empty_emoji')}
        </div>
        <div style={{
          fontFamily: "'Syne','Inter',sans-serif", fontSize: 'clamp(24px,4.5vw,38px)',
          fontWeight: 800, color: '#fff', marginBottom: 16,
          letterSpacing: 0,
        }}>
          {t(lang, 'empty_title')}
        </div>
        <p style={{
          fontSize: 14, color: 'rgba(200,255,220,0.55)',
          maxWidth: 420, margin: '0 auto', lineHeight: 1.9,
          fontFamily: "'JetBrains Mono','DM Mono',monospace",
        }}>
          {t(lang, 'empty_text_1')}<br />
          {t(lang, 'empty_text_2')}
        </p>
      </div>
    );
  }

  return (
    <div style={{ animation: 'fadeUp 0.6s ease' }}>
      <section className="results-hero">
        <div className="results-orb" style={{ animation: 'fadeUp 0.6s ease' }}>
          <div style={{ position: 'relative', zIndex: 1 }}>
            <InteractiveGlobe
              size={220}
              dotCount={240}
              userRegion={userRegion}
              regionVotes={regionTotals}
              voteCount={totalVotes}
            />
          </div>
        </div>


        <div>
          <div className="page-kicker">{t(lang, 'results_live')}</div>
          <h1 className="section-title">{t(lang, 'results_title')}</h1>
          <p style={{
            color: 'rgba(220,255,235,0.62)',
            fontSize: 14,
            lineHeight: 1.8,
            margin: 0,
            fontFamily: "'Inter','JetBrains Mono',sans-serif",
          }}>
            {t(lang, 'results_why_text')}
          </p>
        </div>
      </section>

      <div className="metric-grid">
        <div className="metric-card">
          <div className="metric-label">{t(lang, 'results_live')}</div>
          <div className="metric-value"><AnimatedNumber value={totalVotes} /></div>
          <div className="metric-sub">{totalVotes === 1 ? t(lang, 'vote_singular') : t(lang, 'votes_label')}</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">{scope === 'planet' ? t(lang, 'results_scope_planet') : userRegionData?.label}</div>
          <div className="metric-value"><span className="number-glyphs">{scopeTotal.toLocaleString()}</span></div>
          <div className="metric-sub">
            {scope === 'planet' ? (
              <>
                <span className="number-glyphs">{activeRegions}</span>/<span className="number-glyphs">{REGION_IDS.length}</span>
              </>
            ) : userRegionData?.flag}
          </div>
        </div>
        <div className="metric-card">
          <div className="metric-label">{t(lang, 'results_top_region')}</div>
          <div
            className="metric-value threat-metric"
            style={{ '--metric-accent': THREAT_ACCENTS[topQuestion?.id] || '#00ff9d' }}
          >
            <span className="metric-emoji">{topQuestion?.emoji}</span>
            <span className="number-glyphs">{showPercent ? topPercent + '%' : topVotes.toLocaleString()}</span>
          </div>
          <div className="metric-sub">{topQuestion?.label}</div>
        </div>
      </div>

      {!showPercent && (
        <div className="notice-band">
          {t(lang, 'results_few_warning')}
        </div>
      )}

      <div className="scope-switch">
        {[
          { id: 'planet', label: t(lang, 'results_scope_planet') },
          { id: 'region', label: `${userRegionData?.flag || ''} ${userRegionData?.label || ''}` },
        ].map(s => (
          <button
            key={s.id}
            onClick={() => setScope(s.id)}
            className={`scope-btn ${scope === s.id ? 'on' : ''}`}
          >
            {s.label}
          </button>
        ))}
      </div>

      <div className="result-list">
        {sorted.map((q, i) => {
          const v = currentVotes[q.id] || 0;
          const pct = scopeTotal > 0 ? (v / scopeTotal * 100).toFixed(1) : 0;
          const barW = maxV > 0 ? (v / maxV * 100) : 0;
          const isTop = i === 0 && v > 0;
          const isYours = q.id === userVote;
          return (
            <div
              key={q.id}
              className={'result-row ' + (isTop ? 'top' : '')}
              style={{
                '--accent': THREAT_ACCENTS[q.id] || '#00ff9d',
                '--accent-rgb': THREAT_ACCENT_RGB[q.id] || '0,255,157',
                '--bar-width': barW + '%',
                animation: 'slideIn 0.5s ease ' + (i * 0.05) + 's both',
              }}
            >
              <div className="result-bar" />
              <div className="result-content">
                <span className="rank-badge">{String(i + 1).padStart(2, '0')}</span>
                <span className="result-emoji">{q.emoji}</span>
                <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span className="result-name">{q.label}</span>
                  {isYours && <span className="vote-tag">{t(lang, 'results_your_vote')}</span>}
                </div>
                <div style={{ textAlign: 'right', minWidth: 56 }}>
                  <div className="result-number">
                    <span className="number-glyphs">{showPercent ? pct + '%' : v.toLocaleString()}</span>
                  </div>
                  {showPercent && (
                    <div className="result-count-detail">
                      <span className="number-glyphs">{v.toLocaleString()}</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {showPercent && (
        <div style={{ marginTop: 52 }}>
          <div style={{ fontSize: 10, color: 'rgba(0,220,140,0.4)', letterSpacing: '0.18em', marginBottom: 18, fontFamily: "'JetBrains Mono','DM Mono',monospace" }}>
            {t(lang, 'results_top_region')}
          </div>
          <div className="region-grid">
            {regions.map(reg => {
              const rv = byRegion[reg.id] || {};
              const top = questions.reduce((a, b) => (rv[a.id] || 0) > (rv[b.id] || 0) ? a : b);
              const isUser = reg.id === userRegion;
              const hasData = Object.values(rv).some(v => v > 0);
              if (!hasData) return null;
              return (
                <div key={reg.id} className={`region-tile ${isUser ? 'user' : ''}`}>
                  <div style={{ fontSize: 10, color: 'rgba(0,220,140,0.5)', marginBottom: 8, fontFamily: "'JetBrains Mono','DM Mono',monospace" }}>
                    {reg.flag} {reg.label}
                  </div>
                  <div style={{ fontSize: 22, marginBottom: 6 }}>{top.emoji}</div>
                  <div style={{ fontSize: 11, color: '#e0ffe8' }}>{top.label}</div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {userVote && userRegion && (
        <ResultCard
          questionId={userVote}
          regionId={userRegion}
          regionStats={byRegion[userRegion] || {}}
          regionTotal={regionTotals[userRegion] || 0}
          lang={lang}
          t={(key) => t(lang, key)}
          siteUrl={SITE_URL}
        />
      )}

      <div className="info-band">
        <div style={{ fontSize: 10, color: 'rgba(0,220,140,0.55)', letterSpacing: '0.15em', marginBottom: 10, fontFamily: "'JetBrains Mono','DM Mono',monospace" }}>
          {t(lang, 'results_why_title')}
        </div>
        <div style={{ fontSize: 12, color: 'rgba(220,255,235,0.55)', lineHeight: 1.9, fontFamily: "'JetBrains Mono','DM Mono',monospace" }}>
          {t(lang, 'results_why_text')}
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// Main App
// =============================================================================
export default function App() {
  const [lang, setLang] = useState(() => getSavedLanguage() || detectBrowserLanguage());
  const [step, setStep] = useState('intro');
  const [selected, setSelected] = useState(null);
  const [region, setRegion] = useState(null);
  const [stats, setStats] = useState([]);
  const [totalVotes, setTotalVotes] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [alreadyVoted, setAlreadyVoted] = useState(false);
  const [showVoteAnim, setShowVoteAnim] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState('');
  const [turnstileStatus, setTurnstileStatus] = useState('pending');
  const [turnstileResetSignal, setTurnstileResetSignal] = useState(0);
  const [viewportWidth, setViewportWidth] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth : 1024
  );

  const questions = getQuestions(lang);
  const regions = getRegions(lang);
  const secureVotingEnabled = Boolean(TURNSTILE_SITE_KEY);
  const heroGlobeSize = viewportWidth <= 720
    ? Math.min(300, Math.max(260, viewportWidth - 92))
    : 340;

  // Calculate vote totals per region for the globe markers
  const regionVotes = REGION_IDS.reduce((acc, regId) => {
    acc[regId] = stats
      .filter(row => row.region_id === regId)
      .reduce((sum, row) => sum + Number(row.vote_count), 0);
    return acc;
  }, {});

  function changeLang(code) {
    setLang(code);
    saveLanguage(code);
    document.documentElement.lang = code;
  }

  useEffect(() => { document.documentElement.lang = lang; }, [lang]);

  useEffect(() => {
    function onResize() {
      setViewportWidth(window.innerWidth);
    }
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const loadData = useCallback(async () => {
    try {
      const { data: statsData } = await supabase.rpc('get_vote_stats');
      setStats(statsData || []);
      const { data: totalData } = await supabase.rpc('get_total_votes');
      setTotalVotes(Number(totalData) || 0);
      const fingerprint = await getDeviceFingerprint();
      const { data: existingVote } = await supabase
        .from('votes')
        .select('question_id, region_id')
        .eq('fingerprint', fingerprint)
        .maybeSingle();
      if (existingVote) {
        setAlreadyVoted(true);
        setSelected(existingVote.question_id);
        setRegion(existingVote.region_id);
        // Stay on intro — user can choose to see results via button
      } else {
        const local = getLocalVote();
        if (local) {
          setAlreadyVoted(true);
          setSelected(local.questionId);
          setRegion(local.regionId);
        }
      }
    } catch (e) {
      console.error('Failed to load data:', e);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  async function handleVote() {
    if (!selected || !region || loading) return;
    if (secureVotingEnabled && !turnstileToken) {
      setError(t(lang, 'vote_verification_required'));
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const fingerprint = await getDeviceFingerprint();

      let insertError = null;
      if (secureVotingEnabled) {
        const response = await fetch('/api/vote', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            question_id: selected,
            region_id: region,
            fingerprint,
            turnstileToken,
          }),
        });

        const result = await response.json().catch(() => ({}));
        if (!response.ok) {
          if (result.code === 'duplicate_vote') {
            insertError = { code: '23505' };
          } else {
            setTurnstileToken('');
            setTurnstileStatus(
              typeof result.code === 'string' && result.code.startsWith('turnstile')
                ? 'error'
                : 'pending'
            );
            setTurnstileResetSignal(Date.now());
            throw new Error(
              typeof result.code === 'string' && result.code.startsWith('turnstile')
                ? 'vote_verification_error'
                : result.code || 'secure_vote_failed'
            );
          }
        }
      } else {
        const { error } = await supabase
          .from('votes')
          .insert({ question_id: selected, region_id: region, fingerprint });
        insertError = error;
      }

      if (insertError) {
        if (insertError.code === '23505') {
          setError(t(lang, 'vote_already_error'));
          setAlreadyVoted(true);
          await loadData();
          setStep('results');
        } else throw insertError;
      } else {
        markAsVoted(selected, region);
        setAlreadyVoted(true);
        await loadData();
        // Show celebration animation, then transition to results
        setShowVoteAnim(true);
        setTimeout(() => {
          setStep('results');
        }, 100);
      }
    } catch (e) {
      console.error('Vote failed:', e);
      setError(t(lang, e.message === 'vote_verification_error' ? 'vote_verification_error' : 'vote_error'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(180deg, #03100c 0%, #020805 46%, #030611 100%)',
      color: '#e0ffe8',
      fontFamily: "'JetBrains Mono','DM Mono',monospace",
      position: 'relative',
      overflow: 'hidden',
    }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@300;400;500;600&family=Syne:wght@600;700;800&family=Inter:wght@400;500;700;800&display=swap');
        *{box-sizing:border-box}
        @keyframes pulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:0.4;transform:scale(0.9)}}
        @keyframes fadeUp{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:translateY(0)}}
        @keyframes fadeIn{from{opacity:0}to{opacity:1}}
        @keyframes slideIn{from{opacity:0;transform:translateX(-12px)}to{opacity:1;transform:translateX(0)}}
        @keyframes float{0%,100%{transform:translateY(0)}50%{transform:translateY(-12px)}}
        @keyframes spin{to{transform:rotate(360deg)}}
        @keyframes voteRing{0%{transform:translate(-50%,-50%) scale(0);opacity:0.9}100%{transform:translate(-50%,-50%) scale(6);opacity:0}}
        @keyframes votePulse{0%,100%{transform:translate(-50%,-50%) scale(1)}50%{transform:translate(-50%,-50%) scale(1.12)}}
        @keyframes slideUp{from{opacity:0;transform:translateY(40px)}to{opacity:1;transform:translateY(0)}}
        @keyframes orbitFloat{0%,100%{transform:translate3d(-50%,0,0)}50%{transform:translate3d(-50%,-8px,0)}}
        @keyframes softScan{0%{transform:translateX(-120%)}100%{transform:translateX(120%)}}
        @keyframes shimmer{
          0%{background-position:-200% 0}
          100%{background-position:200% 0}
        }
        @keyframes glow{
          0%,100%{box-shadow:0 0 20px rgba(0,255,157,0.2),0 0 40px rgba(0,255,157,0.05)}
          50%{box-shadow:0 0 30px rgba(0,255,157,0.4),0 0 60px rgba(0,255,157,0.1)}
        }
        .number-glyphs{
          display:inline-block;
          font-family:'Inter','JetBrains Mono',system-ui,sans-serif;
          font-variant-numeric:tabular-nums lining-nums;
          font-feature-settings:'tnum' 1,'lnum' 1;
          letter-spacing:0;
        }
        .hero-stage{
          position:relative;width:min(100%,560px);min-height:355px;
          display:flex;align-items:center;justify-content:center;margin:0 auto;
        }
        .hero-stage::before{
          content:'';position:absolute;left:8%;right:8%;top:49%;height:1px;
          background:linear-gradient(90deg,transparent,rgba(56,189,248,0.28),rgba(0,255,157,0.42),transparent);
          opacity:.8;
        }
        .hero-stage::after{
          content:'';position:absolute;left:18%;right:18%;bottom:40px;height:1px;
          background:linear-gradient(90deg,transparent,rgba(251,191,36,0.22),transparent);
        }
        .threat-orbit{position:absolute;inset:0;pointer-events:none}
        .orbit-chip{
          position:absolute;transform:translateX(-50%);
          min-width:92px;max-width:150px;padding:8px 10px;border-radius:8px;
          border:1px solid rgba(var(--accent-rgb,0,255,157),0.42);
          background:linear-gradient(135deg,rgba(var(--accent-rgb,0,255,157),0.16),rgba(5,18,14,0.62));
          color:#f4fff8;display:flex;align-items:center;gap:7px;
          box-shadow:0 10px 34px rgba(0,0,0,0.34),0 0 22px rgba(var(--accent-rgb,0,255,157),0.16);
          backdrop-filter:blur(12px);animation:orbitFloat 5.4s ease-in-out infinite;
        }
        .orbit-icon{font-size:16px;line-height:1}
        .orbit-label{
          font-family:'Inter','JetBrains Mono',sans-serif;font-size:10px;line-height:1.15;
          color:rgba(244,255,248,0.82);overflow-wrap:anywhere;
        }
        .hero-signal-row{
          width:calc(100vw - 48px);max-width:620px;display:grid;grid-template-columns:1fr auto 1fr;
          align-items:center;gap:12px;margin:14px auto 0;padding:10px 12px;
          border:1px solid rgba(0,220,140,0.12);border-radius:8px;
          background:linear-gradient(90deg,rgba(0,220,140,0.035),rgba(56,189,248,0.04),rgba(251,191,36,0.025));
          color:rgba(220,255,235,0.56);font-family:'JetBrains Mono','DM Mono',monospace;
          font-size:10px;letter-spacing:0.09em;text-transform:uppercase;overflow:hidden;position:relative;
        }
        .hero-signal-row::before{
          content:'';position:absolute;top:0;bottom:0;width:35%;left:0;
          background:linear-gradient(90deg,transparent,rgba(255,255,255,0.08),transparent);
          animation:softScan 4.8s ease-in-out infinite;
        }
        .hero-signal-row strong{
          color:#dfffee;font-weight:800;
          display:inline-flex;align-items:baseline;justify-content:center;gap:5px;
          font-family:'Inter','JetBrains Mono',system-ui,sans-serif;
          font-variant-numeric:tabular-nums lining-nums;
          font-feature-settings:'tnum' 1,'lnum' 1;
          letter-spacing:0;
          text-shadow:0 0 18px rgba(0,255,157,0.18);
        }
        .hero-signal-row strong .number-glyphs{
          color:#00ff9d;font-size:12px;
        }
        .trust-strip{
          display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;
          margin:0 auto 42px;width:min(100%,620px);
        }
        .trust-item{
          border:1px solid rgba(0,220,140,0.1);border-radius:8px;
          background:rgba(8,18,14,0.48);padding:12px 10px;
          color:rgba(220,255,235,0.58);font-size:10px;line-height:1.55;
          font-family:'JetBrains Mono','DM Mono',monospace;
        }
        .hero-copy{width:calc(100vw - 48px);max-width:580px;margin-top:30px}
        .hero-title{
          font-family:'Syne','Inter',sans-serif;font-size:clamp(28px,5.2vw,48px);
          font-weight:800;line-height:1.06;margin-bottom:24px;letter-spacing:0;text-wrap:balance;
        }
        .hero-title .title-line{
          display:block;background:var(--title-gradient);
          -webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;
        }
        .page-kicker{
          display:flex;align-items:center;gap:9px;color:rgba(0,255,157,0.68);
          font-size:10px;letter-spacing:0.16em;text-transform:uppercase;
          font-family:'JetBrains Mono','DM Mono',monospace;
        }
        .page-kicker::before{
          content:'';width:7px;height:7px;border-radius:999px;background:#00ff9d;
          box-shadow:0 0 10px rgba(0,255,157,0.85),0 0 22px rgba(0,255,157,0.25);
        }
        .section-title{
          font-family:'Syne','Inter',sans-serif;font-size:clamp(30px,5vw,48px);
          font-weight:800;line-height:1.06;letter-spacing:0;margin:14px 0 14px;
          background:linear-gradient(135deg,#fff 18%,#dfffee 56%,#00ff9d 100%);
          -webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;
        }
        .results-hero{
          display:grid;grid-template-columns:minmax(180px,250px) minmax(0,1fr);
          align-items:center;gap:28px;margin-bottom:28px;
        }
        .results-orb{
          position:relative;display:flex;align-items:center;justify-content:center;min-height:250px;
        }
        .results-orb::before{
          content:'';position:absolute;width:230px;height:230px;border-radius:50%;
          background:radial-gradient(circle,rgba(0,255,157,0.14),rgba(56,189,248,0.055) 45%,transparent 68%);
          filter:blur(2px);
        }
        .metric-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin:0 0 28px}
        .metric-card{
          border:1px solid rgba(0,220,140,0.12);border-radius:8px;
          background:linear-gradient(135deg,rgba(0,255,157,0.055),rgba(8,18,14,0.45));
          padding:14px 14px;min-height:82px;position:relative;overflow:hidden;
        }
        .metric-card::after{
          content:'';position:absolute;left:0;right:0;bottom:0;height:2px;
          background:linear-gradient(90deg,transparent,rgba(0,255,157,0.62),transparent);
          opacity:.42;
        }
        .metric-label{
          color:rgba(220,255,235,0.48);font-size:9px;letter-spacing:.12em;
          text-transform:uppercase;margin-bottom:8px;font-family:'JetBrains Mono','DM Mono',monospace;
        }
        .metric-value{
          color:#f4fff8;font-family:'Inter','JetBrains Mono',system-ui,sans-serif;font-weight:800;
          font-size:clamp(24px,3.4vw,34px);line-height:1;letter-spacing:0;
          font-variant-numeric:tabular-nums lining-nums;
          font-feature-settings:'tnum' 1,'lnum' 1;
          display:flex;align-items:center;gap:8px;
          text-shadow:0 0 22px rgba(0,255,157,0.12),0 8px 26px rgba(0,0,0,0.34);
        }
        .metric-value .number-glyphs{font:inherit}
        .metric-value.threat-metric{color:var(--metric-accent,#00ff9d)}
        .metric-emoji{
          font-size:.76em;line-height:1;filter:drop-shadow(0 0 14px rgba(0,255,157,0.18));
        }
        .metric-sub{color:rgba(220,255,235,0.5);font-size:10px;margin-top:6px;line-height:1.45}
        .notice-band{
          border:1px solid rgba(251,191,36,0.2);border-radius:8px;
          background:linear-gradient(135deg,rgba(251,191,36,0.085),rgba(8,18,14,0.36));
          color:rgba(255,224,170,0.84);padding:14px 16px;margin-bottom:24px;
          font-size:11px;line-height:1.75;font-family:'JetBrains Mono','DM Mono',monospace;
        }
        .turnstile-panel{
          border:1px solid rgba(56,189,248,0.18);border-radius:8px;
          background:linear-gradient(135deg,rgba(56,189,248,0.06),rgba(0,255,157,0.025));
          padding:14px 16px;margin:0 0 18px;display:grid;gap:10px;
          box-shadow:0 14px 40px rgba(0,0,0,0.14);
        }
        .turnstile-status{
          color:rgba(220,255,235,0.56);font-size:10px;letter-spacing:.08em;
          text-transform:uppercase;font-family:'JetBrains Mono','DM Mono',monospace;
          display:flex;align-items:center;gap:8px;
        }
        .turnstile-status::before{
          content:'';width:6px;height:6px;border-radius:999px;background:var(--status-color,#38bdf8);
          box-shadow:0 0 12px var(--status-color,#38bdf8);
        }
        .scope-switch{display:flex;gap:8px;margin-bottom:24px;flex-wrap:wrap}
        .scope-btn{
          padding:10px 18px;border-radius:8px;border:1px solid rgba(0,220,140,0.16);
          background:rgba(8,18,14,0.44);color:rgba(220,255,235,0.58);
          font-family:'JetBrains Mono','DM Mono',monospace;font-size:11px;letter-spacing:.05em;
          cursor:pointer;transition:all .22s;
        }
        .scope-btn.on{
          border-color:rgba(0,255,157,0.72);background:rgba(0,255,157,0.1);color:#00ff9d;
          box-shadow:0 0 28px rgba(0,255,157,0.1);
        }
        .result-list{display:flex;flex-direction:column;gap:10px}
        .result-row{
          position:relative;overflow:hidden;border-radius:8px;
          border:1px solid rgba(var(--accent-rgb,0,255,157),0.18);
          background:linear-gradient(135deg,rgba(var(--accent-rgb,0,255,157),0.06),rgba(8,18,14,0.42));
          padding:16px 18px;backdrop-filter:blur(6px);
          box-shadow:0 12px 34px rgba(0,0,0,0.14);
        }
        .result-row.top{
          border-color:rgba(var(--accent-rgb,0,255,157),0.44);
          box-shadow:0 16px 46px rgba(0,0,0,0.22),0 0 34px rgba(var(--accent-rgb,0,255,157),0.12);
        }
        .result-bar{
          position:absolute;left:0;top:0;bottom:0;width:var(--bar-width);
          background:linear-gradient(90deg,rgba(var(--accent-rgb,0,255,157),0.18),rgba(var(--accent-rgb,0,255,157),0.035));
          transition:width 1.2s cubic-bezier(.22,.61,.36,1);
        }
        .result-content{position:relative;display:flex;align-items:center;gap:14px}
        .rank-badge{
          min-width:30px;height:30px;border-radius:8px;border:1px solid rgba(var(--accent-rgb,0,255,157),0.26);
          display:flex;align-items:center;justify-content:center;color:var(--accent,#00ff9d);
          font-size:10px;font-family:'Inter','JetBrains Mono',system-ui,sans-serif;font-weight:800;
          font-variant-numeric:tabular-nums lining-nums;font-feature-settings:'tnum' 1,'lnum' 1;
          letter-spacing:0;background:rgba(0,0,0,0.16);
        }
        .result-emoji{font-size:26px;filter:drop-shadow(0 0 14px rgba(var(--accent-rgb,0,255,157),0.24))}
        .result-name{font-size:14px;color:#f4fff8;line-height:1.25;font-family:'Inter','JetBrains Mono',sans-serif;font-weight:700}
        .vote-tag{
          display:inline-flex;align-items:center;padding:4px 7px;border-radius:999px;
          border:1px solid rgba(0,255,157,0.34);background:rgba(0,255,157,0.08);
          color:#00ff9d;font-size:9px;letter-spacing:.08em;text-transform:uppercase;
          font-family:'JetBrains Mono','DM Mono',monospace;
        }
        .result-number{
          color:var(--accent,#00ff9d);font-family:'Inter','JetBrains Mono',system-ui,sans-serif;
          font-size:24px;font-weight:800;letter-spacing:0;line-height:1;
          font-variant-numeric:tabular-nums lining-nums;font-feature-settings:'tnum' 1,'lnum' 1;
          display:inline-flex;justify-content:flex-end;min-width:58px;
          text-shadow:0 0 18px rgba(var(--accent-rgb,0,255,157),0.2),0 8px 20px rgba(0,0,0,0.32);
        }
        .result-number .number-glyphs{font:inherit}
        .result-count-detail{
          margin-top:5px;color:rgba(220,255,235,0.38);font-size:10px;line-height:1;
          font-family:'Inter','JetBrains Mono',system-ui,sans-serif;font-weight:700;
          font-variant-numeric:tabular-nums lining-nums;font-feature-settings:'tnum' 1,'lnum' 1;
          letter-spacing:0;
        }
        .region-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px}
        .region-tile{
          border:1px solid rgba(0,220,140,0.1);border-radius:8px;background:rgba(8,18,14,0.44);
          padding:14px 12px;text-align:center;backdrop-filter:blur(5px);
        }
        .region-tile.user{border-color:rgba(0,255,157,0.32);background:rgba(0,255,157,0.065)}
        .info-band{
          margin-top:42px;border:1px solid rgba(0,220,140,0.12);border-radius:8px;
          background:linear-gradient(135deg,rgba(56,189,248,0.055),rgba(0,255,157,0.025));
          padding:20px 22px;position:relative;overflow:hidden;
        }
        .info-band::before{
          content:'';position:absolute;left:0;top:0;bottom:0;width:3px;
          background:linear-gradient(#38bdf8,#00ff9d);
        }
        .about-hero{
          display:grid;grid-template-columns:minmax(0,1.35fr) minmax(240px,.65fr);
          gap:28px;align-items:end;margin-bottom:44px;
        }
        .about-signal{
          border:1px solid rgba(0,220,140,0.13);border-radius:8px;
          background:linear-gradient(135deg,rgba(0,255,157,0.06),rgba(56,189,248,0.035));
          padding:18px;display:grid;gap:10px;
        }
        .signal-item{
          display:flex;align-items:center;justify-content:space-between;gap:12px;
          border-bottom:1px solid rgba(0,220,140,0.08);padding-bottom:10px;
          color:rgba(220,255,235,0.58);font-size:10px;line-height:1.45;
        }
        .signal-item:last-child{border-bottom:0;padding-bottom:0}
        .signal-dot{width:8px;height:8px;border-radius:999px;background:var(--accent,#00ff9d);box-shadow:0 0 16px var(--accent,#00ff9d);flex:0 0 auto}
        .about-flow{display:grid;gap:14px;margin-bottom:42px}
        .about-step{
          display:grid;grid-template-columns:54px minmax(0,1fr);gap:18px;
          border:1px solid rgba(0,220,140,0.1);border-radius:8px;
          background:rgba(8,18,14,0.42);padding:22px 22px;position:relative;overflow:hidden;
        }
        .about-step.featured{
          border-color:rgba(0,255,157,0.28);
          background:linear-gradient(135deg,rgba(0,255,157,0.075),rgba(8,18,14,0.42));
        }
        .about-step.featured::after{
          content:'';position:absolute;left:0;right:0;top:0;height:2px;
          background:linear-gradient(90deg,transparent,#00ff9d,transparent);opacity:.55;
        }
        .step-num{
          width:40px;height:40px;border-radius:8px;border:1px solid rgba(0,255,157,0.24);
          display:flex;align-items:center;justify-content:center;color:#00ff9d;
          font-size:11px;font-family:'Inter','JetBrains Mono',system-ui,sans-serif;font-weight:800;
          font-variant-numeric:tabular-nums lining-nums;font-feature-settings:'tnum' 1,'lnum' 1;
          letter-spacing:0;background:rgba(0,0,0,0.14);
        }
        .about-card-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin-bottom:42px}
        .principle-card{
          border:1px solid rgba(0,220,140,0.1);border-radius:8px;background:rgba(8,18,14,0.44);
          padding:15px 15px;display:flex;gap:12px;min-height:96px;backdrop-filter:blur(5px);
        }
        .principle-index{
          color:#00ff9d;font-size:10px;letter-spacing:0;
          font-family:'Inter','JetBrains Mono',system-ui,sans-serif;font-weight:800;
          font-variant-numeric:tabular-nums lining-nums;font-feature-settings:'tnum' 1,'lnum' 1;
        }
        .quote-panel{
          border:1px solid rgba(0,255,157,0.2);border-radius:8px;
          background:radial-gradient(circle at top left,rgba(0,255,157,0.12),transparent 38%),rgba(8,18,14,0.48);
          padding:30px 28px;position:relative;overflow:hidden;margin-bottom:38px;
        }
        .quote-panel::before{
          content:'"';position:absolute;right:22px;top:-18px;font-size:110px;line-height:1;
          color:rgba(0,255,157,0.08);font-family:'Syne','Inter',sans-serif;font-weight:800;
        }
        .qb{
          min-height:132px;padding:16px 12px;border:1px solid rgba(var(--accent-rgb,0,255,157),0.28);
          background:linear-gradient(135deg,rgba(var(--accent-rgb,0,255,157),0.11),rgba(8,18,14,0.42));
          color:#e0ffe8;font-family:'JetBrains Mono','DM Mono',monospace;font-size:11px;
          cursor:pointer;transition:all 0.3s cubic-bezier(0.22,0.61,0.36,1);
          text-align:center;display:flex;flex-direction:column;gap:10px;align-items:center;justify-content:center;
          border-radius:8px;backdrop-filter:blur(8px);position:relative;overflow:hidden;
          box-shadow:0 14px 42px rgba(0,0,0,0.18);
        }
        .qb::before{
          content:'';position:absolute;inset:0;
          background:linear-gradient(135deg,transparent 30%,rgba(var(--accent-rgb,0,255,157),0.2) 50%,transparent 70%);
          background-size:200% 200%;
          opacity:0;transition:opacity 0.3s;
        }
        .qb::after{
          content:'';position:absolute;left:12px;right:12px;bottom:10px;height:2px;border-radius:999px;
          background:linear-gradient(90deg,transparent,var(--accent,#00ff9d),transparent);opacity:.35;
        }
        .qb:hover{
          background:linear-gradient(135deg,rgba(var(--accent-rgb,0,255,157),0.18),rgba(0,220,140,0.04));
          border-color:var(--accent,#00ff9d);transform:translateY(-4px);
        }
        .qb:hover::before{opacity:1;animation:shimmer 1.5s infinite}
        .qb.on{
          background:linear-gradient(135deg,rgba(var(--accent-rgb,0,255,157),0.26),rgba(0,255,157,0.04));
          border-color:var(--accent,#00ff9d)!important;
          box-shadow:0 0 0 1px rgba(var(--accent-rgb,0,255,157),0.24),0 18px 52px rgba(0,0,0,0.32),0 0 42px rgba(var(--accent-rgb,0,255,157),0.18);
        }
        .qb-index{
          position:absolute;top:11px;left:12px;color:var(--accent,#00ff9d);
          font-size:10px;letter-spacing:0;opacity:.78;
          font-family:'Inter','JetBrains Mono',system-ui,sans-serif;font-weight:800;
          font-variant-numeric:tabular-nums lining-nums;font-feature-settings:'tnum' 1,'lnum' 1;
        }
        .qb-icon{font-size:30px;filter:drop-shadow(0 0 12px rgba(var(--accent-rgb,0,255,157),0.32))}
        .qb-label{font-size:12px;line-height:1.28;max-width:100%;overflow-wrap:anywhere;color:rgba(244,255,248,0.9)}
        .rb{
          padding:9px 16px;border:1px solid rgba(0,220,140,0.13);
          background:transparent;color:rgba(200,255,220,0.5);
          font-family:'JetBrains Mono','DM Mono',monospace;font-size:11px;
          letter-spacing:0.04em;cursor:pointer;transition:all 0.25s;border-radius:8px;
        }
        .rb:hover{
          border-color:rgba(0,255,157,0.45);
          color:rgba(200,255,220,0.95);
          background:rgba(0,220,140,0.04);
        }
        .rb.on{
          border-color:rgba(0,255,157,0.7)!important;
          color:#00ff9d!important;
          background:rgba(0,255,157,0.08)!important;
        }
        .cta{
          padding:17px 44px;border:1px solid #00ff9d;
          background:linear-gradient(135deg,#00ff9d,#38bdf8);color:#02100a;
          font-family:'JetBrains Mono','DM Mono',monospace;font-size:12px;
          letter-spacing:0.22em;cursor:pointer;transition:all 0.3s;
          position:relative;overflow:hidden;border-radius:8px;
          font-weight:800;box-shadow:0 0 0 1px rgba(0,255,157,0.12),0 18px 56px rgba(0,255,157,0.16),0 16px 46px rgba(0,0,0,0.28);
        }
        .cta::before{
          content:'';position:absolute;inset:0;
          background:linear-gradient(135deg,rgba(0,255,157,0.4),transparent);
          transform:translateX(-100%);transition:transform 0.4s;
        }
        .cta:hover:not(:disabled){
          background:#dffff0!important;color:#000!important;
          box-shadow:0 0 30px rgba(0,255,157,0.4),0 0 60px rgba(0,255,157,0.15);
          transform:translateY(-1px);
        }
        .cta:hover:not(:disabled)::before{transform:translateX(100%)}
        .cta:disabled{opacity:0.25;cursor:not-allowed}
        .language-switcher{z-index:310}
        .language-menu button:not(:last-child){border-bottom:1px solid rgba(0,220,140,0.08)!important}
        .header-vote-count .number-glyphs{
          color:#dfffee;font-weight:800;
          text-shadow:0 0 14px rgba(0,255,157,0.18);
        }
        @media(max-width:720px){
          .language-switcher{position:static!important}
          .language-trigger{
            min-height:36px;
            background:rgba(4,16,11,0.96)!important;
            border-color:rgba(0,255,157,0.32)!important;
            box-shadow:0 10px 30px rgba(0,0,0,0.34);
          }
          .language-backdrop{
            z-index:300!important;
            background:rgba(0,0,0,0.34)!important;
            backdrop-filter:blur(2px);
          }
          .language-menu{
            position:fixed!important;
            width:min(244px,calc(100vw - 24px))!important;
            max-height:calc(100vh - 84px);
            overflow:auto!important;
            background:linear-gradient(180deg,#071611 0%,#020906 100%)!important;
            border:1px solid rgba(0,255,157,0.38)!important;
            border-radius:10px!important;
            box-shadow:0 24px 76px rgba(0,0,0,0.92),0 0 0 1px rgba(0,255,157,0.1),0 0 44px rgba(0,255,157,0.12)!important;
          }
          .language-menu button{
            min-height:44px;
            background:rgba(4,16,11,0.98)!important;
          }
          .hero-stage{min-height:285px}
          .orbit-label{display:none}
          .orbit-chip{min-width:42px;max-width:42px;height:42px;justify-content:center;padding:0;border-radius:999px}
          .orbit-chip:nth-child(1){left:10%!important}
          .orbit-chip:nth-child(5){left:90%!important}
          .hero-copy{margin-top:24px}
          .hero-title{font-size:24px;line-height:1.18;margin-bottom:20px}
          .hero-signal-row{grid-template-columns:1fr;font-size:9px;text-align:center;gap:6px}
          .trust-strip{grid-template-columns:1fr;margin-top:34px}
          .results-hero,.about-hero{grid-template-columns:1fr;gap:18px}
          .results-orb{min-height:205px}
          .results-orb::before{width:190px;height:190px}
          .metric-grid{grid-template-columns:1fr}
          .result-row{padding:14px}
          .result-content{gap:10px}
          .result-emoji{font-size:22px}
          .result-name{font-size:13px}
          .result-number{font-size:19px}
          .about-step{grid-template-columns:1fr;gap:12px;padding:18px}
          .about-card-grid{grid-template-columns:1fr}
          .quote-panel{padding:24px 20px}
          .qb{min-height:118px}
        }
        ::selection{background:rgba(0,255,157,0.3);color:#fff}
      `}</style>

      <BackgroundParticles />
      <SignalGrid />

      {showVoteAnim && (
        <VoteAnimation
          lang={lang}
          onComplete={() => setShowVoteAnim(false)}
        />
      )}

      {/* Header */}
      <div style={{
        position: 'relative', zIndex: 250,
        borderBottom: '1px solid rgba(0,220,140,0.06)',
        padding: '14px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        gap: 12, backdropFilter: 'blur(12px)',
        background: 'rgba(0, 0, 0, 0.4)',
        flexWrap: 'wrap',
      }}>
        <button
          onClick={() => setStep('intro')}
          style={{
            display: 'flex', alignItems: 'center', gap: 12,
            background: 'transparent', border: 'none', cursor: 'pointer',
            padding: 0, color: 'inherit',
          }}
        >
          <div style={{
            width: 8, height: 8, borderRadius: '50%',
            background: '#00ff9d',
            boxShadow: '0 0 12px #00ff9d, 0 0 24px rgba(0,255,157,0.4)',
            animation: 'pulse 2s infinite',
          }} />
          <span style={{
            fontSize: 13, letterSpacing: '0.28em', color: '#fff',
            fontWeight: 600,
            fontFamily: "'JetBrains Mono','DM Mono',monospace",
          }}>HUMANITYVOTE</span>
        </button>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          {/* Navigation tabs — show different buttons depending on state */}
          {step !== 'intro' && (
            <button
              onClick={() => setStep('intro')}
              style={{
                padding: '7px 14px',
                border: '1px solid rgba(0,220,140,0.18)',
                background: 'transparent',
                color: 'rgba(0,220,140,0.75)',
                fontFamily: "'JetBrains Mono','DM Mono',monospace", fontSize: 11,
                letterSpacing: '0.04em', cursor: 'pointer',
                borderRadius: 2, transition: 'all 0.2s',
              }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = 'rgba(0,255,157,0.5)'; e.currentTarget.style.background = 'rgba(0,220,140,0.08)'; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = 'rgba(0,220,140,0.18)'; e.currentTarget.style.background = 'transparent'; }}
            >
              {t(lang, 'nav_home')}
            </button>
          )}

          {alreadyVoted && step !== 'results' && (
            <button
              onClick={() => setStep('results')}
              style={{
                padding: '7px 14px',
                border: '1px solid rgba(0,220,140,0.18)',
                background: 'transparent',
                color: 'rgba(0,220,140,0.75)',
                fontFamily: "'JetBrains Mono','DM Mono',monospace", fontSize: 11,
                letterSpacing: '0.04em', cursor: 'pointer',
                borderRadius: 2, transition: 'all 0.2s',
              }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = 'rgba(0,255,157,0.5)'; e.currentTarget.style.background = 'rgba(0,220,140,0.08)'; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = 'rgba(0,220,140,0.18)'; e.currentTarget.style.background = 'transparent'; }}
            >
              {t(lang, 'nav_results')}
            </button>
          )}

          {step !== 'about' && (
            <button
              onClick={() => setStep('about')}
              style={{
                padding: '7px 14px',
                border: '1px solid rgba(0,220,140,0.18)',
                background: 'transparent',
                color: 'rgba(0,220,140,0.75)',
                fontFamily: "'JetBrains Mono','DM Mono',monospace", fontSize: 11,
                letterSpacing: '0.04em', cursor: 'pointer',
                borderRadius: 2, transition: 'all 0.2s',
              }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = 'rgba(0,255,157,0.5)'; e.currentTarget.style.background = 'rgba(0,220,140,0.08)'; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = 'rgba(0,220,140,0.18)'; e.currentTarget.style.background = 'transparent'; }}
            >
              {t(lang, 'nav_about')}
            </button>
          )}

          <div className="header-vote-count" style={{
            fontSize: 11, color: 'rgba(0,220,140,0.5)',
            letterSpacing: '0.04em',
            display: 'flex', alignItems: 'center', gap: 6,
            paddingLeft: 4,
          }}>
            <AnimatedNumber value={totalVotes} />
            <span style={{ opacity: 0.6 }}>{totalVotes === 1 ? t(lang, 'vote_singular') : t(lang, 'votes_label')}</span>
          </div>

          <LanguageSwitcher currentLang={lang} onChange={changeLang} />
        </div>
      </div>

      <div style={{
        maxWidth: step === 'intro' ? 980 : (step === 'results' || step === 'about') ? 880 : 720,
        margin: '0 auto',
        padding: '0 24px',
        position: 'relative',
        zIndex: 10,
      }}>

        {step === 'intro' && (
          <div style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center',
            justifyContent: 'center', minHeight: 'calc(100vh - 70px)',
            textAlign: 'center', animation: 'fadeUp 1s ease', padding: '40px 0',
          }}>
            <div className="hero-stage" style={{
              animation: 'fadeUp 0.9s ease',
            }}>
              <ThreatOrbit questions={questions} />
              <div style={{
                position: 'relative',
                zIndex: 2,
                animation: 'float 6s ease-in-out 1.4s infinite',
              }}>
                <InteractiveGlobe
                  size={heroGlobeSize}
                  userRegion={alreadyVoted ? region : null}
                  regionVotes={regionVotes}
                  voteCount={totalVotes}
                />
              </div>
            </div>

            <div className="hero-signal-row" style={{ animation: 'fadeIn 0.9s ease' }}>
              <span>{t(lang, 'results_live')}</span>
              <strong><AnimatedNumber value={totalVotes} /> {totalVotes === 1 ? t(lang, 'vote_singular') : t(lang, 'votes_label')}</strong>
              <span>{t(lang, 'share_helper')}</span>
            </div>

            <div className="hero-copy">
              <div className="hero-title" style={{
                animation: 'fadeUp 0.9s ease',
              }}>
                <span style={{
                  '--title-gradient': 'linear-gradient(135deg, #ffffff 0%, #d0f0e0 100%)',
                }}>
                  {getIntroTitleLines(lang, 1, t(lang, 'intro_title_1')).map((line, i) => (
                    <span className="title-line" key={`${line}-${i}`}>{line}</span>
                  ))}
                </span>
                <span style={{
                  '--title-gradient': 'linear-gradient(135deg, #00ff9d 0%, #00dc8c 100%)',
                }}>
                  {getIntroTitleLines(lang, 2, t(lang, 'intro_title_2')).map((line, i) => (
                    <span className="title-line" key={`${line}-${i}`}>{line}</span>
                  ))}
                </span>
              </div>

              <p style={{
                fontSize: 15, color: 'rgba(220,255,235,0.6)',
                marginBottom: 10, lineHeight: 1.75,
                animation: 'fadeUp 0.9s ease',
                fontFamily: "'JetBrains Mono','DM Mono',monospace",
              }}>
                {t(lang, 'intro_subtitle_1')}<br />
                {t(lang, 'intro_subtitle_2')}
              </p>

              <p style={{
                fontSize: 16, color: '#00ff9d',
                marginBottom: 24, lineHeight: 1.5, fontWeight: 500,
                animation: 'fadeUp 0.9s ease',
                fontFamily: "'Syne','Inter',sans-serif",
                letterSpacing: 0,
              }}>
                {t(lang, 'intro_cta_text')}
              </p>

              <button
                onClick={() => setStep(alreadyVoted ? 'results' : 'vote')}
                className="cta"
                style={{ animation: 'fadeUp 0.9s ease', marginBottom: 30 }}
              >
                {alreadyVoted ? t(lang, 'intro_button_results') : t(lang, 'intro_button')}
              </button>

              <div className="trust-strip" style={{
                animation: 'fadeUp 0.9s ease',
              }}>
                <div className="trust-item">{t(lang, 'intro_principle_1')}</div>
                <div className="trust-item">{t(lang, 'intro_principle_2')}</div>
                <div className="trust-item">{t(lang, 'intro_principle_3')}</div>
              </div>

              <div style={{
                marginTop: 40, fontSize: 10, color: 'rgba(220,255,235,0.25)',
                letterSpacing: '0.06em', lineHeight: 1.9,
                animation: 'fadeIn 1s ease 1.5s both',
                fontFamily: "'JetBrains Mono','DM Mono',monospace",
              }}>
                {t(lang, 'intro_footer_1')}<br />
                {t(lang, 'intro_footer_2')}
              </div>
            </div>
          </div>
        )}

        {step === 'vote' && (
          <div style={{ padding: '64px 0', animation: 'fadeUp 0.6s ease' }}>
            <div style={{
              fontFamily: "'Syne','Inter',sans-serif", fontSize: 'clamp(24px,4.5vw,38px)',
              fontWeight: 800, marginBottom: 12,
              letterSpacing: 0,
              background: 'linear-gradient(135deg, #fff 0%, #d0f0e0 100%)',
              WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
              backgroundClip: 'text',
              lineHeight: 1.2,
            }}>
              {t(lang, 'vote_title_1')}<br />{t(lang, 'vote_title_2')}
            </div>
            <div style={{
              fontSize: 11, color: 'rgba(0,220,140,0.5)',
              letterSpacing: '0.15em', marginBottom: 6,
              fontFamily: "'JetBrains Mono','DM Mono',monospace",
            }}>
              {t(lang, 'vote_warning')}
            </div>
            <div style={{
              fontSize: 11, color: 'rgba(0,220,140,0.28)',
              letterSpacing: '0.06em', marginBottom: 36,
              fontFamily: "'JetBrains Mono','DM Mono',monospace",
            }}>
              {t(lang, 'vote_hint')}
            </div>

            <div style={{
              display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(150px,1fr))',
              gap: 10, marginBottom: 44,
            }}>
              {questions.map((q, i) => (
                <button
                  key={q.id}
                  className={`qb ${selected === q.id ? 'on' : ''}`}
                  onClick={() => setSelected(q.id)}
                  style={{
                    '--accent': THREAT_ACCENTS[q.id] || '#00ff9d',
                    '--accent-rgb': THREAT_ACCENT_RGB[q.id] || '0,255,157',
                    animation: `fadeUp 0.5s ease ${i * 0.04}s both`,
                  }}
                >
                  <span className="qb-index">{String(i + 1).padStart(2, '0')}</span>
                  <span className="qb-icon">{q.emoji}</span>
                  <span className="qb-label">{q.label}</span>
                </button>
              ))}
            </div>

            <div style={{
              fontSize: 11, color: 'rgba(0,220,140,0.5)',
              letterSpacing: '0.15em', marginBottom: 14,
              fontFamily: "'JetBrains Mono','DM Mono',monospace",
            }}>
              {t(lang, 'vote_region_label')}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 44 }}>
              {regions.map((r, i) => (
                <button
                  key={r.id}
                  className={`rb ${region === r.id ? 'on' : ''}`}
                  onClick={() => setRegion(r.id)}
                  style={{ animation: `fadeUp 0.5s ease ${0.3 + i * 0.04}s both` }}
                >
                  {r.flag} {r.label}
                </button>
              ))}
            </div>

            {secureVotingEnabled && (
              <div className="turnstile-panel">
                <div className="page-kicker">{t(lang, 'vote_verification_label')}</div>
                <TurnstileWidget
                  siteKey={TURNSTILE_SITE_KEY}
                  lang={lang}
                  resetSignal={turnstileResetSignal}
                  onVerify={(token) => {
                    setTurnstileToken(token);
                    setTurnstileStatus('ready');
                  }}
                  onExpire={() => {
                    setTurnstileToken('');
                    setTurnstileStatus('pending');
                  }}
                  onError={() => {
                    setTurnstileToken('');
                    setTurnstileStatus('error');
                  }}
                />
                <div
                  className="turnstile-status"
                  style={{
                    '--status-color':
                      turnstileStatus === 'ready'
                        ? '#00ff9d'
                        : turnstileStatus === 'error'
                          ? '#fb7185'
                          : '#38bdf8',
                  }}
                >
                  {turnstileStatus === 'ready'
                    ? t(lang, 'vote_verification_ready')
                    : turnstileStatus === 'error'
                      ? t(lang, 'vote_verification_error')
                      : t(lang, 'vote_verification_pending')}
                </div>
              </div>
            )}

            {error && (
              <div style={{
                padding: '14px 18px', marginBottom: 18,
                border: '1px solid rgba(255,100,100,0.3)',
                background: 'linear-gradient(135deg, rgba(255,100,100,0.08), rgba(255,100,100,0.02))',
                color: 'rgba(255,180,180,0.9)', fontSize: 12,
                animation: 'fadeUp 0.3s ease',
                borderRadius: 2,
              }}>
                {error}
              </div>
            )}

            <button
              className="cta"
              onClick={handleVote}
              disabled={!selected || !region || loading || (secureVotingEnabled && !turnstileToken)}
              style={{
                width: '100%', padding: '18px',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12,
              }}
            >
              {loading && (
                <span style={{
                  display: 'inline-block', width: 14, height: 14,
                  border: '2px solid currentColor', borderRightColor: 'transparent',
                  borderRadius: '50%', animation: 'spin 0.8s linear infinite',
                }} />
              )}
              {loading ? t(lang, 'vote_loading') : t(lang, 'vote_button')}
            </button>
          </div>
        )}

        {step === 'results' && (
          <div style={{ padding: '64px 0' }}>
            {alreadyVoted && (
              <div style={{
                padding: '14px 18px', marginBottom: 32,
                border: '1px solid rgba(0,255,157,0.25)',
                background: 'linear-gradient(135deg, rgba(0,255,157,0.06), rgba(0,255,157,0.01))',
                fontSize: 12, color: 'rgba(0,255,157,0.85)',
                lineHeight: 1.7, animation: 'fadeUp 0.5s ease',
                borderRadius: 2,
                fontFamily: "'JetBrains Mono','DM Mono',monospace",
              }}>
                {t(lang, 'results_already_voted')}
              </div>
            )}
            <ResultsView
              stats={stats}
              totalVotes={totalVotes}
              userRegion={region}
              userVote={selected}
              lang={lang}
            />
          </div>
        )}

        {step === 'about' && (
          <div style={{ padding: '64px 0', animation: 'fadeUp 0.6s ease' }}>
            <section className="about-hero">
              <div>
                <div className="page-kicker">{t(lang, 'nav_about')}</div>
                <h1 className="section-title">{t(lang, 'about_title')}</h1>
                <p style={{
                  fontSize: 'clamp(15px, 2vw, 18px)',
                  color: 'rgba(220,255,235,0.72)',
                  lineHeight: 1.75,
                  margin: 0,
                  fontFamily: "'Inter','JetBrains Mono',sans-serif",
                  maxWidth: 660,
                }}>
                  {t(lang, 'about_intro')}
                </p>
              </div>

              <div className="about-signal">
                {[t(lang, 'intro_principle_1'), t(lang, 'intro_principle_2'), t(lang, 'intro_principle_3')].map((item, i) => (
                  <div className="signal-item" key={item}>
                    <span>{item}</span>
                    <span
                      className="signal-dot"
                      style={{ '--accent': ['#00ff9d', '#38bdf8', '#fbbf24'][i] }}
                    />
                  </div>
                ))}
              </div>
            </section>

            <div className="about-flow">
              {[
                { n: '01', title: t(lang, 'about_section_1_title'), text: t(lang, 'about_section_1_text') },
                { n: '02', title: t(lang, 'about_section_2_title'), text: t(lang, 'about_section_2_text'), featured: true },
                { n: '03', title: t(lang, 'about_section_3_title'), text: t(lang, 'about_section_3_text') },
              ].map((section, i) => (
                <section
                  key={section.n}
                  className={'about-step ' + (section.featured ? 'featured' : '')}
                  style={{ animation: 'fadeUp 0.55s ease ' + (i * 0.08) + 's both' }}
                >
                  <div className="step-num">{section.n}</div>
                  <div>
                    <h2 style={{
                      fontFamily: "'Syne','Inter',sans-serif",
                      fontSize: 'clamp(20px,3vw,28px)',
                      lineHeight: 1.15,
                      margin: '0 0 12px',
                      letterSpacing: 0,
                      color: section.featured ? '#00ff9d' : '#fff',
                    }}>
                      {section.title}
                    </h2>
                    <p style={{
                      margin: 0,
                      fontSize: 14,
                      color: section.featured ? 'rgba(220,255,235,0.72)' : 'rgba(220,255,235,0.6)',
                      lineHeight: 1.85,
                      fontFamily: "'Inter','JetBrains Mono',sans-serif",
                    }}>
                      {section.text}
                    </p>
                  </div>
                </section>
              ))}
            </div>

            <div style={{ marginBottom: 18 }}>
              <div className="page-kicker">{t(lang, 'about_principle_title')}</div>
            </div>

            <div className="about-card-grid">
              {[1, 2, 3, 4, 5].map((n, i) => (
                <div
                  key={n}
                  className="principle-card"
                  style={{ animation: 'slideIn 0.45s ease ' + (i * 0.05) + 's both' }}
                >
                  <div className="principle-index">{String(n).padStart(2, '0')}</div>
                  <div style={{
                    color: 'rgba(220,255,235,0.76)',
                    fontSize: 13,
                    lineHeight: 1.65,
                    fontFamily: "'Inter','JetBrains Mono',sans-serif",
                  }}>
                    {t(lang, 'about_principle_' + n)}
                  </div>
                </div>
              ))}
            </div>

            <div className="quote-panel" style={{ animation: 'fadeUp 0.6s ease 0.2s both' }}>
              <div className="page-kicker" style={{ marginBottom: 18 }}>{t(lang, 'about_personal_title')}</div>
              <p style={{
                margin: 0,
                fontSize: 15,
                color: 'rgba(220,255,235,0.84)',
                lineHeight: 1.9,
                fontStyle: 'italic',
                fontFamily: "'Inter','JetBrains Mono',sans-serif",
                position: 'relative',
                zIndex: 1,
              }}>
                {t(lang, 'about_personal_text')}
              </p>
            </div>

            <div style={{ textAlign: 'center', animation: 'fadeUp 0.6s ease 0.35s both' }}>
              <button
                onClick={() => setStep(alreadyVoted ? 'results' : 'vote')}
                className="cta"
              >
                {alreadyVoted ? t(lang, 'intro_button_results') : t(lang, 'about_cta')}
              </button>
            </div>
          </div>
        )}

        {step === 'impressum' && (
          <div style={{ padding: '64px 0', animation: 'fadeUp 0.6s ease' }}>
            <div style={{
              fontFamily: "'Syne','Inter',sans-serif",
              fontSize: 'clamp(28px, 5vw, 46px)',
              fontWeight: 800, marginBottom: 8,
              letterSpacing: 0, lineHeight: 1.1,
              background: 'linear-gradient(135deg, #fff 30%, #00ff9d 100%)',
              WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
              backgroundClip: 'text',
            }}>
              {t(lang, 'imp_title')}
            </div>
            <div style={{
              fontSize: 12, color: 'rgba(0,220,140,0.55)',
              letterSpacing: '0.12em', marginBottom: 48,
              fontFamily: "'JetBrains Mono','DM Mono',monospace",
            }}>
              {t(lang, 'imp_subtitle')}
            </div>

            <div style={{
              padding: '24px 28px', marginBottom: 32,
              border: '1px solid rgba(0,220,140,0.12)',
              background: 'rgba(8,18,14,0.4)',
              backdropFilter: 'blur(4px)', borderRadius: 2,
            }}>
              <div style={{
                fontSize: 11, color: 'rgba(0,220,140,0.6)',
                letterSpacing: '0.15em', marginBottom: 14,
                fontFamily: "'JetBrains Mono','DM Mono',monospace",
              }}>
                {t(lang, 'imp_responsible')}
              </div>
              <div style={{ fontSize: 15, color: '#fff', marginBottom: 4, fontFamily: "'Inter',sans-serif", fontWeight: 500 }}>
                {t(lang, 'imp_name')}
              </div>
              <div style={{ fontSize: 13, color: 'rgba(220,255,235,0.7)', lineHeight: 1.7, fontFamily: "'Inter',sans-serif" }}>
                {t(lang, 'imp_address_line1')}<br />
                {t(lang, 'imp_address_line2')}<br />
                {t(lang, 'imp_address_line3')}
              </div>
            </div>

            <div style={{
              padding: '24px 28px', marginBottom: 40,
              border: '1px solid rgba(0,220,140,0.12)',
              background: 'rgba(8,18,14,0.4)',
              backdropFilter: 'blur(4px)', borderRadius: 2,
            }}>
              <div style={{
                fontSize: 11, color: 'rgba(0,220,140,0.6)',
                letterSpacing: '0.15em', marginBottom: 14,
                fontFamily: "'JetBrains Mono','DM Mono',monospace",
              }}>
                {t(lang, 'imp_contact')}
              </div>
              <div style={{ fontSize: 13, color: 'rgba(220,255,235,0.7)', fontFamily: "'JetBrains Mono','DM Mono',monospace" }}>
                {t(lang, 'imp_email_label')}: <a href={`mailto:${t(lang, 'imp_email')}`} style={{ color: '#00ff9d', textDecoration: 'none' }}>{t(lang, 'imp_email')}</a>
              </div>
            </div>

            {[
              { title: 'imp_responsibility_title', text: 'imp_responsibility_text' },
              { title: 'imp_links_title', text: 'imp_links_text' },
              { title: 'imp_copyright_title', text: 'imp_copyright_text' },
              { title: 'imp_dispute_title', text: 'imp_dispute_text' },
            ].map((s, i) => (
              <div key={i} style={{ marginBottom: 32 }}>
                <div style={{
                  fontFamily: "'Syne','Inter',sans-serif",
                  fontSize: 18, fontWeight: 700, color: '#fff',
                  marginBottom: 12, letterSpacing: 0,
                }}>
                  {t(lang, s.title)}
                </div>
                <p style={{
                  fontSize: 13, color: 'rgba(220,255,235,0.6)',
                  lineHeight: 1.85,
                  fontFamily: "'Inter',sans-serif",
                }}>
                  {t(lang, s.text)}
                </p>
              </div>
            ))}
          </div>
        )}

        {step === 'privacy' && (
          <div style={{ padding: '64px 0', animation: 'fadeUp 0.6s ease' }}>
            <div style={{
              fontFamily: "'Syne','Inter',sans-serif",
              fontSize: 'clamp(28px, 5vw, 46px)',
              fontWeight: 800, marginBottom: 8,
              letterSpacing: 0, lineHeight: 1.1,
              background: 'linear-gradient(135deg, #fff 30%, #00ff9d 100%)',
              WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
              backgroundClip: 'text',
            }}>
              {t(lang, 'priv_title')}
            </div>
            <div style={{
              fontSize: 12, color: 'rgba(0,220,140,0.55)',
              letterSpacing: '0.12em', marginBottom: 32,
              fontFamily: "'JetBrains Mono','DM Mono',monospace",
            }}>
              {t(lang, 'priv_subtitle')}
            </div>

            <p style={{
              fontSize: 15, color: 'rgba(220,255,235,0.75)',
              lineHeight: 1.8, marginBottom: 48,
              fontFamily: "'Inter',sans-serif",
              maxWidth: 620,
            }}>
              {t(lang, 'priv_intro')}
            </p>

            {/* Sections */}
            {[
              { title: 'priv_responsible_title', text: 'priv_responsible_text' },
            ].map((s, i) => (
              <div key={`s1-${i}`} style={{ marginBottom: 32 }}>
                <div style={{
                  fontFamily: "'Syne','Inter',sans-serif",
                  fontSize: 18, fontWeight: 700, color: '#fff',
                  marginBottom: 12, letterSpacing: 0,
                }}>
                  {t(lang, s.title)}
                </div>
                <p style={{
                  fontSize: 13, color: 'rgba(220,255,235,0.6)',
                  lineHeight: 1.85, fontFamily: "'Inter',sans-serif",
                }}>
                  {t(lang, s.text)}
                </p>
              </div>
            ))}

            {/* Collected data with list */}
            <div style={{ marginBottom: 32 }}>
              <div style={{
                fontFamily: "'Syne','Inter',sans-serif",
                fontSize: 18, fontWeight: 700, color: '#fff',
                marginBottom: 12, letterSpacing: 0,
              }}>
                {t(lang, 'priv_collected_title')}
              </div>
              <p style={{
                fontSize: 13, color: 'rgba(220,255,235,0.6)',
                lineHeight: 1.85, marginBottom: 16,
                fontFamily: "'Inter',sans-serif",
              }}>
                {t(lang, 'priv_collected_intro')}
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {[1, 2, 3, 4, 5].map(n => (
                  <div key={n} style={{
                    display: 'flex', gap: 12,
                    padding: '12px 14px',
                    border: '1px solid rgba(0,220,140,0.08)',
                    background: 'rgba(8,18,14,0.4)',
                    borderRadius: 2,
                  }}>
                    <span style={{
                      fontSize: 11, color: 'rgba(0,255,157,0.55)',
                      fontFamily: "'JetBrains Mono','DM Mono',monospace",
                      minWidth: 20,
                    }}>
                      {String(n).padStart(2, '0')}
                    </span>
                    <span style={{
                      fontSize: 13, color: 'rgba(220,255,235,0.7)',
                      fontFamily: "'Inter',sans-serif",
                    }}>
                      {t(lang, `priv_collected_${n}`)}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* What we don't collect */}
            <div style={{ marginBottom: 32 }}>
              <div style={{
                fontFamily: "'Syne','Inter',sans-serif",
                fontSize: 18, fontWeight: 700, color: '#fff',
                marginBottom: 16, letterSpacing: 0,
              }}>
                {t(lang, 'priv_no_collect_title')}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {[1, 2, 3, 4, 5].map(n => (
                  <div key={n} style={{
                    display: 'flex', gap: 12,
                    padding: '12px 14px',
                    border: '1px solid rgba(255,100,100,0.1)',
                    background: 'rgba(255,100,100,0.02)',
                    borderRadius: 2,
                  }}>
                    <span style={{
                      fontSize: 11, color: 'rgba(255,150,150,0.5)',
                      fontFamily: "'JetBrains Mono','DM Mono',monospace",
                      minWidth: 20,
                    }}>
                      ✕
                    </span>
                    <span style={{
                      fontSize: 13, color: 'rgba(220,255,235,0.7)',
                      fontFamily: "'Inter',sans-serif",
                    }}>
                      {t(lang, `priv_no_collect_${n}`)}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Other sections */}
            {[
              { title: 'priv_fingerprint_title', text: 'priv_fingerprint_text' },
              { title: 'priv_storage_title', text: 'priv_storage_text' },
              { title: 'priv_legal_basis_title', text: 'priv_legal_basis_text' },
              { title: 'priv_retention_title', text: 'priv_retention_text' },
            ].map((s, i) => (
              <div key={`s2-${i}`} style={{ marginBottom: 32 }}>
                <div style={{
                  fontFamily: "'Syne','Inter',sans-serif",
                  fontSize: 18, fontWeight: 700, color: '#fff',
                  marginBottom: 12, letterSpacing: 0,
                }}>
                  {t(lang, s.title)}
                </div>
                <p style={{
                  fontSize: 13, color: 'rgba(220,255,235,0.6)',
                  lineHeight: 1.85, fontFamily: "'Inter',sans-serif",
                }}>
                  {t(lang, s.text)}
                </p>
              </div>
            ))}

            {/* GDPR rights */}
            <div style={{ marginBottom: 32 }}>
              <div style={{
                fontFamily: "'Syne','Inter',sans-serif",
                fontSize: 18, fontWeight: 700, color: '#fff',
                marginBottom: 12, letterSpacing: 0,
              }}>
                {t(lang, 'priv_rights_title')}
              </div>
              <p style={{
                fontSize: 13, color: 'rgba(220,255,235,0.6)',
                lineHeight: 1.85, marginBottom: 16,
                fontFamily: "'Inter',sans-serif",
              }}>
                {t(lang, 'priv_rights_intro')}
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
                {[1, 2, 3, 4, 5].map(n => (
                  <div key={n} style={{
                    fontSize: 13, color: 'rgba(220,255,235,0.65)',
                    paddingLeft: 16, lineHeight: 1.7,
                    fontFamily: "'Inter',sans-serif",
                  }}>
                    · {t(lang, `priv_right_${n}`)}
                  </div>
                ))}
              </div>
              <p style={{
                fontSize: 13, color: 'rgba(220,255,235,0.6)',
                lineHeight: 1.85, fontFamily: "'Inter',sans-serif",
                fontStyle: 'italic',
              }}>
                {t(lang, 'priv_rights_contact')}
              </p>
            </div>

            {[
              { title: 'priv_open_data_title', text: 'priv_open_data_text' },
              { title: 'priv_changes_title', text: 'priv_changes_text' },
            ].map((s, i) => (
              <div key={`s3-${i}`} style={{ marginBottom: 32 }}>
                <div style={{
                  fontFamily: "'Syne','Inter',sans-serif",
                  fontSize: 18, fontWeight: 700, color: '#fff',
                  marginBottom: 12, letterSpacing: 0,
                }}>
                  {t(lang, s.title)}
                </div>
                <p style={{
                  fontSize: 13, color: 'rgba(220,255,235,0.6)',
                  lineHeight: 1.85, fontFamily: "'Inter',sans-serif",
                }}>
                  {t(lang, s.text)}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Footer */}
      <div style={{
        position: 'relative', zIndex: 10,
        marginTop: 60, padding: '32px 24px',
        borderTop: '1px solid rgba(0,220,140,0.06)',
        textAlign: 'center',
        fontFamily: "'JetBrains Mono','DM Mono',monospace",
      }}>
        <div style={{
          display: 'flex', justifyContent: 'center', gap: 24,
          flexWrap: 'wrap', marginBottom: 14,
        }}>
          <button
            onClick={() => setStep('impressum')}
            style={{
              background: 'transparent', border: 'none',
              color: 'rgba(0,220,140,0.6)', fontSize: 11,
              letterSpacing: '0.1em', cursor: 'pointer',
              fontFamily: "'JetBrains Mono','DM Mono',monospace",
              padding: 0, transition: 'color 0.2s',
            }}
            onMouseEnter={e => e.currentTarget.style.color = '#00ff9d'}
            onMouseLeave={e => e.currentTarget.style.color = 'rgba(0,220,140,0.6)'}
          >
            {t(lang, 'footer_impressum')}
          </button>
          <button
            onClick={() => setStep('privacy')}
            style={{
              background: 'transparent', border: 'none',
              color: 'rgba(0,220,140,0.6)', fontSize: 11,
              letterSpacing: '0.1em', cursor: 'pointer',
              fontFamily: "'JetBrains Mono','DM Mono',monospace",
              padding: 0, transition: 'color 0.2s',
            }}
            onMouseEnter={e => e.currentTarget.style.color = '#00ff9d'}
            onMouseLeave={e => e.currentTarget.style.color = 'rgba(0,220,140,0.6)'}
          >
            {t(lang, 'footer_privacy')}
          </button>
          <a
            href="https://github.com/blyumenshteindanil-max/humanityvote"
            target="_blank"
            rel="noopener noreferrer"
            style={{
              color: 'rgba(0,220,140,0.6)', fontSize: 11,
              letterSpacing: '0.1em', textDecoration: 'none',
              transition: 'color 0.2s',
            }}
            onMouseEnter={e => e.currentTarget.style.color = '#00ff9d'}
            onMouseLeave={e => e.currentTarget.style.color = 'rgba(0,220,140,0.6)'}
          >
            {t(lang, 'footer_open_source')}
          </a>
        </div>
        <div style={{
          fontSize: 10, color: 'rgba(220,255,235,0.25)',
          letterSpacing: '0.1em',
        }}>
          humanityvote.org · AGPL-3.0
        </div>
      </div>
    </div>
  );
}
