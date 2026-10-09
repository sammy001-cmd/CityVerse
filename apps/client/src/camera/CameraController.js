import * as THREE from 'three';

// ============================================================
// CITYVERSE — THIRD-PERSON CAMERA CONTROLLER
// ============================================================

export class CameraController {
  constructor({
    camera,
    target,
    yaw = 0,
    pitch = 0.35,
    distance = 6
  }) {
    this.camera = camera;
    this.target = target;

    this.yaw = yaw;
    this.pitch = pitch;
    this.distance = distance;

    this.lastMouseMove = 0;

    this.mouseSensitivity = 0.0025;

    this.minPitch = 0.05;
    this.maxPitch = 1.2;

    this.minDistance = 3;
    this.maxDistance = 14;
  }

  handleMouseMove(event) {
    this.lastMouseMove =
      performance.now();

    this.yaw -=
      event.movementX *
      this.mouseSensitivity;

    this.pitch =
      THREE.MathUtils.clamp(
        this.pitch +
          event.movementY *
            this.mouseSensitivity,
        this.minPitch,
        this.maxPitch
      );
  }

  handleWheel(event) {
    this.distance =
      THREE.MathUtils.clamp(
        this.distance +
          event.deltaY * 0.005,
        this.minDistance,
        this.maxDistance
      );
  }

  update(deltaTime, driving = null) {
    // When driving and the player has not recently moved
    // the mouse, gradually swing behind the vehicle.
    if (
      driving &&
      performance.now() -
        this.lastMouseMove >
        1500 &&
      driving.kmh > 3
    ) {
      const targetYaw =
        driving.heading +
        Math.PI;

      let difference =
        targetYaw -
        this.yaw;

      difference =
        Math.atan2(
          Math.sin(difference),
          Math.cos(difference)
        );

      this.yaw +=
        difference *
        Math.min(
          1,
          deltaTime * 3
        );
    }

    const distance =
      driving
        ? this.distance + 4
        : this.distance;

    const cosPitch =
      Math.cos(this.pitch);

    this.camera.position.set(
      this.target.position.x +
        Math.sin(this.yaw) *
          cosPitch *
          distance,

      this.target.position.y +
        (driving ? 2.2 : 1.6) +
        Math.sin(this.pitch) *
          distance,

      this.target.position.z +
        Math.cos(this.yaw) *
          cosPitch *
          distance
    );

    this.camera.lookAt(
      this.target.position.x,
      this.target.position.y + 1.4,
      this.target.position.z
    );
  }
}