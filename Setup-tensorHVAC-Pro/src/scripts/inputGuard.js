// Global input guard to ensure inputs remain editable across all pages
(function() {
  'use strict';

  function ensureAllInputsEditable() {
    try {
      // Get all input, textarea, and select elements
      const allInputs = document.querySelectorAll('input, textarea, select');
      
      allInputs.forEach(el => {
        // Skip if element should be disabled (e.g., stop button when not running)
        if (el.id === 'stopRun' || el.hasAttribute('data-keep-disabled')) {
          return;
        }
        
        try {
          // Remove disabled/readonly attributes
          if (el.removeAttribute) {
            el.removeAttribute('disabled');
            el.removeAttribute('readonly');
            el.removeAttribute('aria-disabled');
          }
          
          // Ensure properties are set correctly
          el.disabled = false;
          el.readOnly = false;
          
          // Ensure pointer events are enabled
          if (el.style) {
            el.style.pointerEvents = 'auto';
            el.style.userSelect = 'auto';
          }
          
          // Ensure tab index is set
          el.tabIndex = el.tabIndex < 0 ? 0 : el.tabIndex;
        } catch (e) {
          // Silently continue if element is not accessible
        }
      });
      
      // Also ensure content area is interactive
      const content = document.querySelector('.content');
      if (content && content.style) {
        content.style.pointerEvents = 'auto';
      }
    } catch (e) {
      console.warn('[inputGuard] Error ensuring inputs editable:', e);
    }
  }

  // Set up MutationObserver to watch for disabled/readonly changes
  function setupInputGuard() {
    try {
      const content = document.querySelector('.content') || document.body;
      
      const obs = new MutationObserver(mutations => {
        let needsFix = false;
        for (const mutation of mutations) {
          if (mutation.type === 'attributes') {
            const attr = mutation.attributeName;
            if (attr === 'disabled' || attr === 'readonly' || attr === 'style' || attr === 'class') {
              needsFix = true;
              break;
            }
          }
        }
        
        if (needsFix) {
          clearTimeout(obs._debounce);
          obs._debounce = setTimeout(ensureAllInputsEditable, 50);
        }
      });
      
      obs.observe(content, {
        attributes: true,
        subtree: true,
        attributeFilter: ['disabled', 'readonly', 'style', 'class']
      });
      
      // Periodic check every 3 seconds as backup
      setInterval(ensureAllInputsEditable, 3000);
      
      // Initial check
      ensureAllInputsEditable();
      
      // Also check after a short delay to catch any late-disabling
      setTimeout(ensureAllInputsEditable, 500);
      setTimeout(ensureAllInputsEditable, 2000);
      
    } catch (e) {
      console.warn('[inputGuard] Failed to setup guard:', e);
    }
  }

  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setupInputGuard);
  } else {
    setupInputGuard();
  }

  // Expose function globally for manual calls
  window.ensureAllInputsEditable = ensureAllInputsEditable;
})();

