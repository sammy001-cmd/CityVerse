import * as THREE from 'three';
import { RenderedRoadSurface } from './RenderedRoadSurface.js';
import { clipRoadGeometry } from './ClipRoadGeometry.js';

export function buildRoadTile(data) {
    if (!Array.isArray(data.roads) || !Array.isArray(data.junctions)) {
      throw new Error(`Road tile ${data.tx}_${data.tz} is malformed.`);
    }

    const group = new THREE.Group();
    group.name = `RoadTile_${data.tx}_${data.tz}`;

    const roadMeshes =
      this.roadGeometry.build(
        data.roads
      );

    if (roadMeshes.shoulders) {
      const shoulders = new THREE.Mesh(roadMeshes.shoulders, this.shoulderMaterial);
      shoulders.receiveShadow = true;
      shoulders.userData.roadCollision = true;
      shoulders.userData.surfaceType = 'shoulder';
      shoulders.userData.part='shoulders';
      group.add(shoulders);
    }

    for (const [part,material,type] of [['blend',this.groundMaterial,'terrain'],
      ['curbs',this.concreteMaterial,'curb'],['sidewalks',this.concreteMaterial,'sidewalk']]) {
      if (!roadMeshes[part]) continue;
      const mesh = new THREE.Mesh(roadMeshes[part],material);
      mesh.receiveShadow=true; mesh.userData.roadCollision=true; mesh.userData.surfaceType=type;
      mesh.userData.part=part;
      group.add(mesh);
    }
    group.userData.roadEdges = roadMeshes.edges;

    if (roadMeshes.asphalt) {
      const road = new THREE.Mesh(roadMeshes.asphalt, this.roadMaterial);
      road.receiveShadow = true;
      road.userData.roadCollision = true;
      road.userData.part='asphalt';
      group.add(road);
    }

    if (roadMeshes.markings) {
      const markings=new THREE.Mesh(roadMeshes.markings,this.markingMaterial);
      markings.userData.part='markings'; group.add(markings);
    }

    const preliminary = new RenderedRoadSurface();
    preliminary.addTile('tile',group);
    const junctionGeometry =
      this.junctionBuilder.build(
        data.junctions,
        preliminary
      );

    if (junctionGeometry) {
      // Remove covered asphalt/shoulder/paint instead of stacking coplanar strips.
      for (const mesh of group.children) {
        const clipped=clipRoadGeometry(mesh.geometry,junctionGeometry);
        mesh.geometry.dispose(); mesh.geometry=clipped;
      }
      const junctionMesh =
        new THREE.Mesh(
          junctionGeometry,
          this.roadMaterial
        );

      junctionMesh.receiveShadow =
        true;

      junctionMesh.name =
        'RoadJunctions';
      junctionMesh.userData.part='asphalt';

      junctionMesh.userData.roadCollision =
        true;

      group.add(
        junctionMesh
      );
    }

    return group;
  }

