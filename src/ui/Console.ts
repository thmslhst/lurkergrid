import type { AppEvent } from '../events';

const NOTE_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
const MAX_LOG = 18;

function noteName(note: number): string {
  const oct = Math.floor(note / 12) - 1;
  return `${NOTE_NAMES[note % 12]}${oct}`;
}

function fmt2(n: number): string { return n.toString().padStart(2, '0'); }

function fmtTime(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${fmt2(Math.floor(s / 3600))}:${fmt2(Math.floor((s % 3600) / 60))}:${fmt2(s % 60)}`;
}

function fmtTimeFrac(ms: number): string {
  return `${fmtTime(ms)}.${Math.floor((ms % 1000) / 100)}`;
}

function fmtCoord(n: number): string { return (n >= 0 ? ' ' : '') + n.toFixed(1); }

export class Console {
  private container: HTMLElement;
  private midiRow: HTMLElement;
  private midiSelect: HTMLSelectElement;
  private stateLine: HTMLElement;
  private logContainer: HTMLElement;

  constructor() {
    if (!document.getElementById('hud-styles')) {
      const style = document.createElement('style');
      style.id = 'hud-styles';
      style.textContent = `
        #hud{position:fixed;top:12px;left:12px;width:320px;max-height:640px;overflow:hidden;background:rgba(0,0,0,0.55);font-family:monospace;font-size:11px;color:#ccc;padding:8px 10px}
        .hud-title{color:#555;line-height:1.2;margin-bottom:8px;white-space:pre;pointer-events:none}
        .hud-midi{display:flex;align-items:center;gap:6px;margin-bottom:6px;pointer-events:auto}
        .hud-midi label{color:#888;white-space:nowrap}
        .hud-midi select{flex:1;background:rgba(0,0,0,0.6);color:#ccc;border:1px solid #444;font-family:monospace;font-size:11px;padding:1px 3px;outline:none}
        .hud-state{color:#888;margin-bottom:6px;white-space:nowrap;pointer-events:none}
        .hud-log{display:flex;flex-direction:column;pointer-events:none}
        .hud-line{white-space:nowrap;line-height:1.5}
        .hud-spawn{color:#ffff00}.hud-connect{color:#338cff}.hud-collide{color:#ff4444}
      `;
      document.head.appendChild(style);
    }
    this.container = document.createElement('div');
    this.container.id = 'hud';

    const title = document.createElement('div');
    title.className = 'hud-title';
    title.textContent = [
      ' ____                    ',
      '|  _ \\ ___  _ __   __ _ ___',
      '| |_) / _ \\| \'_ \\ / _` / __|',
      '|  __/ (_) | | | | (_| \\__ \\',
      '|_|   \\___/|_| |_|\\__, |___/',
      '                   |___/    ',
    ].join('\n');
    this.container.appendChild(title);

    this.midiRow = document.createElement('div');
    this.midiRow.className = 'hud-midi';
    const label = document.createElement('label');
    label.textContent = 'MIDI';
    this.midiSelect = document.createElement('select');
    this.midiSelect.innerHTML = '<option value="">— no devices —</option>';
    this.midiRow.appendChild(label);
    this.midiRow.appendChild(this.midiSelect);

    this.stateLine = document.createElement('div');
    this.stateLine.className = 'hud-state';
    this.logContainer = document.createElement('div');
    this.logContainer.className = 'hud-log';

    this.container.appendChild(this.midiRow);
    this.container.appendChild(this.stateLine);
    this.container.appendChild(this.logContainer);
    document.body.appendChild(this.container);
  }

  setMidiOutputs(outputs: MIDIOutput[], selectedId: string | null, onChange: (id: string) => void): void {
    this.midiSelect.innerHTML = outputs.length
      ? outputs.map(o => `<option value="${o.id}">${o.name ?? o.id}</option>`).join('')
      : '<option value="">— no devices —</option>';
    if (selectedId) this.midiSelect.value = selectedId;
    this.midiSelect.onchange = () => onChange(this.midiSelect.value);
  }

  updateState(nodeCount: number, connCount: number, entropy: number): void {
    this.stateLine.textContent =
      `nodes: ${nodeCount}  connections: ${connCount}  entropy: ${entropy.toFixed(2)}`;
  }

  logEvent(event: AppEvent, note: number): void {
    let typeStr: string;
    let cls: string;
    let x: number, y: number;

    if (event.type === 'node:spawn') {
      typeStr = 'SPAWN  '; cls = 'hud-spawn'; x = event.pos[0]; y = event.pos[1];
    } else if (event.type === 'node:connect') {
      typeStr = 'CONNECT'; cls = 'hud-connect';
      x = (event.posA[0] + event.posB[0]) / 2;
      y = (event.posA[1] + event.posB[1]) / 2;
    } else {
      typeStr = 'COLLIDE'; cls = 'hud-collide'; x = event.pos[0]; y = event.pos[1];
    }

    const line = document.createElement('div');
    line.className = `hud-line ${cls}`;
    line.textContent = `[${fmtTimeFrac(event.t)}]  ${typeStr}  ${noteName(note).padEnd(3)}  (x:${fmtCoord(x)}, y:${fmtCoord(y)})`;
    this.logContainer.insertBefore(line, this.logContainer.firstChild);
    if (this.logContainer.children.length > MAX_LOG) {
      this.logContainer.removeChild(this.logContainer.lastChild!);
    }
  }
}
