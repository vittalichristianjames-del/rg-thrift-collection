document.addEventListener('DOMContentLoaded', function() {
  console.log('RG Thrift Collection loaded');

  // Dismiss flash messages
  const dismissButtons = document.querySelectorAll('[data-dismiss-flash]');
  dismissButtons.forEach(btn => {
    btn.addEventListener('click', function() {
      const msg = this.closest('[data-flash-message]');
      if (msg) msg.style.display = 'none';
    });
  });

  // Image fallback for broken product images
  const images = document.querySelectorAll('img[data-fallback-src]');
  images.forEach(img => {
    img.addEventListener('error', function() {
      this.src = this.dataset.fallbackSrc;
    });
  });

  // Lazy load images with intersection observer
  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const img = entry.target;
          if (img.dataset.src) {
            img.src = img.dataset.src;
            observer.unobserve(img);
          }
        }
      });
    });
    document.querySelectorAll('img[data-src]').forEach(img => observer.observe(img));
  }
});