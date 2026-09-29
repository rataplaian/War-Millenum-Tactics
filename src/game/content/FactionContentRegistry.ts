import type { FactionContent, PresetRoster } from './types';

/** Catalog lookup only: faction rules still dispatch through generic engine policies. */
export class FactionContentRegistry {
  private readonly factions = new Map<string, FactionContent>();
  private readonly presets = new Map<string, PresetRoster>();

  register(content: FactionContent, presets: readonly PresetRoster[] = []): void {
    if (!content.id || this.factions.has(content.id) || content.datasheets.some(d => d.factionId !== content.id) ||
      new Set(content.datasheets.map(d => d.id)).size !== content.datasheets.length ||
      content.datasheets.some(d => this.datasheet(d.id)) ||
      new Set(content.abilities.map(a => a.id)).size !== content.abilities.length ||
      new Set(content.detachments.map(d => d.id)).size !== content.detachments.length ||
      presets.some(p => p.factionId !== content.id || !p.id || this.presets.has(p.id)) ||
      new Set(presets.map(p => p.id)).size !== presets.length) throw new Error('Invalid faction content registration');
    this.factions.set(content.id, content);
    for (const preset of presets) this.presets.set(preset.id, preset);
  }

  faction(id: string): FactionContent | undefined { return this.factions.get(id); }
  datasheet(id: string) { return [...this.factions.values()].flatMap(f => f.datasheets).find(d => d.id === id); }
  weapon(datasheetId: string, weaponId: string) { return this.datasheet(datasheetId)?.weapons.find(w => w.id === weaponId); }
  detachment(id: string) { return [...this.factions.values()].flatMap(f => f.detachments).find(d => d.id === id); }
  enhancement(id: string) { return [...this.factions.values()].flatMap(f => f.detachments).flatMap(d => d.enhancements).find(e => e.id === id); }
  stratagem(id: string) { return [...this.factions.values()].flatMap(f => f.detachments).flatMap(d => d.stratagems).find(s => s.id === id); }
  ability(id: string) { return [...this.factions.values()].flatMap(f => f.abilities).find(a => a.id === id); }
  preset(id: string): PresetRoster | undefined { return this.presets.get(id); }
}
