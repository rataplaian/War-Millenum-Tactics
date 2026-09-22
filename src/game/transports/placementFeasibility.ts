import type { GameState, Model, Unit } from '../models';
import { baseRadius, centreDistance } from '../utils/geometry';
/** Conservative certificate, not a packing solver. In a ground-only world, an
 * arrangement of circles and the eroded table rectangle enumerates every boundary
 * arc of the closed feasible region. An empty region proves one model cannot fit.
 * Terrain/elevated worlds return unknown, never a false impossibility verdict. */
export function provablyCannotPlace(s: GameState, u: Unit, m: Model, parent: Model, distance: number, allowed: readonly string[]): boolean {
  const r = baseRadius(m.base), pr = baseRadius(parent.base), min = pr + r, max = pr + distance - r;
  if (s.battlefield.terrain?.features.length || (parent.position.z ?? 0) !== 0) return false;
  if (max < min - 1e-8) return true;
  const bounds = { x0:r, y0:r, x1:s.battlefield.width-r, y1:s.battlefield.height-r };
  if (bounds.x0 > bounds.x1 || bounds.y0 > bounds.y1) return true;
  type Circle = { x:number; y:number; r:number; angles:number[] };
  const circle = (x:number,y:number,radius:number):Circle => ({x,y,r:radius,angles:[0]});
  const obstacles = s.units.filter(x=>x.id!==u.id && x.id!==parent.unitId && (x.location??'BATTLEFIELD')==='BATTLEFIELD').flatMap(x=>x.models.filter(b=>b.alive && (b.position.z??0)===0).map(b=>circle(b.position.x,b.position.y,r+baseRadius(b.base)+(x.playerId!==u.playerId&&!allowed.includes(x.id)?s.spatialRules.engagementDistance:0))));
  const circles = [circle(parent.position.x,parent.position.y,min),circle(parent.position.x,parent.position.y,max),...obstacles];
  const corners = [{x:bounds.x0,y:bounds.y0},{x:bounds.x1,y:bounds.y0},{x:bounds.x1,y:bounds.y1},{x:bounds.x0,y:bounds.y1}];
  const candidates = [...corners], lines = corners.map((a,i)=>({a,b:corners[(i+1)%4]!,ts:[0,1]}));
  const add = (c:Circle,p:{x:number;y:number}) => {c.angles.push(Math.atan2(p.y-c.y,p.x-c.x));candidates.push(p);};
  for(let i=0;i<circles.length;i++) {
    const a=circles[i]!;
    for(const b of circles.slice(i+1)) {
      const d=Math.hypot(b.x-a.x,b.y-a.y);if(!d||d>a.r+b.r||d<Math.abs(a.r-b.r))continue;
      const angle=Math.atan2(b.y-a.y,b.x-a.x),delta=Math.acos(Math.max(-1,Math.min(1,(a.r*a.r+d*d-b.r*b.r)/(2*a.r*d))));
      for(const t of [angle-delta,angle+delta]) {const p={x:a.x+a.r*Math.cos(t),y:a.y+a.r*Math.sin(t)};add(a,p);add(b,p);}
    }
    for(const l of lines) {
      const dx=l.b.x-l.a.x,dy=l.b.y-l.a.y,fx=l.a.x-a.x,fy=l.a.y-a.y;
      const A=dx*dx+dy*dy,B=2*(fx*dx+fy*dy),C=fx*fx+fy*fy-a.r*a.r,D=B*B-4*A*C;
      if(!A||D<0)continue;
      for(const t of [(-B-Math.sqrt(D))/(2*A),(-B+Math.sqrt(D))/(2*A)])if(t>=0&&t<=1){l.ts.push(t);add(a,{x:l.a.x+t*dx,y:l.a.y+t*dy});}
    }
  }
  for(const c of circles) {
    const angles=[...new Set(c.angles.map(a=>(a+Math.PI*2)%(Math.PI*2)))].sort((a,b)=>a-b);
    for(let i=0;i<angles.length;i++)for(const t of [angles[i]!, (angles[i]!+(angles[i+1]??angles[0]!+Math.PI*2))/2])candidates.push({x:c.x+c.r*Math.cos(t),y:c.y+c.r*Math.sin(t)});
  }
  for(const l of lines){l.ts.sort((a,b)=>a-b);for(let i=0;i<l.ts.length-1;i++){const t=(l.ts[i]!+l.ts[i+1]!)/2;candidates.push({x:l.a.x+t*(l.b.x-l.a.x),y:l.a.y+t*(l.b.y-l.a.y)});}}
  const tolerance=1e-8;
  return !candidates.some(p=>p.x>=bounds.x0-tolerance&&p.x<=bounds.x1+tolerance&&p.y>=bounds.y0-tolerance&&p.y<=bounds.y1+tolerance&&centreDistance(p,parent.position)>=min-tolerance&&centreDistance(p,parent.position)<=max+tolerance&&obstacles.every(c=>Math.hypot(p.x-c.x,p.y-c.y)>=c.r-tolerance));
}
