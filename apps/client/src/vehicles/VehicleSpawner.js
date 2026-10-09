import { Vehicle } from './VehicleSystem.js';


// ============================================================
// CITYVERSE — VEHICLE SPAWNER
//
// Responsible for:
// - selecting road spawn points
// - vehicle spacing
// - terrain-aware spawn height
// - creating vehicle instances
//
// It does NOT control:
// - driving
// - vehicle physics
// - ownership
// - traffic AI
// ============================================================

export class VehicleSpawner {

  constructor({
    physics,
    scene,
    groundY,
    blocked,
    spawnPoints = []
  }) {

    this.physics = physics;
    this.scene = scene;

    this.groundY = groundY;
    this.blocked = blocked;

    this.spawnPoints = spawnPoints;

  }


  spawnNear(
    playerX,
    playerZ,
    {
      types = [
        'carry',
        'car',
        'danfo',
        'carry'
      ],

      count = 1,

      minDistance = 12,
      maxDistance = 160,

      minSpacing = 30

    } = {}
  ) {

    const requestedCount =
      Math.max(
        0,
        Math.min(
          count,
          types.length
        )
      );


    const spawned = [];

    const positions = [];


    for (
      const point of
      this.spawnPoints
    ) {

      if (
        spawned.length >=
        requestedCount
      ) {
        break;
      }


      const [
        x,
        z,
        dirX = 0,
        dirZ = 1
      ] = point;


      const distance =
        Math.hypot(
          x - playerX,
          z - playerZ
        );


      if (
        distance < minDistance ||
        distance > maxDistance
      ) {
        continue;
      }


      const tooClose =
        positions.some(
          ([otherX, otherZ]) =>
            Math.hypot(
              x - otherX,
              z - otherZ
            ) < minSpacing
        );


      if (tooClose) {
        continue;
      }


      if (
        this.blocked(
          x,
          z
        )
      ) {
        continue;
      }


      // Check some road space
      // ahead and behind the vehicle.
      if (
        this.blocked(
          x + dirX * 3,
          z + dirZ * 3
        ) ||
        this.blocked(
          x - dirX * 3,
          z - dirZ * 3
        )
      ) {
        continue;
      }


      const vehicleType =
        types[
          spawned.length
        ];


      const heading =
        Math.atan2(
          dirX,
          dirZ
        );


      const groundHeight =
        this.groundY(
          x,
          z
        );


      const vehicle =
        new Vehicle(
          this.physics,
          this.scene,
          vehicleType,
          x,
          z,
          heading,
          groundHeight
        );


      spawned.push(
        vehicle
      );


      positions.push([
        x,
        z
      ]);

    }


    return spawned;

  }


  spawnAt({
    type,
    x,
    z,
    heading = 0
  }) {

    return new Vehicle(
      this.physics,
      this.scene,
      type,
      x,
      z,
      heading,
      this.groundY(
        x,
        z
      )
    );

  }

}