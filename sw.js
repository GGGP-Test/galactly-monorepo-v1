self.addEventListener('push', event => {
  const data = event.data ? event.data.json() : {};
  const title = data.title || 'New lead';
  event.waitUntil(
    self.registration.showNotification('Galactly', {
      body: `${title} — ${data.platform||''}`,
      icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><circle cx="32" cy="32" r="30" fill="black" stroke="white" stroke-width="2"/></svg>'
    })
  );
});
