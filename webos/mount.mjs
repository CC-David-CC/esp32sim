import './workspace.css';
import {extensions, fileType, initialProgram, loadProgram, maxProgramBytes, preset, saveProgram} from './project.mjs';

const sha256 = /^[0-9a-f]{64}$/;
const basename = path => path.split('/').at(-1);

function validName(value) {
  if (!value || value === '.' || value === '..' || /[\\/:\u0000-\u001f]/.test(value)) throw Error('Enter a valid file name.');
  return value;
}

function filesPath(value, folder = false) {
  const path = value.replace(/^(?:(?:webos|browser):)?\//, '');
  if (folder && !path) return path;
  path.split('/').forEach(validName);
  if (path === '.app' || path.startsWith('.app/')) throw Error('Choose a folder outside app settings.');
  if (!folder && !fileType(path)) throw Error('Choose an ESP32 Firmware Lab project or a Python file.');
  return path;
}

export function mount(host) {
  const {make, textButton} = host.ui;
  const owner = host.storage.workspaceOwner();
  const session = host.session();
  const lifetime = new AbortController();
  const signal = AbortSignal.any([lifetime.signal, host.signal]);
  const section = make('section', 'window-content esp32-firmware-lab');
  const panel = make('div', 'esp32-program');
  const toolbar = make('div', 'esp32-program-actions');
  const note = make('p', 'esp32-program-status', 'Starting the T-Display…');
  note.setAttribute('role', 'status');
  const source = document.createElement('textarea');
  source.setAttribute('aria-label', 'MicroPython program');
  source.spellcheck = false;
  source.value = initialProgram;
  const frame = document.createElement('iframe');
  frame.title = 'ESP32 T-Display emulator';
  const legal = document.createElement('a');
  legal.textContent = 'Source and licenses';
  legal.href = new URL('./legal/NOTICES.txt', import.meta.url).href;
  legal.target = '_blank';
  legal.rel = 'noopener';
  let context, binding, releaseWriter, runPython;
  let clean = source.value, busy = false, transferring = false, running = false;

  const tell = message => { if (!signal.aborted) note.textContent = message; };
  const dirty = () => source.value !== clean;
  const valid = () => !signal.aborted && host.session() === session && host.storage.workspaceOwner() === owner && context?.valid();
  function workspace() {
    if (!valid()) throw new DOMException('This Files workspace ended.', 'AbortError');
    if (transferring) throw Error('Files are being transferred.');
    return context.files;
  }

  function bind(file) {
    workspace();
    if (!binding && !file) return;
    host.desktop.updateAccountFileBinding(host.w, {owner, path: file?.path ?? null, sha256: file?.sha256 ?? null});
    binding = file;
  }

  async function confirmDiscard() {
    if (!dirty()) return true;
    workspace();
    const captured = source.value;
    const allowed = await host.ui.confirm('Discard unsaved changes to the MicroPython program?', {
      title: 'Unsaved changes', confirmLabel: 'Discard changes', cancelLabel: 'Keep editing', danger: true, signal,
    });
    return allowed && valid() && source.value === captured;
  }

  function fileOperation(action) {
    return async () => {
      if (busy) return;
      busy = true;
      try {
        workspace();
        await action();
      } catch (error) {
        if (error.name !== 'AbortError') tell(error.message);
      } finally {
        busy = false;
      }
    };
  }

  async function open(path, expected) {
    const {data, sha256: revision} = await workspace().read(path, {signal});
    workspace();
    if (!sha256.test(revision) || expected && revision !== expected) throw Error('Open the current revision from Files.');
    if (data.byteLength > maxProgramBytes * 7) throw Error('The program exceeds 32 KiB.');
    const program = loadProgram(path, new TextDecoder('utf-8', {fatal: true}).decode(data));
    if (new TextEncoder().encode(program).length > maxProgramBytes) throw Error('The program exceeds 32 KiB.');
    if (!await confirmDiscard()) return;
    bind({path, sha256: revision});
    source.value = program;
    clean = source.value;
    tell('Opened ' + basename(path) + ' from Files.');
  }

  const chooseFile = fileOperation(async () => {
    const selected = await host.storage.pickWorkspaceFile({extensions, signal});
    if (selected != null) await open(filesPath(selected));
  });

  function save(copy) {
    return fileOperation(async () => {
      const program = source.value;
      if (new TextEncoder().encode(program).length > maxProgramBytes) throw Error('The program exceeds 32 KiB.');
      let path = copy ? null : binding?.path;
      const revision = path ? binding.sha256 : null;
      if (!path) {
        const folder = await host.storage.pickWorkspaceFile({foldersOnly: true, signal});
        if (folder == null) return;
        const selected = await host.ui.prompt('Project name (.esp32lab.json) or Python file name (.py)', {
          title: 'Save ESP32 program', value: 'T-Display.esp32lab.json', confirmLabel: 'Save', signal,
        });
        if (selected == null) return;
        let name = validName(selected.trim());
        if (!fileType(name)) {
          if (name.includes('.')) throw Error('Use an .esp32lab.json or .py filename.');
          name += '.esp32lab.json';
        }
        const parent = filesPath(folder, true);
        path = filesPath(parent ? parent + '/' + name : name);
      }
      try {
        const result = await workspace().write(path, new TextEncoder().encode(saveProgram(path, program)), revision, {signal});
        if (!sha256.test(result.sha256)) throw Error('Files did not confirm the save.');
        bind({path, sha256: result.sha256});
        clean = program;
        tell(dirty() ? 'Saved ' + basename(path) + '. Newer edits are still unsaved.' : 'Saved ' + basename(path) + ' in Files.');
      } catch (error) {
        if (error.status !== 409) throw error;
        throw Error(revision ? 'This file changed in Files. Use Save As to keep both versions.' :
          'A file already has that name. Choose another name.');
      }
    });
  }

  frame.esp32Lab = {
    connect(callback) { runPython = callback; }
  };
  const run = async () => {
    if (running || !valid() || transferring) return;
    if (!runPython) {
      tell('Wait for the T-Display to start.');
      return;
    }
    const program = source.value;
    if (!program.trim() || new TextEncoder().encode(program).length > maxProgramBytes) {
      tell('Enter a MicroPython program up to 32 KiB.');
      return;
    }
    running = true;
    tell('Waiting for the MicroPython UART0 prompt…');
    try {
      await runPython(program);
      tell('Program sent to UART0.');
    } catch (error) {
      tell(error.message);
    } finally {
      running = false;
    }
  };
  const newProgram = fileOperation(async () => {
    if (!await confirmDiscard()) return;
    bind(null);
    source.value = '';
    clean = '';
    tell('New MicroPython program.');
  });

  function showConsole() {
    const simulator = frame.contentDocument;
    const console = simulator?.querySelector('#console');
    if (!console) {
      tell('Wait for the T-Display to start.');
      return;
    }
    simulator.querySelector('.chiptab[data-src="uart0"]')?.click();
    console.scrollIntoView({block: 'end'});
    console.scrollTop = console.scrollHeight;
  }

  toolbar.append(textButton('New', newProgram), textButton('Open', chooseFile), textButton('Save', save(false)),
    textButton('Save As', save(true)), textButton('Run Python', run), textButton('UART console', showConsole));
  panel.append(toolbar, source, note, legal);
  section.append(panel, frame);
  const ready = (async () => {
    context = await host.storage.workspaceFileContext();
    if (context.owner !== owner) throw Error('The ESP32 editor belongs to another Files workspace.');
    workspace();
    const launch = host.w.launchContext;
    frame.src = new URL('./native/run.html?wasm&fw=' + preset, import.meta.url).href;
    releaseWriter = context.registerFileWriter?.(async () => {
      if (dirty() || busy || running) throw Error('Finish the ESP32 program before transferring Files.');
      transferring = true;
      section.inert = true;
      return () => { section.inert = false; transferring = false; };
    });
    if (launch) {
      if (launch.storage !== 'account' || launch.owner !== owner) throw Error('Open the program from My files.');
      await open(filesPath(launch.path), launch.restore ? undefined : launch.sha256);
    } else {
      tell('Run the current program on the T-Display or open a file.');
    }
  })();
  ready.catch(error => tell(error.message));
  window.addEventListener('beforeunload', event => {
    if (!dirty() && !busy) return;
    event.preventDefault();
    event.returnValue = '';
  }, {signal});
  return {
    element: section,
    ready,
    focus: () => source.focus(),
    async requestClose() {
      if (busy || transferring) {
        tell('Finish the file operation before closing ESP32 Firmware Lab.');
        return false;
      }
      return confirmDiscard();
    },
    dispose() {
      lifetime.abort();
      releaseWriter?.();
    },
  };
}
