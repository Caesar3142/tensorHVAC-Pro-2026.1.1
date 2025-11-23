// Global dark mode handler for all pages
(function() {
  'use strict';

  function initDarkMode() {
    // Check saved preference (may already be applied by inline script)
    const savedTheme = localStorage.getItem('app-theme') || 'light';
    applyTheme(savedTheme);
  }

  function applyTheme(theme) {
    // Temporarily disable transitions if they're enabled (for smooth manual toggle)
    const wasTransitionDisabled = document.documentElement.classList.contains('no-transition');
    if (!wasTransitionDisabled) {
      document.documentElement.classList.add('no-transition');
    }
    
    if (theme === 'dark') {
      document.documentElement.classList.add('dark-mode');
      document.body.classList.add('dark-mode');
    } else {
      document.documentElement.classList.remove('dark-mode');
      document.body.classList.remove('dark-mode');
    }
    localStorage.setItem('app-theme', theme);
    
    // Re-enable transitions after a brief delay for smooth animation
    if (!wasTransitionDisabled) {
      requestAnimationFrame(function() {
        requestAnimationFrame(function() {
          document.documentElement.classList.remove('no-transition');
        });
      });
    }
  }

  function toggleDarkMode() {
    const isDark = document.body.classList.contains('dark-mode');
    applyTheme(isDark ? 'light' : 'dark');
  }

  // Initialize on page load
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initDarkMode);
  } else {
    initDarkMode();
  }

  // Listen for menu toggle (if window.api is available)
  if (typeof window !== 'undefined' && window.api && window.api.onToggleDarkMode) {
    window.api.onToggleDarkMode(() => {
      toggleDarkMode();
    });
  }

  // Expose toggle function globally for manual use
  window.toggleDarkMode = toggleDarkMode;
})();

