// Global dark mode handler for all pages
(function() {
  'use strict';

  function initDarkMode() {
    // Check saved preference
    const savedTheme = localStorage.getItem('app-theme') || 'light';
    applyTheme(savedTheme);
  }

  function applyTheme(theme) {
    if (theme === 'dark') {
      document.body.classList.add('dark-mode');
    } else {
      document.body.classList.remove('dark-mode');
    }
    localStorage.setItem('app-theme', theme);
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

