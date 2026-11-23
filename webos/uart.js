// Loaded after the upstream run script. Use the same console transport as its UART tab.
(() => {
  const lab = window.frameElement?.esp32Lab;
  if (!lab) return;
  let pending;

  function finish(error) {
    if (!pending) return;
    const job = pending;
    pending = null;
    clearTimeout(job.timer);
    if (error) job.reject(error);
    else job.resolve();
  }

  function timeout() {
    return setTimeout(() => finish(Error('MicroPython did not return a UART0 prompt.')), 20000);
  }

  window.addEventListener('esp32lab-uart', () => {
    if (!pending || addSerial.buf.uart0 !== '>>> ') return;
    clearTimeout(pending.timer);
    const line = pending.commands[pending.next++];
    send({t: 'serial', src: 'uart0', line});
    if (pending.next === pending.commands.length) finish();
    else pending.timer = timeout();
  });
  window.addEventListener('pagehide', () => finish(Error('The emulator restarted.')), {once: true});

  lab.connect(source => {
    if (pending) throw Error('Wait for the console to respond.');
    if (boardName !== 'ttgo-tdisplay' || $('#status').textContent !== 'running in WebAssembly') {
      throw Error('Wait for the T-Display to boot before running Python.');
    }
    const bytes = new TextEncoder().encode(source);
    const commands = ['import ubinascii as _webos_b64; _webos_program = bytearray()'];
    for (let offset = 0; offset < bytes.length; offset += 96) {
      const part = btoa(String.fromCharCode(...bytes.subarray(offset, offset + 96)));
      commands.push("_webos_program.extend(_webos_b64.a2b_base64('" + part + "'))");
    }
    commands.push('exec(_webos_program.decode())');
    document.querySelector('.chiptab[data-src="uart0"]').click();
    return new Promise((resolve, reject) => {
      pending = {timer: timeout(), commands, next: 0, resolve, reject};
      send({t: 'key', src: 'uart0', data: '\x03'});
    });
  });
})();
