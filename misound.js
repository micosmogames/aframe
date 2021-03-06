/*
 * misound.js
 *
 * An extended version of the Aframe 0.9.2 sound component.
 */

/* global THREE */
import aframe from "aframe";
import { bindEvent } from 'aframe-event-decorators';
import { copyValues, equivalent } from '@micosmo/core';
import { createSchemaPersistentObject } from './lib/utils';
import { onLoadedDo } from './startup';
import { startProcess, msWaiter, iterator, timer, tryLocateTicker } from '@micosmo/ticker/aframe-ticker';

const ModuleName = 'micosmo:component:misound:';

aframe.registerComponent('misound', {
  schema: {
    autoplay: { default: false },
    distanceModel: { default: 'inverse', oneOf: ['linear', 'inverse', 'exponential'] },
    loop: { default: false },
    maxDistance: { default: 10000 },
    maxPoolSize: { default: 1 }, // Poolsize can be dynamically extended up to this number.
    offset: { default: 0 },
    on: { default: '' },
    pausePolicy: { default: 'pause', oneOf: ['pause', 'stop'] },
    poolPolicy: { default: 'warn', oneOf: ['warn', 'error', 'discard', 'ignore'] },
    poolSize: { default: 1 },
    positional: { default: true },
    refDistance: { default: 1 },
    fadeIn: { default: [] }, // Duration (or 0 for remainder, secs), targetVolume, startVolume (allows skip of low/high volume range)
    fadeOut: { default: [] }, // Offset (- from end, secs), targetVolume, startVolume (allows skip of low/high volume range)
    playbackRate: { default: 1 }, // Playback rate expressed as a proportion of the full rate.
    repeat: { default: [] }, // Requires a count followed by optional interval.
    rolloffFactor: { default: 1 },
    src: { type: 'audio' },
    volume: { default: 1 },
  },
  updateSchema(data) {
    createSchemaPersistentObject(this, data, '_state');
  },

  multiple: true,

  init: function () {
    this.listener = null;
    this.audioLoader = new THREE.AudioLoader();
    this.pool = new THREE.Group();
    this.loaded = false;
    this.mustPlay = false;
    this.state = this.data._state;

    // Don't pass evt because playSound takes a function as parameter.
    this.playSoundBound = () => this.playSound();
    onLoadedDo(() => { this.ticker = tryLocateTicker(this.el) });
  },

  update: function (oldData) {
    var data = this.data;
    var i;
    var sound;
    var srcChanged = data.src !== oldData.src;

    // Create new sound if not yet created or changing `src`.
    if (srcChanged) {
      if (!data.src) { return; }
      this.setupSound();
    }

    for (i = 0; i < this.pool.children.length; i++) {
      sound = this.pool.children[i];
      if (data.positional) {
        sound.setDistanceModel(data.distanceModel);
        sound.setMaxDistance(data.maxDistance);
        sound.setRefDistance(data.refDistance);
        sound.setRolloffFactor(data.rolloffFactor);
      }
      sound.setLoop(data.loop);
      sound.isPaused = false;
    }
    if (!this.state.volume) {
      this.state.volume = data.volume; // Only initialise volume. this.data.volume is the default.
      this.state.playbackRate = data.playbackRate; // Only initialise playbackRate. this.data.playbackRate is the default.
    }

    if (data.on !== oldData.on) {
      this.updateEventListener(oldData.on);
    }

    // All sound values set. Load in `src`.
    if (srcChanged) {
      var misound = this;

      this.loaded = false;
      this.audioLoader.load(data.src, function (buffer) {
        for (i = 0; i < misound.pool.children.length; i++) {
          sound = misound.pool.children[i];
          sound.setBuffer(buffer);
        }
        misound.loaded = true;

        // Remove this key from cache, otherwise we can't play it again
        THREE.Cache.remove(data.src);
        if (misound.data.autoplay || misound.mustPlay) { misound.playSound(); }
        misound.el.emit('sound-loaded', misound.evtDetail, false);
      });
    }

    const checkNumber = (n, def) => typeof n !== 'number' || isNaN(n) || n < 0 ? def : n;
    const validNumber = n => typeof n === 'number' && !isNaN(n)

    if (!oldData || !equivalent(oldData.repeat, data.repeat)) {
      const count = Number.parseInt(data.repeat[0]);
      const interval = Number.parseInt(data.repeat[1]);
      if (!validNumber(count) || count <= 0)
        this.state.repeat = undefined
      else {
        this.state.repeat = {
          count,
          interval: checkNumber(interval, 0)
        }
      }
    }

    function parseFade(aFade, defStartVol, defTargetVol) {
      const offset = Number.parseInt(aFade[0]);
      const duration = Number.parseInt(aFade[1]);
      const sVol = Number.parseFloat(aFade[2]);
      const tVol = Number.parseFloat(aFade[3]);
      if (!validNumber(offset))
        return undefined;
      return {
        offset,
        duration: checkNumber(duration, 0),
        startVolume: checkNumber(sVol, defStartVol),
        targetVolume: checkNumber(tVol, defTargetVol)
      }
    }

    if (!oldData || !equivalent(oldData.fadeIn, data.fadeIn))
      this.state.fadeIn = parseFade(data.fadeIn, 0, 1);

    if (!oldData || !equivalent(oldData.fadeOut, data.fadeOut))
      this.state.fadeOut = parseFade(data.fadeOut, 1, 0);
  },

  pause() {
    if (this.data.pausePolicy === 'pause')
      this.pauseSound();
    else
      this.stopSound();
    this.removeEventListener();
  },

  play() {
    if (this.data.autoplay)
      this.playSound();
    else if (this.isPaused)
      this.resumeSound();
    this.updateEventListener();
  },

  remove: function () {
    var i;
    var sound;

    this.removeEventListener();

    if (this.el.getObject3D(this.attrName)) {
      this.el.removeObject3D(this.attrName);
    }

    try {
      for (i = 0; i < this.pool.children.length; i++) {
        sound = this.pool.children[i];
        sound.disconnect();
      }
    } catch (e) {
      // disconnect() will throw if it was never connected initially.
      console.warn(`${ModuleName}remove: Audio source not properly disconnected. Sound(${id(this)}`);
    }
  },

  'pool-return': bindEvent(function () {
    this.stopSound(); // Stop the sound as it is going back into a pool
  }),

  /**
  *  Update listener attached to the user defined on event.
  */
  updateEventListener: function (oldEvt) {
    var el = this.el;
    if (oldEvt) { el.removeEventListener(oldEvt, this.playSoundBound); }
    el.addEventListener(this.data.on, this.playSoundBound);
  },

  removeEventListener: function () {
    this.el.removeEventListener(this.data.on, this.playSoundBound);
  },

  /**
   * Removes current sound object, creates new sound object, adds to entity.
   *
   * @returns {object} sound
   */
  setupSound: function () {
    var el = this.el;
    var i;
    var sceneEl = el.sceneEl;
    var sound;

    if (this.pool.children.length > 0) {
      this.stopSound();
      el.removeObject3D(this.attrName);
    }

    // Only want one AudioListener. Cache it on the scene.
    var listener = this.listener = sceneEl.audioListener || new THREE.AudioListener();
    sceneEl.audioListener = listener;

    if (sceneEl.camera) {
      sceneEl.camera.add(listener);
    }

    // Wait for camera if necessary.
    sceneEl.addEventListener('camera-set-active', function (evt) {
      evt.detail.cameraEl.getObject3D('camera').add(listener);
    });

    // Create [poolSize] audio instances and attach them to pool
    this.pool = new THREE.Group();
    for (i = 0; i < this.data.poolSize; i++) {
      sound = this.data.positional
        ? new THREE.PositionalAudio(listener)
        : new THREE.Audio(listener);
      this.pool.add(sound);
    }
    el.setObject3D(this.attrName, this.pool);

    this.nPlaying = 0;
    for (i = 0; i < this.pool.children.length; i++) {
      sound = this.pool.children[i];
      sound.onEnded = fOnEnded(this, sound);
    }
  },

  /**
   * Pause all the sounds in the pool.
   */
  pauseSound: function () {
    if (!this.isPlaying || this.isPaused)
      return;

    var i;
    var sound;
    this.isPlaying = false;
    for (i = 0; i < this.pool.children.length; i++) {
      sound = this.pool.children[i];
      if (!sound.source || !sound.source.buffer || !sound.isPlaying || sound.isPaused) {
        continue;
      }
      sound.isPaused = true;
      sound.pause();
    }
    this.isPaused = true;
  },

  /**
   * Resume all the sounds in the pool.
   */
  resumeSound() {
    if (this.isPlaying || !this.isPaused)
      return;
    this.isPaused = false;
    this.isPlaying = true;
    for (let i = 0; i < this.pool.children.length; i++) {
      const sound = this.pool.children[i];
      if (sound.isPaused) {
        sound.play();
        sound.isPaused = false;
      }
    }
  },

  /**
   * Look for an unused sound in the pool and play it if found.
   */
  playSound: function (processSound) {
    if (this.isPaused)
      this.stopSound();
    else {
      if (this.nPlaying >= this.pool.children.length) {
        if (this.nPlaying < this.data.maxPoolSize) {
          const listener = this.pool.children[0].listener;
          const audio = this.data.positional ? new THREE.PositionalAudio(listener) : new THREE.Audio(listener);
          this.pool.add(audio);
          audio.onEnded = fOnEnded(this, audio);
        } else if (this.data.poolPolicy === 'error') {
          throw new Error(`${ModuleName}playSound: Maximum sound instances exceeded. Sound(${id(this)})`);
        } else if (this.data.poolPolicy === 'discard') {
          const iAudio = findLongestRunningAudio(this);
          const audio = this.pool.children[iAudio];
          audio.stop();
          this.nPlaying--;
        } else if (this.data.poolPolicy === 'ignore')
          return;
      }
    }

    var found, i, sound;
    if (!this.loaded) {
      console.warn(`${ModuleName}playSound: Sound not loaded yet. It will be played once it finished loading. Sound(${id(this)})`);
      this.mustPlay = true;
      return;
    }

    found = false;
    this.isPlaying = true;
    const data = this.data; const state = this.state;
    for (i = 0; i < this.pool.children.length; i++) {
      sound = this.pool.children[i];
      if (!sound.isPlaying && sound.buffer && !found) {
        if (processSound) { processSound(sound); }
        if (data.offset !== 0)
          sound.offset = data.offset; // Set the starting offset for the audio.
        sound.setVolume(state.volume);
        sound.setPlaybackRate(state.playbackRate);
        if (state.fadeIn)
          startProcess(fadeFor(this, sound, state.fadeIn), this.ticker);
        sound.play();
        if (state.repeat)
          sound._repeat = copyValues(state.repeat);
        else if (state.fadeOut && !state.fadeIn)
          startProcess(fadeFor(this, sound, state.fadeOut), this.ticker);
        sound.isPaused = false;
        found = true;
        continue;
      }
    }

    if (!found) {
      console.warn(`${ModuleName}playSound: All sound instances are playing. Sound(${id(this)})`);
      return;
    }
    this.mustPlay = false;
    this.nPlaying++;
  },

  /**
   * Stop all the sounds in the pool, after fading if requested
   */
  stopSound: function () {
    var i, sound;
    this.isPlaying = false;
    this.isPaused = false;
    for (i = 0; i < this.pool.children.length; i++) {
      sound = this.pool.children[i];
      if (!sound.source || !sound.source.buffer) { return; }
      sound.stop();
      sound.offset = 0;
      delete sound._repeat;
    }
    if (this.nPlaying > 0) {
      const detail = this.evtDetail;
      detail.reason = 'stop';
      this.el.emit('sound-ended', detail, false); // Make sure listeners know when sounds have stopped
      this.nPlaying = 0;
    }
  },

  getPlaybackRate() {
    return this.state.playbackRate || 1;
  },

  setPlaybackRate(rate) {
    this.state.playbackRate = rate || (rate = this.data.playbackRate);
    for (let i = 0; i < this.pool.children.length; i++) {
      const sound = this.pool.children[i];
      if (sound.isPlaying) {
        // May set the playback rate multiple times before a pause so need to adjust
        // the offset each time its changed. This is not handled properly in THREE.Audio
        // Does mean resetting the startTime. Yuk
        sound.offset += (sound.context.currentTime - sound.startTime) * sound.playbackRate;
        sound.startTime = sound.context.currentTime;
      }
      sound.setPlaybackRate(rate);
    }
  },

  getVolume() {
    return this.state.volume;
  },

  setVolume(v) {
    this.state.volume = v || (v = this.data.volume);
    for (let i = 0; i < this.pool.children.length; i++)
      this.pool.children[i].setVolume(v);
    return v
  },

  getDuration() {
    return this.pool.children.length && this.pool.children[0].buffer ? this.pool.children[0].buffer.duration : 0;
  },

  warpInStep(s, targetRate) {
    const dtRate = this.state.playbackRate - this.data.playbackRate * targetRate;
    if (dtRate < 0)
      return this.warpoutStep(s, targetRate);
    const fadeinPerTick = dtRate / (s * 1000);
    return timer(s, (tm, dt) => {
      this.setPlaybackRate(this.state.playbackRate -= dt * fadeinPerTick);
      return 'more';
    })
  },
  warpOutStep(s, targetRate) {
    const dtRate = this.data.playbackRate * targetRate - this.state.playbackRate;
    if (dtRate < 0)
      return this.warpinStep(s, targetRate);
    const fadeoutPerTick = dtRate / (s * 1000);
    return timer(s, (tm, dt) => {
      this.setPlaybackRate(this.state.playbackRate += dt * fadeoutPerTick);
      return 'more';
    })
  },
  warpIn(s, targetRate) {
    startProcess(this.warpinStep(s, targetRate), this.ticker);
  },
  warpOut(s, targetRate) {
    startProcess(this.warpoutStep(s, targetRate), this.ticker);
  }
});

function fOnEnded(misound, audio) {
  return function () {
    audio.stop(); // Need to clear the sound offset when the sound has ended.
    if (repeatSound(misound, audio))
      return;
    if (--misound.nPlaying <= 0) {
      const detail = misound.evtDetail;
      detail.reason = 'end';
      misound.el.emit('sound-ended', detail, false); // Only emit once all sounds have stopped playing.
      misound.nPlaying = 0;
      misound.isPlaying = false;
    }
  };
};

function repeatSound(misound, audio) {
  if (!audio._repeat)
    return false;
  if (--audio._repeat.count > 0) {
    if (misound.data.offset !== 0)
      audio.offset = misound.data.offset; // Set the starting offset for the audio.
    if (audio._repeat.count === 1 && misound.state.fadeOut) {
      startProcess(iterator(msWaiter(audio._repeat.interval), () => { audio.play() }, fadeFor(misound, audio, misound.state.fadeOut)), misound.ticker);
    } else
      startProcess(msWaiter(audio._repeat.interval, () => { audio.play() }), misound.ticker);
    return true;
  }
  delete audio._repeat;
  return false;
}

function fadeFor(misound, audio, fade) {
  const audioDuration = (audio.buffer.duration - (audio.isPlaying ? audio.context.currentTime : 0)) * 1000;
  var offset = fade.offset * 1000;
  offset = Math.max(offset < 0 ? audioDuration + offset : offset, 0);
  var sVol = fade.startVolume * misound.state.volume;
  const tVol = fade.targetVolume * misound.state.volume;
  const defRemain = audioDuration - offset;
  const msVol = Math.abs(tVol - sVol) / Math.min((fade.duration * 1000 | defRemain), defRemain);
  const fFinished = sVol <= tVol ? (dt, adj) => (sVol += adj) > tVol : (dt, adj) => (sVol -= adj) < tVol;

  if (offset === 0)
    audio.setVolume(sVol); // If we are starting at the currentTime of the audio then set start volume now to prevent clipping.

  return (tm, dt) => {
    if (offset > 0) {
      if ((offset -= dt) <= 0)
        audio.setVolume(sVol); // Found our required position so set the volume to the start volume
      return 'more';
    }
    if (fFinished(dt, msVol * dt)) {
      audio.setVolume(tVol); // Make sure the last operation is for the final target volume.
      return; // Finished
    }
    audio.setVolume(sVol);
    return 'more';
  };
}

function findLongestRunningAudio(sound) {
  let iAudio = 0;
  let longTime = sound.pool.children[0].context.currentTime;
  for (let i = 1; i < sound.pool.children.length; i++) {
    const audio = sound.pool.children[i];
    if (audio.context.currentTime > longTime) {
      iAudio = i;
      longTime = audio.context.currentTime;
    }
  }
  return iAudio;
}

function id(misound) {
  return misound.id || !misound.el.id ? misound.attrName : `Element:${misound.el.id}`;
}
