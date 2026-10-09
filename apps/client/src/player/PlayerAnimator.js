import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

import {
  PLAYER_MODEL_URL,
  PLAYER_HEIGHT,
  WALK_SPEED,
  WALK_ANIM_SPEED,
  RUN_SPEED,
  RUN_ANIM_SPEED,
  USE_JUMP_CLIP,
  ANIM_DIR
} from '../core/config.js';

// ============================================================
// CITYVERSE — PLAYER ANIMATOR
// Owns:
// - player visual model
// - placeholder model
// - Mixamo bone normalization
// - animation loading
// - animation state transitions
// ============================================================

export class PlayerAnimator {
  constructor(player) {
    this.player = player;

    this.loader = new GLTFLoader();

    this.mixer = null;
    this.actions = {};
    this.current = null;

    this.player.add(
      this.createPlaceholderHuman()
    );

    this.loadPlayerModel();
  }

  createPlaceholderHuman() {
    const group = new THREE.Group();

    const body = new THREE.Mesh(
      new THREE.CapsuleGeometry(
        0.3,
        0.8,
        4,
        12
      ),
      new THREE.MeshStandardMaterial({
        color: 0x2f6b4f
      })
    );

    body.position.y = 0.85;

    const head = new THREE.Mesh(
      new THREE.SphereGeometry(
        0.2,
        16,
        16
      ),
      new THREE.MeshStandardMaterial({
        color: 0x5a3a28
      })
    );

    head.position.y = 1.6;

    const nose = new THREE.Mesh(
      new THREE.BoxGeometry(
        0.08,
        0.08,
        0.12
      ),
      new THREE.MeshStandardMaterial({
        color: 0x5a3a28
      })
    );

    nose.position.set(
      0,
      1.6,
      -0.2
    );

    [
      body,
      head,
      nose
    ].forEach((mesh) => {
      mesh.castShadow = true;
    });

    group.add(
      body,
      head,
      nose
    );

    return group;
  }

  fixName(name) {
    return name.replace(
      /mixamorig\d*/g,
      'mixamorig'
    );
  }

  fixClip(clip) {
    clip.tracks.forEach((track) => {
      track.name =
        this.fixName(track.name);

      // Remove horizontal root motion.
      // CityVerse moves the player through game logic.
      if (
        /mixamorigHips\.position$/.test(
          track.name
        )
      ) {
        const values =
          track.values;

        for (
          let i = 0;
          i < values.length;
          i += 3
        ) {
          values[i] =
            values[0];

          values[i + 2] =
            values[2];
        }
      }
    });

    return clip;
  }

  registerClips(clips) {
    clips.forEach((clip) => {
      const name =
        clip.name.toLowerCase();

      const key =
        name.includes('run')
          ? 'run'
          : name.includes('walk')
            ? 'walk'
            : name.includes('idle')
              ? 'idle'
              : name.includes('jump') &&
                  USE_JUMP_CLIP
                ? 'jump'
                : null;

      if (
        key &&
        !this.actions[key] &&
        this.mixer
      ) {
        this.actions[key] =
          this.mixer.clipAction(
            this.fixClip(clip)
          );
      }
    });
  }

  loadClipFile(name) {
    this.loader.load(
      `${ANIM_DIR}${name}.glb`,

      (gltf) => {
        const clip =
          gltf.animations[0];

        if (
          clip &&
          this.mixer &&
          !this.actions[name]
        ) {
          this.actions[name] =
            this.mixer.clipAction(
              this.fixClip(clip)
            );
        }
      },

      undefined,

      () => {}
    );
  }

  loadPlayerModel() {
    this.loader.load(
      PLAYER_MODEL_URL,

      (gltf) => {
        this.player.clear();

        const model =
          gltf.scene;

        model.traverse((object) => {
          object.name =
            this.fixName(object.name);

          if (object.isMesh) {
            object.castShadow = true;
            object.frustumCulled = false;
          }
        });

        // Scale model to real human height.
        const box =
          new THREE.Box3()
            .setFromObject(model);

        const size =
          box.getSize(
            new THREE.Vector3()
          );

        const scale =
          PLAYER_HEIGHT /
          (size.y || 1);

        model.scale.multiplyScalar(
          scale
        );

        // Put feet on ground.
        box.setFromObject(model);

        model.position.y -=
          box.min.y;

        const holder =
          new THREE.Group();

        // glTF character faces +Z.
        // CityVerse forward is -Z.
        holder.rotation.y =
          Math.PI;

        holder.add(model);

        this.player.add(holder);

        this.mixer =
          new THREE.AnimationMixer(
            model
          );

        this.registerClips(
          gltf.animations
        );

        [
          'idle',
          'walk',
          'run'
        ].forEach((name) => {
          this.loadClipFile(name);
        });

        if (USE_JUMP_CLIP) {
          this.loadClipFile(
            'jump'
          );
        }

        console.log(
          'Character loaded. Clips in file:',
          gltf.animations.map(
            (animation) =>
              animation.name
          )
        );
      },

      undefined,

      () => {
        console.info(
          'No player model yet. Drop a GLB at',
          PLAYER_MODEL_URL
        );
      }
    );
  }

  setState(
    moving,
    running,
    airborne
  ) {
    if (!this.mixer) {
      return;
    }

    let name =
      airborne &&
      this.actions.jump
        ? 'jump'
        : !moving
          ? 'idle'
          : running &&
              this.actions.run
            ? 'run'
            : 'walk';

    if (!this.actions[name]) {
      name =
        name === 'idle'
          ? null
          : this.actions.walk
            ? 'walk'
            : null;
    }

    if (!name) {
      if (this.current) {
        this.actions[
          this.current
        ].timeScale = 0;
      }

      return;
    }

    if (
      this.current !== name
    ) {
      const next =
        this.actions[name];

      next
        .reset()
        .fadeIn(0.2)
        .play();

      if (this.current) {
        this.actions[
          this.current
        ].fadeOut(0.2);
      }

      this.current =
        name;
    }

    this.actions[name].timeScale =
      name === 'walk'
        ? WALK_SPEED /
          WALK_ANIM_SPEED
        : name === 'run'
          ? RUN_SPEED /
            RUN_ANIM_SPEED
          : 1;
  }

  update(deltaTime) {
    this.mixer?.update(
      deltaTime
    );
  }
}