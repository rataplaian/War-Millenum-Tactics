import type { GameState, Model, Unit } from '../game/models';

/** Presentation metadata only: authoritative base diameter/positions stay on Model. */
export const UNIT_VISUALS: Record<string, { token: string; category: string }> = {
  farseer: {token:'aeldari-seer',category:'Leader'}, warlock: {token:'aeldari-seer',category:'Leader'},
  autarch: {token:'aeldari-autarch',category:'Leader'}, 'storm-guardians': {token:'aeldari-guardian',category:'Infantry'},
  'dire-avengers': {token:'aeldari-avenger',category:'Elite infantry'}, 'fire-dragons': {token:'aeldari-dragon',category:'Elite infantry'},
  'dark-reapers': {token:'aeldari-reaper',category:'Heavy infantry'}, rangers: {token:'aeldari-ranger',category:'Infantry'},
  'wave-serpent': {token:'aeldari-serpent',category:'Vehicle'}, 'night-spinner': {token:'aeldari-spinner',category:'Vehicle'},
  'lord-exultant': {token:'ec-exultant',category:'Leader'}, sorcerer: {token:'ec-sorcerer',category:'Leader'},
  'lord-kakophonist': {token:'ec-kakophonist',category:'Leader'}, infractors: {token:'ec-infractor',category:'Infantry'},
  tormentors: {token:'ec-tormentor',category:'Infantry'}, 'noise-marines': {token:'ec-noise',category:'Heavy infantry'},
  'flawless-blades': {token:'ec-blade',category:'Elite infantry'}, 'chaos-rhino': {token:'ec-tank',category:'Vehicle'},
  'chaos-land-raider': {token:'ec-tank',category:'Large vehicle'},
};
export function modelDefinitionId(state: GameState, unit: Unit, model?: Model): string {
  return model?.componentUnitId
    ? state.attachments?.find(a=>a.id===unit.id)?.components.find(c=>c.original.id===model.componentUnitId)?.original.definitionId??unit.definitionId
    : state.attachments?.find(a=>a.id===unit.id)?.components.find(c=>c.role==='BODYGUARD')?.original.definitionId??unit.definitionId;
}
export function unitName(state: GameState, id: string): string {
  const unit=state.units.find(u=>u.id===id);
  return state.definitions.find(d=>d.id===unit?.definitionId)?.name??id.replaceAll('-',' ');
}
export function visualModels(state: GameState, unit: Unit) {
  return unit.models.filter(m=>m.alive).map(model=>({model, definitionId:modelDefinitionId(state,unit,model),
    position:state.setup?.positions[model.id]??state.transportState?.disembark?.positions[model.id]??model.position}));
}
