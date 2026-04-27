export class MidiOutput {
  private output: MIDIOutput | null = null;

  async init(): Promise<void> {
    if (!navigator.requestMIDIAccess) {
      console.warn('Web MIDI API not available');
      return;
    }
    try {
      const access = await navigator.requestMIDIAccess();
      access.outputs.forEach(out => { if (!this.output) this.output = out; });
      if (!this.output) console.warn('No MIDI output devices found');
    } catch {
      console.warn('MIDI access denied');
    }
  }

  noteOn(note: number, velocity = 80, channel = 1): void {
    if (!this.output) return;
    this.output.send([0x90 | (channel - 1), note, velocity]);
  }

  noteOff(note: number, channel = 1): void {
    if (!this.output) return;
    this.output.send([0x80 | (channel - 1), note, 0]);
  }

  playNote(note: number, durationMs = 120): void {
    this.noteOn(note);
    setTimeout(() => this.noteOff(note), durationMs);
  }
}
