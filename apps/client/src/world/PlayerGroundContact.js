// Player root represents the feet. Grounded movement follows the sampled mesh;
// only airborne movement integrates gravity. Space explicitly clears grounded.
export function stepGroundContact(y, velocity, grounded, floorY, dt) {
  if (grounded && velocity <= 0) return { y: floorY, velocity: 0, grounded: true };
  velocity -= 20 * dt;
  y += velocity * dt;
  if (y <= floorY && velocity <= 0) return { y: floorY, velocity: 0, grounded: true };
  // Uphill ground can intersect an ascending jump, but cannot leave feet buried.
  return { y: Math.max(y, floorY), velocity, grounded: false };
}
