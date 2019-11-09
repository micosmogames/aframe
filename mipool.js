/*
 * mipool.js
 *
 * An extended version of the Aframe 0.9.2 pool component.
 */
import aframe from "aframe";
import { removeIndex } from "@micosmo/core/object";
import { createSchemaPersistentObject, instantiateDatagroup } from './lib/utils';
import { onLoadedDo } from "./startup";

/**
 * Pool component to reuse entities.
 * Avoids creating and destroying the same kind of entities.
 * Helps reduce GC pauses. For example in a game to reuse enemies entities.
 *
 * @member {array} availableEls - Available entities in the pool.
 * @member {array} usedEls - Entities of the pool in use.
 */
aframe.registerComponent('mipool', {
  schema: {
    container: { default: '' },
    mixin: { default: '' },
    datagroup: { default: '' },
    size: { default: 0 },
    maxSize: { default: 1 },
    threshold: { default: 0 }, // Expansion threshold in number of unused elements
    poolPolicy: { default: 'warn', oneof: ['warn', 'error', 'dynamic', 'ignore'] },
    visible: { default: true } // Visibility of a requested entity
  },
  updateSchema(data) {
    createSchemaPersistentObject(this, data, '_state');
  },

  multiple: true,

  init() {
    this.state = this.data._state;
    this.state.threshold = this.state.maxSize = 0;
    this.deletedEls = []; // In case we change the mixin and have old elements still being used.
    this.availableEls = [];
    this.usedEls = [];
    onLoadedDo(() => { this.sysDataset = this.el.sceneEl.systems.dataset });
  },

  initPool: function () {
    while (this.usedEls.length > 0) this.deletedEls.push(this.usedEls.pop());
    this.state.size = this.availableEls.length = this.usedEls.length = 0;
    if (!this.data.mixin && !this.data.datagroup)
      console.warn(`micosmo:component:mipool:initPool No 'mixin' or 'datagroup' provided for pool component '${this.attrName}'.`);
    if (this.data.container) {
      this.container = document.querySelector(this.data.container);
      if (!this.container)
        console.warn(`micosmo:component:mipool:initPool Container ' + this.data.container + ' not found for '${this.attrName}'.`);
    }
    if (!this.container)
      this.container = this.el;
  },

  update: function (oldData) {
    var data = this.data;
    if (oldData.mixin !== data.mixin || oldData.datagroup !== data.datagroup)
      this.initPool();
    if (oldData.size !== data.size) {
      this.state.maxSize = Math.max(data.size, this.state.maxSize);
      for (let i = data.size - this.state.size; i > 0; i--)
        this.createEntity();
    }
    if (oldData.threshold !== data.threshold && data.threshold > this.state.threshold)
      this.state.threshold = data.threshhold;
    if (oldData.maxSize !== data.maxSize) {
      this.state.maxSize = Math.max(data.maxSize, data.size);
      const tgt = Math.ceil(data.size / 2);
      if (this.state.threshold === 0 && this.state.threshold < tgt) this.state.threshold = tgt;
    }
    if (oldData.poolPolicy !== data.poolPolicy) {
      if (data.poolPolicy === 'dynamic') {
        const tgt = Math.ceil(data.size / 2);
        if (this.state.threshold === 0 && this.state.threshold < tgt) this.state.threshold = tgt;
      }
    }
  },

  /**
   * Add a new entity to the list of available entities.
   */
  createEntity: function () {
    const el = document.createElement('a-entity');
    el.play = this.wrapPlay(el.play);
    if (this.data.datagroup)
      instantiateDatagroup(this.sysDataset.getDatagroup(this.data.datagroup), el);
    else
      el.setAttribute('mixin', this.data.mixin);
    el.object3D.visible = false;
    el.pause();
    this.container.appendChild(el);
    const listener = () => {
      el.emit('pool-add', undefined, false);
      this.availableEls.push(el);
      this.state.size++;
      el.removeEventListener('loaded', listener);
    };
    el.addEventListener('loaded', listener);
  },

  /**
   * Play wrapper for pooled entities. When pausing and playing a scene, don't want to play
   * entities that are not in use.
   */
  wrapPlay: function (playMethod) {
    var usedEls = this.usedEls;
    return function () {
      if (usedEls.indexOf(this) < 0) return;
      playMethod.call(this);
    };
  },

  /**
   * Used to request one of the available entities of the pool.
   */
  requestEntity: function () {
    if (this.state.threshold && this.availableEls.length <= this.state.threshold) {
      if (this.state.size < this.state.maxSize)
        this.createEntity();
      else if (this.data.poolPolicy === 'dynamic') {
        if (this.state.size >= this.state.maxSize * 2)
          console.warn(`micosmo:component:mipool:requestEntity: Pool(${this.attrName}) is still expanding. Possible runaway dynamic expansion`);
        else if (!this.dynamicInfo) {
          console.info(`micosmo:component:mipool:requestEntity: Pool(${this.attrName}) is dynamically expanding`);
          this.dynamicInfo = true;
        }
        this.createEntity();
      }
    }
    if (this.availableEls.length === 0) {
      if (this.data.poolPolicy === 'ignore')
        return;
      else if (this.data.poolPolicy === 'warn') {
        console.warn(`micosmo:component:mipool:requestEntity: Pool(${this.attrName}) is empty. Cannot expand`);
        return;
      }
      // 'error' or 'dynamic'
      throw new Error(`micosmo:component:mipool:requestEntity: Pool(${this.attrName}) is empty. Cannot expand`);
    }
    const el = this.availableEls.shift();
    el.emit('pool-remove', undefined, false);
    this.usedEls.push(el);
    el.object3D.visible = this.data.visible;
    return el;
  },

  /**
   * Used to return a used entity to the pool.
   */
  returnEntity: function (el) {
    let index = this.usedEls.indexOf(el);
    if (index < 0) {
      if ((index = this.deletedEls.indexOf(el)) < 0)
        console.warn('micosmo:component:mipool:returnEntity: The returned entity was not previously pooled from ' + this.attrName);
      else
        removeIndex(this.deletedEls, index);
      return;
    }
    removeIndex(this.usedEls, index);
    this.availableEls.push(el);
    el.object3D.visible = false;
    el.emit('pool-return', undefined, false);
    el.pause();
    return el;
  }
});
