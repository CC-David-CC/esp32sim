export const preset = 'tdisplay-prices';
const format = 'esp32-firmware-lab/1';
export const extensions = ['.esp32lab.json', '.py'];
export const maxProgramBytes = 32 * 1024;
export const initialProgram = "from machine import Pin\n\nled = Pin(2, Pin.OUT)\nled.value(1)\nprint('GPIO 2:', led.value())\n";

export function fileType(name) {
  return extensions.find(ext => name.toLowerCase().endsWith(ext));
}

export function loadProgram(path, text) {
  if (fileType(path) === '.py') return text;
  const project = JSON.parse(text);
  if (project?.format !== format || project.firmware !== preset || typeof project.program !== 'string') {
    throw Error('Choose a T-Display Firmware Lab project or a Python file.');
  }
  return project.program;
}

export function saveProgram(path, program) {
  if (fileType(path) === '.py') return program;
  return JSON.stringify({format, firmware: preset, program}, null, 2) + '\n';
}
