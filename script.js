// ===================== LiSync — Interacciones =====================

document.getElementById('year').textContent = new Date().getFullYear();

// --- Always open at the very top, never at a #section ---
if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
if (location.hash) history.replaceState(null, '', location.pathname + location.search);
const goToVeryTop = () => window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
goToVeryTop();
window.addEventListener('load', goToVeryTop);
window.addEventListener('pageshow', (e) => { if (e.persisted) goToVeryTop(); });

// In-page links scroll smoothly without writing #hash into the URL
document.addEventListener('click', (e) => {
  const link = e.target.closest('a[href^="#"]');
  if (!link) return;
  const id = link.getAttribute('href');
  e.preventDefault();
  if (id === '#' || id === '#top') {
    window.scrollTo({ top: 0, behavior: 'smooth' });
    return;
  }
  const target = document.querySelector(id);
  if (!target) return;
  target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  // Skip link: move keyboard focus into the content, not just the viewport
  if (link.classList.contains('skip-link')) target.focus({ preventScroll: true });
});

// --- Hero video: force muted autoplay, retry if the browser blocked it ---
const heroVideo = document.querySelector('.video-intro-video');
const videoToggle = document.getElementById('videoToggle');
if (heroVideo) {
  heroVideo.muted = true;
  heroVideo.defaultMuted = true;

  // Autoplay is skipped for users who ask the OS for reduced motion, and the
  // toggle lets anyone stop the loop (WCAG 2.2.2 Pause, Stop, Hide).
  let userPaused = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let heroOnScreen = true;

  const syncToggle = () => {
    if (!videoToggle) return;
    videoToggle.setAttribute('aria-pressed', String(userPaused));
    videoToggle.setAttribute('aria-label', userPaused ? 'Reproducir video de fondo' : 'Pausar video de fondo');
  };
  const tryPlay = () => {
    if (userPaused || !heroOnScreen) return;
    const attempt = heroVideo.play();
    if (attempt) attempt.catch(() => {});
  };
  syncToggle();
  if (videoToggle) {
    videoToggle.addEventListener('click', (e) => {
      e.stopPropagation();
      userPaused = !userPaused;
      syncToggle();
      if (userPaused) heroVideo.pause(); else tryPlay();
    });
  }

  // Don't spend CPU/battery decoding the video while it's scrolled out of view
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(([entry]) => {
      heroOnScreen = entry.isIntersecting;
      if (heroOnScreen) tryPlay(); else heroVideo.pause();
    }).observe(heroVideo);
  }

  // Phones held upright get the vertical cut; everything else the horizontal one.
  // src is set here (not in the HTML) so only the right file is ever downloaded.
  const portraitPhoneMq = window.matchMedia('(max-width: 900px) and (orientation: portrait)');
  const pickVideoSource = () => {
    const src = portraitPhoneMq.matches ? heroVideo.dataset.srcMobile : heroVideo.dataset.srcDesktop;
    if (heroVideo.getAttribute('src') === src) return;
    heroVideo.src = src;
    tryPlay();
  };
  pickVideoSource();
  portraitPhoneMq.addEventListener('change', pickVideoSource);

  tryPlay();
  heroVideo.addEventListener('canplay', tryPlay, { once: true });

  // iOS Low Power Mode blocks all autoplay; it only allows play() inside a real
  // user gesture (touchend/click), so keep retrying on those until it's playing.
  const gestureEvents = ['touchend', 'click', 'pointerup', 'keydown', 'touchstart', 'scroll'];
  const onGesture = () => {
    if (!heroVideo.paused) return;
    tryPlay();
  };
  const stopListening = () => gestureEvents.forEach(evt => window.removeEventListener(evt, onGesture));
  gestureEvents.forEach(evt => window.addEventListener(evt, onGesture, { passive: true }));
  heroVideo.addEventListener('playing', stopListening, { once: true });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && heroVideo.paused) tryPlay();
  });
}

// --- Header shrink on scroll ---
const header = document.getElementById('siteHeader');
const onScroll = () => {
  header.classList.toggle('scrolled', window.scrollY > 20);
};
// First read waits a frame so it doesn't force a synchronous layout during load
requestAnimationFrame(onScroll);
window.addEventListener('scroll', onScroll, { passive: true });

// --- Mobile menu ---
const menuToggle = document.getElementById('menuToggle');
const navMobile = document.getElementById('navMobile');
const setMenu = (isOpen) => {
  navMobile.classList.toggle('open', isOpen);
  menuToggle.classList.toggle('open', isOpen);
  menuToggle.setAttribute('aria-expanded', String(isOpen));
  menuToggle.setAttribute('aria-label', isOpen ? 'Cerrar menú' : 'Abrir menú');
  document.body.classList.toggle('menu-open', isOpen);
};
menuToggle.addEventListener('click', () => setMenu(!navMobile.classList.contains('open')));
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && navMobile.classList.contains('open')) {
    setMenu(false);
    menuToggle.focus();
  }
});
navMobile.querySelectorAll('a').forEach(link => {
  link.addEventListener('click', () => setMenu(false));
});

// --- Cursor glow (desktop only) ---
const cursorGlow = document.getElementById('cursorGlow');
if (window.matchMedia('(min-width: 901px)').matches) {
  window.addEventListener('mousemove', (e) => {
    cursorGlow.style.transform = `translate(${e.clientX}px, ${e.clientY}px) translate(-50%, -50%)`;
  }, { passive: true });
}

// --- 3D tilt on hover (service cards + NFC review card) ---
const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const isDesktop = window.matchMedia('(min-width: 901px)').matches;

function attachTilt(el, { max = 10, scale = 1.02, glare = false } = {}) {
  let frame = null;

  const onMove = (e) => {
    const rect = el.getBoundingClientRect();
    const px = (e.clientX - rect.left) / rect.width;
    const py = (e.clientY - rect.top) / rect.height;
    const rx = (0.5 - py) * max;
    const ry = (px - 0.5) * max;

    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      el.style.transform = `perspective(900px) rotateX(${rx.toFixed(2)}deg) rotateY(${ry.toFixed(2)}deg) scale(${scale})`;
      if (glare) {
        el.style.setProperty('--glare-x', `${px * 100}%`);
        el.style.setProperty('--glare-y', `${py * 100}%`);
      }
    });
  };

  const onLeave = () => {
    cancelAnimationFrame(frame);
    el.style.transform = '';
  };

  el.addEventListener('mousemove', onMove);
  el.addEventListener('mouseleave', onLeave);
}

if (isDesktop && !prefersReducedMotion) {
  document.querySelectorAll('.service-card').forEach(card => {
    attachTilt(card, { max: 9, scale: 1.03, glare: true });
  });

  const aiStand = document.querySelector('.ai-stand');
  if (aiStand) attachTilt(aiStand, { max: 16, scale: 1.05 });

  // Hero 3D stage follows the cursor slightly for a parallax feel
  const hero3d = document.getElementById('hero3d');
  if (hero3d) {
    window.addEventListener('mousemove', (e) => {
      const rx = (0.5 - e.clientY / window.innerHeight) * 10;
      const ry = (e.clientX / window.innerWidth - 0.5) * 14;
      hero3d.style.setProperty('--mx', `${ry}deg`);
      hero3d.style.setProperty('--my', `${rx}deg`);
      hero3d.style.transform = `rotateY(${ry}deg) rotateX(${rx}deg)`;
    }, { passive: true });
  }
}

// --- Touch devices: 3D elements rotate as they travel through the viewport ---
if (!isDesktop && !prefersReducedMotion) {
  const scrollTilted = [
    { el: document.getElementById('hero3d'), rx: 18, ry: -24 },
    { el: document.querySelector('.ai-stand'), rx: 14, ry: 10 },
  ].filter(item => item.el);

  let ticking = false;
  const updateScrollTilt = () => {
    ticking = false;
    const vh = window.innerHeight;
    scrollTilted.forEach(({ el, rx, ry }) => {
      const r = el.getBoundingClientRect();
      if (r.bottom < -100 || r.top > vh + 100) return;
      const p = Math.max(-1, Math.min(1, (r.top + r.height / 2 - vh / 2) / vh));
      el.style.transform = `perspective(900px) rotateX(${(p * rx).toFixed(2)}deg) rotateY(${(p * ry).toFixed(2)}deg)`;
    });
  };
  // No initial pass: both elements start below the video hero, and the first
  // scroll sets them before they're visible — avoids a layout pass during load.
  window.addEventListener('scroll', () => {
    if (!ticking) { ticking = true; requestAnimationFrame(updateScrollTilt); }
  }, { passive: true });
}

// --- AI section: looping demo conversation (runs only while on screen) ---
const aiChat = document.getElementById('aiChat');
if (aiChat && !prefersReducedMotion && 'IntersectionObserver' in window) {
  const conversation = [
    ['¿Tenéis disponibilidad para hoy?', 'Sí, tengo un hueco a las 19:00. ¿Te lo reservo?'],
    ['¿Hacéis envíos a domicilio?', 'Sí, llega en 24–48h. ¿Te paso el catálogo?'],
    ['¿A qué hora abrís mañana?', 'Abrimos a las 9:00. ¿Quieres que te guarde cita?'],
  ];
  const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));
  const showBubble = async (className, text) => {
    const bubble = document.createElement('div');
    bubble.className = `chat-bubble ${className}`;
    if (text) {
      bubble.textContent = text;
    } else {
      for (let i = 0; i < 3; i++) bubble.appendChild(document.createElement('span'));
    }
    aiChat.appendChild(bubble);
    await wait(40);
    bubble.classList.add('is-shown');
    return bubble;
  };

  let onScreen = false;
  let running = false;
  let turn = 1; // turn 0 is already rendered in the HTML

  const play = async () => {
    running = true;
    while (onScreen) {
      await wait(2600);
      if (!onScreen) break;
      // New messages push older ones up and out of the (clipped) chat area,
      // like a real chat — it never goes blank between exchanges.
      while (aiChat.children.length > 4) aiChat.firstElementChild.remove();

      const [question, answer] = conversation[turn % conversation.length];
      turn++;
      await showBubble('chat-user', question);
      await wait(700);
      const typing = await showBubble('chat-ai chat-typing-bubble');
      await wait(1400);
      typing.remove();
      await showBubble('chat-ai', answer);
    }
    running = false;
  };

  new IntersectionObserver(([entry]) => {
    onScreen = entry.isIntersecting;
    if (onScreen && !running) play();
  }, { threshold: 0.3 }).observe(aiChat);
}

// --- Services: swipeable 3D coverflow carousel on small screens ---
const servicesGrid = document.querySelector('.services-grid');
const serviceCards = servicesGrid ? [...servicesGrid.querySelectorAll('.service-card')] : [];
const serviceDots = [...document.querySelectorAll('#servicesDots span')];
const carouselMq = window.matchMedia('(max-width: 900px)');

function updateCoverflow() {
  if (!carouselMq.matches) {
    serviceCards.forEach(card => {
      card.style.removeProperty('--cf-ry');
      card.style.removeProperty('--cf-s');
    });
    return;
  }
  const gridRect = servicesGrid.getBoundingClientRect();
  const center = gridRect.left + gridRect.width / 2;
  let closest = 0;
  let closestDist = Infinity;

  serviceCards.forEach((card, i) => {
    const r = card.getBoundingClientRect();
    const offset = (r.left + r.width / 2 - center) / r.width;
    const clamped = Math.max(-1, Math.min(1, offset));
    card.style.setProperty('--cf-ry', `${(clamped * 26).toFixed(2)}deg`);
    card.style.setProperty('--cf-s', (1 - Math.abs(clamped) * 0.06).toFixed(3));
    if (Math.abs(offset) < closestDist) { closestDist = Math.abs(offset); closest = i; }
  });
  serviceDots.forEach((dot, i) => dot.classList.toggle('active', i === closest));
}

if (servicesGrid) {
  let cfTicking = false;
  servicesGrid.addEventListener('scroll', () => {
    if (!cfTicking) {
      cfTicking = true;
      requestAnimationFrame(() => { cfTicking = false; updateCoverflow(); });
    }
  }, { passive: true });
  window.addEventListener('resize', updateCoverflow);
  // Lay out the coverflow only once the carousel approaches the viewport
  if ('IntersectionObserver' in window) {
    const cfObserver = new IntersectionObserver((entries) => {
      if (entries.some(e => e.isIntersecting)) {
        updateCoverflow();
        cfObserver.disconnect();
      }
    }, { rootMargin: '300px 0px' });
    cfObserver.observe(servicesGrid);
  } else {
    requestAnimationFrame(updateCoverflow);
  }
}

// --- Scroll reveal ---
const revealEls = document.querySelectorAll('.reveal');
if ('IntersectionObserver' in window) {
  const io = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('in-view');
        io.unobserve(entry.target);
      }
    });
  }, { threshold: 0.15, rootMargin: '0px 0px -60px 0px' });
  revealEls.forEach(el => io.observe(el));
} else {
  revealEls.forEach(el => el.classList.add('in-view'));
}

// --- Contact form (AJAX via FormSubmit, no page reload) ---
const form = document.getElementById('contactForm');
const submitBtn = document.getElementById('submitBtn');
const submitLabel = document.getElementById('submitLabel');
const formStatus = document.getElementById('formStatus');

form.addEventListener('submit', async (e) => {
  e.preventDefault();

  formStatus.textContent = '';
  formStatus.className = 'form-status';
  submitBtn.disabled = true;
  submitLabel.textContent = 'Enviando...';

  const data = new FormData(form);

  try {
    const response = await fetch(form.action.replace('formsubmit.co/', 'formsubmit.co/ajax/'), {
      method: 'POST',
      body: data,
      headers: { 'Accept': 'application/json' }
    });

    if (response.ok) {
      formStatus.textContent = '¡Mensaje enviado! Te responderemos muy pronto 🚀';
      formStatus.classList.add('success');
      form.reset();
    } else {
      throw new Error('Respuesta no válida del servidor');
    }
  } catch (err) {
    formStatus.textContent = 'No se pudo enviar. Escríbenos directo a lisyncbussines@gmail.com o por WhatsApp.';
    formStatus.classList.add('error');
  } finally {
    submitBtn.disabled = false;
    submitLabel.textContent = 'Enviar mensaje';
  }
});
