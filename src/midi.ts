export class MidiOutput {
  private output: MIDIOutput | null = null;
  private allOutputs: MIDIOutput[] = [];

  async init(): Promise<void> {
    if (!navigator.requestMIDIAccess) {
      console.warn('Web MIDI API not available');
      return;
    }
    try {
      const access = await navigator.requestMIDIAccess();
      const outputs: MIDIOutput[] = [];
      access.outputs.forEach(o => outputs.push(o));
      this.allOutputs = outputs;
      this.output = this.allOutputs.find(o => o.name?.toLowerCase().includes('iac'))
        ?? this.allOutputs[0]
        ?? null;
      if (this.output) console.log(`MIDI output: "${this.output.name}"`);
      else console.warn('No MIDI output devices found');
    } catch {
      console.warn('MIDI access denied');
    }
  }

  get outputs(): MIDIOutput[] { return this.allOutputs; }
  get selectedId(): string | null { return this.output?.id ?? null; }

  selectOutput(id: string): void {
    this.output = this.allOutputs.find(o => o.id === id) ?? this.output;
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
