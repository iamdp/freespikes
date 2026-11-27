document.addEventListener('DOMContentLoaded', () => {
  // Form success handling via AJAX to /api/submit
  const forms = document.querySelectorAll('form');
  forms.forEach(form => {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const formData = new FormData(form);
      const successEl = form.querySelector('.form-success');
      try {
        const res = await fetch(form.action, {
          method: 'POST',
          body: formData,
          headers: { 'Accept': 'application/json' }
        });
        if (res.ok) {
          form.reset();
          if (successEl) successEl.style.display = 'block';
        } else {
          alert('Something went wrong. Please try again.');
        }
      } catch (err) {
        alert('Something went wrong. Please try again.');
      }
    });
  });
});
