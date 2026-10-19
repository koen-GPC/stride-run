// Bluetooth heart-rate strap (standard GATT Heart Rate service).
// Works in Chrome on Android/desktop. Safari on iPhone has no Web Bluetooth.
S.hr = (() => {
  let device = null, current = null, lastAt = 0;
  const listeners = new Set();

  const supported = () => !!navigator.bluetooth;

  function parse(dv) {
    const flags = dv.getUint8(0);
    return flags & 1 ? dv.getUint16(1, true) : dv.getUint8(1);
  }

  async function connect() {
    if (!supported()) throw new Error('Bluetooth wordt in deze browser niet ondersteund');
    device = await navigator.bluetooth.requestDevice({ filters: [{ services: ['heart_rate'] }] });
    device.addEventListener('gattserverdisconnected', onDisconnect);
    await subscribe();
    return device.name || 'Hartslagmeter';
  }

  async function subscribe() {
    const server = await device.gatt.connect();
    const svc = await server.getPrimaryService('heart_rate');
    const ch = await svc.getCharacteristic('heart_rate_measurement');
    ch.addEventListener('characteristicvaluechanged', (e) => {
      const v = parse(e.target.value);
      if (v > 25 && v < 250) { current = v; lastAt = Date.now(); listeners.forEach((f) => f(v)); }
    });
    await ch.startNotifications();
  }

  async function onDisconnect() {
    current = null; listeners.forEach((f) => f(null));
    // try to reconnect a few times (strap moved, brief dropout)
    for (let i = 0; i < 3 && device; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      try { await subscribe(); return; } catch {}
    }
  }

  function disconnect() {
    const d = device; device = null; current = null;
    if (d && d.gatt.connected) d.gatt.disconnect();
    listeners.forEach((f) => f(null));
  }

  function value() { return current && Date.now() - lastAt < 5000 ? current : null; }
  function connected() { return !!(device && device.gatt && device.gatt.connected); }
  function name() { return device ? device.name || 'Hartslagmeter' : null; }
  function on(f) { listeners.add(f); return () => listeners.delete(f); }

  return { supported, connect, disconnect, value, connected, name, on };
})();
