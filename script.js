// ===================== LiSync — Interacciones =====================

document.getElementById('year').textContent = new Date().getFullYear();

// --- Header shrink on scroll ---
const header = document.getElementById('siteHeader');
const onScroll = () => {
  header.classList.toggle('scrolled', window.scrollY > 20);
};
onScroll();
window.addEventListener('scroll', onScroll, { passive: true });

// --- Mobile menu ---
const menuToggle = document.getElementById('menuToggle');
const navMobile = document.getElementById('navMobile');
menuToggle.addEventListener('click', () => {
  const isOpen = navMobile.classList.toggle('open');
  menuToggle.classList.toggle('open', isOpen);
  menuToggle.setAttribute('aria-expanded', String(isOpen));
});
navMobile.querySelectorAll('a').forEach(link => {
  link.addEventListener('click', () => {
    navMobile.classList.remove('open');
    menuToggle.classList.remove('open');
    menuToggle.setAttribute('aria-expanded', 'false');
  });
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
