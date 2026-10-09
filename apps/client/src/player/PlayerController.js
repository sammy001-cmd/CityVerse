import * as THREE from 'three';

import {
  WALK_SPEED,
  RUN_SPEED
} from '../core/config.js';


// ============================================================
// CITYVERSE — LOCAL PLAYER CONTROLLER
//
// Owns:
// - walking
// - running
// - jumping
// - gravity
// - building collision
// - terrain grounding
// - movement rotation
//
// Does NOT own:
// - animations
// - camera
// - vehicles
// - multiplayer networking
// ============================================================

export class PlayerController {
  constructor({
    player,
    groundY,
    blocked,
    gravity = 20,
    jumpVelocity = 7,
    turnSpeed = 12
  }) {
    this.player = player;

    this.groundY = groundY;
    this.blocked = blocked;

    this.gravity = gravity;
    this.jumpVelocity = jumpVelocity;
    this.turnSpeed = turnSpeed;

    this.velocityY = 0;
    this.grounded = true;
  }


  jump() {
    if (!this.grounded) {
      return false;
    }

    this.velocityY =
      this.jumpVelocity;

    this.grounded = false;

    return true;
  }


  resetVerticalMotion() {
    this.velocityY = 0;
  }


  update(
    deltaTime,
    {
      keys,
      yaw,
      disabled = false
    }
  ) {
    if (disabled) {
      this.velocityY = 0;

      return {
        moving: false,
        running: false,
        airborne: false
      };
    }


    const forward =
      (keys.KeyW ? 1 : 0) -
      (keys.KeyS ? 1 : 0);


    const strafe =
      (keys.KeyD ? 1 : 0) -
      (keys.KeyA ? 1 : 0);


    const moving =
      forward !== 0 ||
      strafe !== 0;


    const running =
      Boolean(keys.ShiftLeft);


    const speed =
      running
        ? RUN_SPEED
        : WALK_SPEED;


    if (moving) {
      const forwardX =
        -Math.sin(yaw);

      const forwardZ =
        -Math.cos(yaw);


      const rightX =
        -forwardZ;

      const rightZ =
        forwardX;


      let moveX =
        forwardX * forward +
        rightX * strafe;

      let moveZ =
        forwardZ * forward +
        rightZ * strafe;


      const length =
        Math.hypot(
          moveX,
          moveZ
        );


      if (length > 0) {
        moveX /= length;
        moveZ /= length;
      }


      const nextX =
        this.player.position.x +
        moveX *
          speed *
          deltaTime;


      const nextZ =
        this.player.position.z +
        moveZ *
          speed *
          deltaTime;


      // Collision sliding:
      // X and Z are tested separately.
      if (
        !this.blocked(
          nextX,
          this.player.position.z
        )
      ) {
        this.player.position.x =
          nextX;
      }


      if (
        !this.blocked(
          this.player.position.x,
          nextZ
        )
      ) {
        this.player.position.z =
          nextZ;
      }


      // Rotate character toward movement.
      const targetRotation =
        Math.atan2(
          -moveX,
          -moveZ
        );


      let difference =
        targetRotation -
        this.player.rotation.y;


      difference =
        Math.atan2(
          Math.sin(difference),
          Math.cos(difference)
        );


      this.player.rotation.y +=
        difference *
        Math.min(
          1,
          deltaTime *
            this.turnSpeed
        );
    }


    // Gravity
    this.velocityY -=
      this.gravity *
      deltaTime;


    this.player.position.y +=
      this.velocityY *
      deltaTime;


    // Real terrain floor
    const floorY =
      this.groundY(
        this.player.position.x,
        this.player.position.z
      );


    if (
      this.player.position.y <=
      floorY
    ) {
      this.player.position.y =
        floorY;

      this.velocityY = 0;

      this.grounded = true;
    }


    return {
      moving,
      running,
      airborne:
        !this.grounded
    };
  }
}