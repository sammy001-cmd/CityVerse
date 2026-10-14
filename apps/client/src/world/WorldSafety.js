// Runtime only: never persisted to the server. All distances are metres.
export class WorldSafety {
  constructor({ below = 12, missingSeconds = 1.5 } = {}) {
    Object.assign(this, { below, missingSeconds });
    this.history = [];
    this.missing = 0;
    this.recoveries = 0;
    this.reason = null;
  }
  step({ position, grounded, surface, dt, region, vehicle = null, validateSafe = () => true }) {
    const finite = ['x', 'y', 'z'].every(k => Number.isFinite(position[k]));
    const valid = finite && surface.valid && surface.collider;
    if(this.holding){
      if(valid)this.holding=null;
      else return {...this.holding,awaitingSurface:true};
    }
    this.missing = valid ? 0 : this.missing + dt;
    const below = finite && Number.isFinite(surface.height) && position.y < surface.height - this.below;
    const reason = !finite ? 'invalid-position' : !surface.inBounds ? 'region-boundary' : below ? 'below-surface' : this.missing >= this.missingSeconds ? 'missing-surface' : null;
    if (reason) {
      const candidates=[...this.history].reverse().filter(p=>p.region===region&&p.vehicle===vehicle);
      const safe = candidates.find(validateSafe)??candidates[0];
      if (safe) {
        this.reason = reason;
        this.recoveries++;
        this.missing = 0;
        if(!validateSafe(safe))this.holding=safe;
        return { ...safe,awaitingSurface:Boolean(this.holding) };
      }
    }
    if (!reason && valid && grounded && Math.abs(position.y - surface.height) <= (vehicle ? 2.5 : 0.25)) {
      this.lastValidHeight = surface.height;
      const previous = this.history.at(-1);
      if (!previous || previous.vehicle !== vehicle || Math.hypot(position.x - previous.x, position.z - previous.z) > 2) {
        this.history.push({ x: position.x, y: surface.height, z: position.z, region, vehicle });
        if (this.history.length > 32) this.history.shift();
      }
    }
    return null;
  }
  get lastSafe() { return this.history.at(-1) ?? null; }
}
