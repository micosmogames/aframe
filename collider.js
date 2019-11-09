/* global THREE */
import aframe from "aframe";
import { bindEvent } from "aframe-event-decorators";
import { requestObject, returnObject } from "@micosmo/core/object";
import { isVisibleInScene } from "./lib/utils";

const v1 = new THREE.Vector3();
const v2 = new THREE.Vector3();

const debugMaterial = new THREE.MeshBasicMaterial({
  color: "blue",
  wireframe: true,
  depthTest: false,
  transparent: true
});

aframe.registerSystem("collider", {
  init() {
    this.collisions = new Map();
    this.prevCollisions = new Map();
    this.newCollisions = new Map();

    this.colliders = new Set();
    this.layers = new Map();
  },
  tick(tm, dtm) {
    this.prevCollisions.clear();
    const temp = this.prevCollisions;
    this.prevCollisions = this.collisions;
    this.collisions = temp;

    for (const c1 of this.colliders) {
      const layers = c1.data.collidesWith;
      for (const layer of layers) {
        if (!this.layers.has(layer)) continue;
        for (const c2 of this.layers.get(layer)) {
          if (c1 !== c2)
            this.addAnyCollisions(c1, c2);
        }
      }
    }

    // Get newly intersected entities.
    this.newCollisions.clear();
    for (const [c1, cols] of this.collisions) {
      for (const c2 of cols) {
        if (!this.hasCollided(c1, c2, this.prevCollisions)) {
          this.addCollision(c1, c2, this.newCollisions);
          emitEvent("collisionstart", c1, c2);
        }
      }
    }

    // Find collision which have cleared
    for (const [c1, cols] of this.prevCollisions) {
      for (const c2 of cols) {
        if (!this.hasCollided(c1, c2))
          emitEvent("collisionend", c1, c2);
      }
    }
  },
  addAnyCollisions(c1, c2) {
    const el1 = c1.el; const el2 = c2.el;
    if (el1.components === undefined || el1.components[c1.attrName] === undefined || !c1.data.enabled ||
      el2.components === undefined || el2.components[c2.attrName] === undefined || !c2.data.enabled) {
      return;
    } else if (!el1.isPlaying || !el2.isPlaying)
      return;
    else if (!c1.data.collideNonVisible && (!isVisibleInScene(el2) || !isVisibleInScene(el1)))
      return;

    const methName = `collision_${c1.data.shape}_${c2.data.shape}`;
    if (!this[methName])
      throw new Error(`micosmo:system:collider:addAnyCollisions: Invalid shape(s). Shape1(${c1.data.shape}) Shape2(${c2.data.shape})`)
    if (this[methName](c1, c2))
      this.addCollision(c1, c2);
  },
  addCollision(c1, c2, list = this.collisions) {
    // If our primary collider is ignoring duplicates then check whether we have already
    // recordered the reverse collision and ignore.
    if (c1.data.ignoreDuplicates && this.collisions.has(c2) && this.collisions.get(c2).has(c1))
      return;
    if (!this.collisions.has(c1)) this.collisions.set(c1, new Set());
    this.collisions.get(c1).add(c2);
  },
  hasCollided(collider, other, list = this.collisions) {
    return list.has(collider) && list.get(collider).has(other)
  },
  collision_sphere_sphere: (() => {
    const v1 = new THREE.Vector3();
    const v2 = new THREE.Vector3();
    return (sphere1, sphere2) => {
      const s1Pos = sphere1.el.object3D.getWorldPosition(v1);
      const s2Pos = sphere2.el.object3D.getWorldPosition(v2);
      const distance = s1Pos.distanceTo(s2Pos);
      const combinedRadius = sphere1.getScaledRadius() + sphere2.getScaledRadius();
      return distance <= combinedRadius;
    };
  })(),
  collision_box_sphere(c1, c2) { return this.collision_sphere_box(c2, c1) },
  collision_sphere_box: (() => {
    const v1 = new THREE.Vector3();
    const v2 = new THREE.Vector3();
    const v3 = new THREE.Vector3();
    const s = new THREE.Sphere();
    const b = new THREE.Box3();

    return (sphere, box) => {
      const spherePos = sphere.el.object3D.getWorldPosition(v1);
      const sphereRadius = sphere.getScaledRadius();
      s.set(spherePos, sphereRadius);

      const boxPos = box.el.object3D.getWorldPosition(v2);
      const boxSize = box.getScaledDimensions(v3);
      b.setFromCenterAndSize(boxPos, boxSize);

      return b.intersectsSphere(s);
    };
  })(),
  collision_box_box: (() => {
    const v1 = new THREE.Vector3();
    const v2 = new THREE.Vector3();
    const v3 = new THREE.Vector3();
    const v4 = new THREE.Vector3();
    const b1 = new THREE.Box3();
    const b2 = new THREE.Box3();

    return (box1, box2) => {
      const box1Pos = box1.el.object3D.getWorldPosition(v1);
      const box1Size = box1.getScaledDimensions(v2);
      b1.setFromCenterAndSize(box1Pos, box1Size);

      const box2Pos = box2.el.object3D.getWorldPosition(v3);
      const box2Size = box2.getScaledDimensions(v4);
      b2.setFromCenterAndSize(box2Pos, box2Size);

      return b1.intersectsBox(b2);
    };
  })(),
  addCollider(c, layer) {
    if (!this.layers.has(layer))
      this.layers.set(layer, new Set());
    this.layers.get(layer).add(c);
    this.colliders.add(c);
  },
  removeCollider(c, layer) {
    this.layers.get(layer).delete(c);
    this.colliders.delete(c);
  }
});

function emitEvent(name, c1, c2) {
  const el = c1.el; const elWith = c2.el;
  const elTarget = el.components[c1.attrName].data.eventTarget;
  if (!elTarget)
    el.emit(name, elWith, true); // Original implementation bubbles
  else {
    const detail = requestObject();
    detail.el1 = el; detail.el2 = elWith;
    detail.layer1 = el.components[c1.attrName].data.layer;
    detail.layer2 = elWith.components[c2.attrName].data.layer;
    elTarget.emit(name, detail, false); // Target events don't bubble
    returnObject(detail);
  }
}

const shapeNames = ["sphere", "box"];

const shapeSchemas = {
  sphere: {
    radius: { type: "number", default: 1, min: 0 }
  },
  box: {
    width: { type: "number", default: 1, min: 0 },
    height: { type: "number", default: 1, min: 0 },
    depth: { type: "number", default: 1, min: 0 }
  }
};

/**
 * @property {string} objects - Selector of entities to test for collision.
 */
aframe.registerComponent("collider", {
  schema: {
    collideNonVisible: { default: false },
    enabled: { default: true },
    shape: { default: "sphere", oneOf: shapeNames },
    layer: { default: "default" },
    collidesWith: { type: "array" },
    eventTarget: { type: "selector" },
    ignoreDuplicates: { default: false },
    policy: { default: 'init', oneof: ['init', 'play', 'pool'] }
  },
  multiple: true,
  init() {
    this._debugMesh = new THREE.Mesh(new THREE.SphereGeometry(this.data.radius, 6, 6), debugMaterial);
    this._debugMesh.visible = false;
    this.activated = false;
    this.el.object3D.add(this._debugMesh);
    if (aframe.INSPECTOR && aframe.INSPECTOR.inspectorActive)
      this.inspectorEnabled();
  },
  update(oldData) {
    if (this.data.layer !== oldData.layer && (this.activated || this.data.policy === 'init')) {
      if (oldData.layer !== undefined)
        this.system.removeCollider(this, oldData.layer);
      this.system.addCollider(this, this.data.layer);
    }
  },
  remove() {
    this.system.removeCollider(this, this.data.layer);
  },

  inspectorenabled: bindEvent({ target: "a-scene" }, function () {
    this._debugMesh.visible = true;
    this.rebuildDebugMesh();
  }),
  inspectordisabled: bindEvent({ target: "a-scene" }, function () {
    this._debugMesh.visible = false;
  }),
  inspectorcomponentchanged: bindEvent(function () {
    this.rebuildDebugMesh();
  }),

  'pool-remove': bindEvent(function () {
    if (this.data.policy !== 'pool') return;
    this.system.addCollider(this, this.data.layer);
    this.activated = true;
  }),
  'pool-return': bindEvent(function () {
    if (this.data.policy !== 'pool') return;
    this.system.removeCollider(this, this.data.layer);
    this.activated = false;
  }),

  play() {
    if (this.data.policy !== 'play') return;
    this.system.addCollider(this, this.data.layer);
    this.activated = true;
  },
  pause() {
    if (this.data.policy !== 'play') return;
    this.system.removeCollider(this, this.data.layer);
    this.activated = false;
  },

  getScaledRadius() {
    const scale = this.el.object3D.getWorldScale(v1);
    return Math.max(scale.x, Math.max(scale.y, scale.z)) * this.data.radius;
  },
  getScaledDimensions(target) {
    const scale = this.el.object3D.getWorldScale(v1);
    target
      .set(this.data.width, this.data.height, this.data.depth)
      .multiply(scale);
    return target;
  },
  rebuildDebugMesh() {
    if (this.data.shape === "sphere") {
      const scaledRadius = this.getScaledRadius();
      this._debugMesh.geometry = new THREE.SphereGeometry(scaledRadius, 6, 6);
    } else if (this.data.shape === "box") {
      const scaledDimensions = this.getScaledDimensions(v2);
      this._debugMesh.geometry = new THREE.BoxGeometry(
        scaledDimensions.x,
        scaledDimensions.y,
        scaledDimensions.z
      );
    }

    const s = this._debugMesh.scale;
    this.el.object3D.getWorldScale(s);
    s.set(1 / s.x, 1 / s.y, 1 / s.z);
  },
  updateSchema(data) {
    const newShape = data.shape;
    const currentShape = this.data && this.data.shape;
    const shape = newShape || currentShape;
    const schema = shapeSchemas[shape];
    if (!schema) console.error("unknown shape: " + shape);
    if (currentShape && newShape === currentShape) return;
    this.extendSchema(schema);
  }
});
